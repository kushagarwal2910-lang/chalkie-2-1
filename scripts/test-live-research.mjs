// Explicit opt-in: exercises a running app and consumes Tavily/Groq quota.
// Supplies only questions; no fixtures, answers, images, or evidence are injected.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

if (process.env.RUN_LIVE_TESTS !== "1") throw new Error("Set RUN_LIVE_TESTS=1 to authorize live provider calls.");
const base = "http://localhost:3000";
const directory = "outputs/research-live";
await mkdir(directory, { recursive: true });
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.services.tavily, true);
assert.equal(health.model, "openai/gpt-oss-120b");
assert.equal(health.services.visionModel, "qwen/qwen3.8-27b");

async function request(path, input, name) {
  const start = Date.now();
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200);
  const raw = await response.text();
  const events = raw.split(/\r?\n\r?\n/).filter(block => block.startsWith("event:")).map(block => {
    const lines = block.split(/\r?\n/);
    return { type: lines[0].slice(6).trim(), data: JSON.parse(lines.find(line => line.startsWith("data:")).slice(5)) };
  });
  await writeFile(`${directory}/${name}.json`, JSON.stringify({ question: input.question, elapsedMs: Date.now() - start, events }, null, 2));
  assert.ok(!events.some(event => event.type === "error"), JSON.stringify(events.find(event => event.type === "error")?.data));
  assert.equal(events.find(event => event.type === "done")?.data.ok, true);
  return { events, elapsedMs: Date.now() - start };
}

const cases = [
  { name: "bicycle", question: "How does a bicycle disc brake stop the wheel?", followup: "How do the pads slow the wheel? Use the existing board." },
  { name: "leaf", question: "How does a leaf make food using sunlight? Include a freely sourced leaf diagram.", followup: "What role does chlorophyll play? Use the existing board." },
];
const summary = [];
for (const item of cases) {
  const sessionId = randomUUID();
  const { events, elapsedMs } = await request("/api/lesson", { question: item.question, sessionId, useWeb: true }, item.name);
  const lesson = events.find(event => event.type === "lesson")?.data.lesson;
  assert.ok(lesson?.sources.length > 0, "A live lesson must include actual research sources");
  assert.ok(events.findIndex(event => event.type === "sources") < events.findIndex(event => event.type === "lesson"));
  assert.ok(lesson.sources.every(source => /^https?:\/\//.test(source.url) && source.summary.trim()));
  const images = lesson.objects.flatMap(object => object.image ? [object.image] : []);
  for (const object of lesson.objects.filter(object => /[-_]/.test(object.id))) assert.ok(lesson.segments.every(segment => !segment.narration.includes(object.id)), "Internal IDs must not be spoken");
  if (item.name === "leaf") assert.ok(images.length > 0, "The leaf image flow must complete, not silently fall back");
  for (const image of images) {
    assert.ok(image.description?.trim(), "An image must have an actual vision inspection");
    assert.match(image.sourceUrl, /^https:\/\//);
    assert.match(image.license, /^(CC0|Public domain|CC BY(?:-SA)? [1-4]\.0)$/i);
    const proxy = await fetch(`${base}/api/image?url=${encodeURIComponent(image.url)}`);
    assert.equal(proxy.status, 200);
    assert.match(proxy.headers.get("content-type"), /^image\/(png|jpeg|webp)$/);
    assert.ok((await proxy.arrayBuffer()).byteLength > 0);
  }
  const followup = await request("/api/follow-up", { question: item.followup, currentLesson: lesson, sessionId }, `${item.name}-followup`);
  const plan = followup.events.find(event => event.type === "followup")?.data.plan;
  assert.ok(plan?.sources.length > 0);
  assert.ok(followup.events.some(event => event.type === "status" && event.data.message?.includes("indexed evidence")));
  const result = { case: item.name, elapsedMs, sources: lesson.sources.length, steps: lesson.segments.length, images: images.map(image => ({ title: image.title, regions: image.regions.length })), imageRequests: lesson.objects.flatMap(object => object.imageRequest ? [object.imageRequest] : []), followupMs: followup.elapsedMs, coverage: plan.coverage };
  summary.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
