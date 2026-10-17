import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { deflateSync } from "node:zlib";
import { generateIllustration, imageGenerationAvailable } from "./generated-images.ts";
import { compileTeachingPlan, type TeachingPlan } from "./lesson-v2.ts";
import type { GroqCallOptions } from "./groq-pool-core.ts";

declare global { var chalkieImageTestVision: (path: string, init: RequestInit, options?: GroqCallOptions) => Promise<Response>; }
// Replace only the vision transport before loading the library. Provider cookies,
// credentials and .env files are never loaded by these tests.
const loader = `export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/groq-pool.ts')) return { url: 'data:text/javascript,export async function groqFetch(...args){return globalThis.chalkieImageTestVision(...args)}', shortCircuit: true };
  return nextResolve(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { attachLessonImages, denseGroundExistingImage } = await import("./image-library.ts");

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width = 200, height = 160) {
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(typed));
    return Buffer.concat([header, typed, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}
const pixels = png();
const goodRegion = { label: "Matrix", x: 0.2, y: 0.25, width: 0.3, height: 0.4, confidence: 0.94 };
const response = (regions: unknown[] = [goodRegion], suitable = true) => Response.json({ choices: [{ message: { content: JSON.stringify({ suitable, description: "A visible region is labeled Matrix.", regions }) } }] });
const lessonFixture = (query: string, intent: "canonical" | "story" | "analogy" = "canonical") => {
  const plan: TeachingPlan = { title: query, summary: "A visual explanation", coverage: "append", nodes: [{ id: "figure", label: "Teaching figure", kind: "image", imageQuery: query, regions: ["Matrix", "Inner membrane"], visualIntent: intent }], links: [], steps: [{ title: "Observe", narration: "Observe the labeled matrix in this illustration.", targetIds: ["figure"] }] };
  return { plan, lesson: compileTeachingPlan(plan, query, []) };
};
async function withImageEnvironment(local: string | undefined, run: () => Promise<void>, key?: string, model?: string) {
  const values = { FAL_KEY: key, LOCAL_IMAGE_ENDPOINT: local, CHALKIE_IMAGE_MODEL: model };
  const original = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  try { await run(); } finally { for (const [name, value] of Object.entries(original)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
}

test("image generation without an account or local model makes no provider calls", async t => {
  const transport = t.mock.method(globalThis, "fetch", async () => { throw new Error("No request expected"); });
  await withImageEnvironment(undefined, async () => {
    assert.equal(imageGenerationAvailable(), false);
    assert.equal(await generateIllustration("A physical analogy", "analogy"), null);
    assert.equal(transport.mock.callCount(), 0);
  });
});

test("local generated pixels retain provenance and do not inherit fal attribution or credentials", async t => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "http://image-model.invalid/generate");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.match(JSON.parse(String(init?.body)).prompt, /never a documentary photograph/);
    return Response.json({ images: [{ url: pixels, width: 999, height: 999 }] });
  });
  await withImageEnvironment("http://image-model.invalid/generate", async () => {
    const image = await generateIllustration("A historical classroom", "story");
    assert.equal(image?.provenance, "generated");
    assert.equal(image?.width, 200, "Dimensions come from the pixels, not provider metadata.");
    assert.equal(image?.author, "Local image model");
    assert.doesNotMatch(image?.sourceUrl ?? "", /fal\.ai/);
    assert.match(image?.license ?? "", /not evidence/);
    assert.deepEqual(image?.regions, []);
  }, "unused-test-fal-key");
});

test("hosted Flux generation uses the configured model and explicit conceptual labeling", async t => {
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://fal.run/fal-ai/flux/schnell");
    assert.equal(new Headers(init?.headers).get("authorization"), "Key test-only-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.num_inference_steps, 4);
    assert.equal(body.sync_mode, true);
    assert.match(body.prompt, /not an authoritative scientific diagram/);
    return Response.json({ images: [{ url: pixels }] });
  });
  await withImageEnvironment(undefined, async () => assert.equal((await generateIllustration("A mitochondrion", "canonical"))?.provenance, "generated"), "test-only-key", "flux-schnell");
});

test("oversized streamed JSON is cancelled before parsing", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4_100_000)); controller.enqueue(new Uint8Array(4_100_000)); },
    cancel() { cancelled = true; },
  })));
  await withImageEnvironment("http://image-model.invalid", async () => {
    await assert.rejects(generateIllustration("A teaching analogy", "analogy"), /response exceeds/);
    assert.equal(cancelled, true);
  });
});

test("generation rejects remote URLs, tiny pixels and mismatched data MIME types", async t => {
  await withImageEnvironment("http://image-model.invalid", async () => {
    for (const url of ["http://169.254.169.254/image.jpg", png(1, 1), pixels.replace("image/png", "image/jpeg")]) {
      const transport = t.mock.method(globalThis, "fetch", async () => Response.json({ images: [{ url }] }));
      await assert.rejects(generateIllustration("An illustration", "canonical"), /inline image data|dimensions or image type/);
      assert.equal(transport.mock.callCount(), 1, "Never fetch a provider-supplied remote URL.");
      transport.mock.restore();
    }
  });
});

test("failed canonical libraries reach generation and reject invented image regions", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    calls.push(String(url));
    return String(url).startsWith("http://image-model.invalid") ? Response.json({ images: [{ url: pixels }] }) : new Response("unavailable", { status: 503 });
  });
  globalThis.chalkieImageTestVision = async () => response([
    goodRegion,
    { ...goodRegion, x: 0.9, width: 0.5 },
    { ...goodRegion, label: "Inner membrane", confidence: 0.4 },
    { ...goodRegion, label: "Inner membrane", x: -0.1 },
    { ...goodRegion, label: "Matrix outside the cell" },
    { ...goodRegion, label: "Inner membrane", confidence: "0.99" },
  ]);
  await withImageEnvironment("http://image-model.invalid", async () => {
    const { lesson, plan } = lessonFixture("canonical library failure test");
    await attachLessonImages(lesson, plan, {});
    assert.ok(calls.some(url => url.includes("commons.wikimedia.org")));
    assert.ok(calls.some(url => url.includes("api.openverse.org")));
    assert.equal(calls.at(-1), "http://image-model.invalid");
    const image = lesson.objects[0].image;
    assert.equal(image?.provenance, "generated");
    assert.match(image?.description ?? "", /not documentary or scientific evidence/);
    assert.deepEqual(image?.regions, [goodRegion]);
    assert.equal(lesson.objects[0].annotations?.length, 1);
  });
});

test("empty canonical libraries without generation leave an explanatory card", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  globalThis.chalkieImageTestVision = async () => { throw new Error("No image needs inspection"); };
  await withImageEnvironment(undefined, async () => {
    const { lesson, plan } = lessonFixture("no account canonical fallback test");
    await attachLessonImages(lesson, plan, {});
    assert.equal(lesson.objects[0].shapeType, "note");
    assert.equal(lesson.objects[0].image, undefined);
    assert.match(lesson.objects[0].imageRequest?.reason ?? "", /require a configured provider or local image model/);
  });
});

test("user diagrams precede library lookup and never enter the shared public cache", async t => {
  const transport = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  globalThis.chalkieImageTestVision = async () => response();
  await withImageEnvironment(undefined, async () => {
    const { lesson, plan } = lessonFixture("private uploaded diagram priority test");
    await attachLessonImages(lesson, plan, {}, [{ id: "private-lecture", title: "Private lecture", kind: "pdf", text: "The lecture explains mitochondrial matrix structure.", images: [{ id: "private-figure", title: "Private page", dataUrl: pixels, width: 200, height: 160, page: 1, kind: "page" }] }]);
    assert.equal(transport.mock.callCount(), 0);
    assert.equal(lesson.objects[0].image?.provenance, "user");
    const nextSession = lessonFixture("private uploaded diagram priority test");
    await attachLessonImages(nextSession.lesson, nextSession.plan, {});
    assert.equal(nextSession.lesson.objects[0].image, undefined);
    assert.ok(transport.mock.callCount() > 0, "A different session must search public sources, not reuse another user's diagram.");
  });
});

test("story generation skips libraries and respects an explicit vision rejection", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => { urls.push(String(url)); return Response.json({ images: [{ url: pixels }] }); });
  globalThis.chalkieImageTestVision = async () => response([], false);
  await withImageEnvironment("http://image-model.invalid", async () => {
    const { lesson, plan } = lessonFixture("story visual rejected by inspection", "story");
    await attachLessonImages(lesson, plan, {});
    assert.deepEqual(urls, ["http://image-model.invalid"]);
    assert.equal(lesson.objects[0].image, undefined);
    assert.equal(lesson.objects[0].shapeType, "note");
  });
});

test("dense re-grounding discards missing labels, off-image boxes and low confidence", async () => {
  globalThis.chalkieImageTestVision = async () => response([
    { ...goodRegion, label: undefined }, { ...goodRegion, x: 2 }, { ...goodRegion, confidence: 0.5 }, goodRegion,
    { ...goodRegion, label: "Unexpected fifth region" },
  ]);
  const result = await denseGroundExistingImage({ id: "mock", title: "Mock pixels", url: pixels, sourceUrl: "about:blank", author: "Fixture", license: "Test", licenseUrl: "about:blank", width: 200, height: 160, regions: [] }, "Matrix", {});
  assert.deepEqual(result.regions, [goodRegion]);
});

test("canonical retrieval deadline cancels slow libraries and still permits generation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let libraryCancelled = false;
  let generationCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === "http://image-model.invalid") { generationCalls += 1; assert.equal(init?.signal?.aborted, false); return Response.json({ images: [{ url: pixels }] }); }
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => { libraryCancelled = true; reject(init.signal?.reason); }, { once: true });
    });
  });
  globalThis.chalkieImageTestVision = async () => response();
  await withImageEnvironment("http://image-model.invalid", async () => {
    const { lesson, plan } = lessonFixture("slow canonical deadline test");
    const pending = attachLessonImages(lesson, plan, {});
    await new Promise<void>(resolve => setImmediate(resolve));
    t.mock.timers.tick(25_000);
    await pending;
    assert.equal(libraryCancelled, true);
    assert.equal(generationCalls, 1);
    assert.equal(lesson.objects[0].image?.provenance, "generated");
  });
});

test("a learner request abort stops discovery without triggering generation", async t => {
  const abort = new AbortController();
  let generationCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === "http://image-model.invalid") { generationCalls += 1; throw new Error("Generation must not start after cancellation"); }
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  });
  await withImageEnvironment("http://image-model.invalid", async () => {
    const { lesson, plan } = lessonFixture("request cancellation test");
    const pending = attachLessonImages(lesson, plan, { signal: abort.signal });
    await new Promise<void>(resolve => setImmediate(resolve));
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(generationCalls, 0);
  });
});

test("user figure inspections are capped at four across all image nodes", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  let inspections = 0;
  globalThis.chalkieImageTestVision = async () => { inspections += 1; return response([], false); };
  await withImageEnvironment(undefined, async () => {
    const { plan } = lessonFixture("bounded user inspection test");
    plan.nodes = Array.from({ length: 5 }, (_, index) => ({ ...plan.nodes[0], id: `figure-${index}`, imageQuery: `bounded user inspection ${index}` }));
    plan.steps[0].targetIds = plan.nodes.map(node => node.id);
    const lesson = compileTeachingPlan(plan, plan.title, []);
    const figures = Array.from({ length: 8 }, (_, index) => ({ id: `page-${index}`, title: `Page ${index + 1}`, dataUrl: pixels, width: 200, height: 160, page: index + 1, kind: "page" as const }));
    await attachLessonImages(lesson, plan, {}, [{ id: "bounded-lecture", title: "Lecture slides", kind: "pdf", text: "The lecture explains mitochondrial structure and function.", images: figures }]);
    assert.equal(inspections, 4);
  });
});
