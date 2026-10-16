// Real research and Groq calls. Only questions are supplied, never answer fixtures.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
if (process.env.RUN_LIVE_TESTS !== "1") throw new Error("Set RUN_LIVE_TESTS=1 to run real providers.");
await mkdir("outputs/research-live", { recursive: true });
for (const [mode, question] of [
  ["comparison", "What is the difference between evaporation and boiling? Compare them briefly."],
  ["worked-example", "Solve 2x + 3 = 11. Work through this short example and explain why each step is valid."],
]) {
  const started = Date.now();
  const response = await fetch("http://localhost:3000/api/lesson", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, sessionId: randomUUID(), useWeb: true }), signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200);
  const raw = await response.text();
  const events = raw.split(/\r?\n\r?\n/).filter(block => block.startsWith("event:")).map(block => ({ type: block.split(/\r?\n/)[0].slice(6).trim(), data: JSON.parse(block.split(/\r?\n/).find(line => line.startsWith("data:")).slice(5)) }));
  await writeFile(`outputs/research-live/teaching-${mode}.json`, JSON.stringify({ question, events }, null, 2));
  assert.ok(!events.some(event => event.type === "error"), JSON.stringify(events.find(event => event.type === "error")?.data));
  const lesson = events.find(event => event.type === "lesson")?.data.lesson;
  assert.ok(lesson?.sources.length);
  assert.equal(lesson.teachingMode, mode);
  assert.ok(lesson.objects.every(object => object.shapeType === "note" || object.image), "This teaching mode should not become a chain of boxes");
  console.log(JSON.stringify({ mode, elapsedMs: Date.now() - started, labels: lesson.objects.map(object => object.label), narrations: lesson.segments.map(step => step.narration) }));
}
