// Real integration test: uses a previously retrieved lesson, never authored evidence.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { searchImageProvider } from "../lib/image-providers.ts";
import { fetchCommonsImage } from "../lib/commons-fetch.ts";
if (process.env.RUN_LIVE_TESTS !== "1") throw new Error("Set RUN_LIVE_TESTS=1 for real provider calls.");
for (const [provider, query] of (process.env.SKIP_LIBRARY_PROBES ? [] : [["commons", "leaf diagram"], ["openverse", "butterfly"]])) {
  const candidates = await searchImageProvider(provider, query);
  assert.ok(candidates.length, `${provider} returned no usable references`);
  let loaded;
  for (const asset of candidates.slice(0, 3)) {
    try { const image = await fetchCommonsImage(asset.url); loaded = { provider, title: asset.title, license: asset.license, bytes: image.bytes.length }; break; } catch { /* try next live result */ }
  }
  assert.ok(loaded, `${provider} images did not download`);
  console.log(JSON.stringify(loaded));
}
const previous = JSON.parse(await readFile("outputs/research-live/leaf.json", "utf8"));
const currentLesson = previous.events.find(event => event.type === "lesson").data.lesson;
assert.ok(currentLesson.sources.some(source => source.summary.trim()));
const secret = (await readFile(".chalkie-dev-secret", "utf8")).trim();
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, groqKeys: [], tavilyKey: "invalid-for-followup-test", savedAt: Date.now() })), cipher.final()]);
const cookie = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
async function followup(lesson, name) {
  const started = Date.now();
  const response = await fetch("http://localhost:3000/api/follow-up", { method: "POST", headers: { "Content-Type": "application/json", Cookie: `chalkie_byok=${cookie}` }, body: JSON.stringify({ question: "Add a new freely sourced chloroplast diagram and explain its role in making food. The existing leaf image does not show the inside of a chloroplast.", sessionId: randomUUID(), currentLesson: lesson }) });
  const raw = await response.text();
  const events = raw.split(/\r?\n\r?\n/).filter(block => block.startsWith("event:")).map(block => ({ type: block.split(/\r?\n/)[0].slice(6).trim(), data: JSON.parse(block.split(/\r?\n/).find(line => line.startsWith("data:")).slice(5)) }));
  await writeFile(`outputs/research-live/${name}.json`, JSON.stringify(events, null, 2));
  assert.ok(!events.some(event => event.type === "status" && event.data.stage === "research"), "Follow-ups must not research with Tavily");
  console.log(JSON.stringify({ check: name, elapsedMs: Date.now() - started }));
  return events;
}
const events = await followup(currentLesson, "new-image-followup");
assert.ok(!events.some(event => event.type === "error"), JSON.stringify(events.find(event => event.type === "error")?.data));
const plan = events.find(event => event.type === "followup")?.data.plan;
const images = plan?.objects.flatMap(object => object.image ? [object.image] : []) ?? [];
assert.ok(images.length, "Follow-up must fetch and inspect a NEW image with Tavily unavailable");
assert.ok(images.some(image => /chloroplast/i.test(`${image.title} ${image.description}`)), "The new image must match the requested subject");
assert.ok(images.every(image => image.description));
for (const image of images) {
  const loaded = await fetch(`http://localhost:3000/api/image?${new URLSearchParams({ url: image.url })}`);
  assert.equal(loaded.status, 200, "The follow-up image must be available to the canvas");
  assert.ok((await loaded.arrayBuffer()).byteLength > 1000);
}
assert.ok(plan.segments.length <= 6, "Follow-up teaching should stay bounded");
assert.ok(plan.segments.every(step => !/\bnode\b|look at this|\bellipse\b/i.test(step.narration)));
console.log(JSON.stringify({ followup: "new-image", tavily: "invalid test key", images: images.map(image => ({ title: image.title, regions: image.regions.length })), narration: plan.segments.map(step => step.narration) }));
const missing = await followup({ ...currentLesson, sources: [] }, "no-research-followup");
assert.equal(missing.find(event => event.type === "error")?.data.code, "NO_RESEARCH_EVIDENCE");
assert.ok(!missing.some(event => event.type === "followup"));
console.log("Missing follow-up evidence fails clearly without a Tavily fallback.");
