// Offline integration: final narration must use real targets and preserve provider failures.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createDirectPlotLesson } from "../lib/plot-lesson.ts";
import { plotSpecSchema } from "../lib/plot-tool.ts";

const loader = `export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith('/grounded-narration.ts') && specifier === './groq-pool.ts') return {url:'data:text/javascript,export class GroqHttpError extends Error {} export const groqFetch = (...args) => globalThis.__narrationTestFetch(...args);',shortCircuit:true};
  if (context.parentURL?.endsWith('/grounded-narration.ts') && specifier === './provider-response.ts') return {url:'data:text/javascript,export class ProviderResponseError extends Error {}',shortCircuit:true};
  return nextResolve(specifier,context);
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);
const { groundNarrationInImages } = await import("../lib/grounded-narration.ts");
const fresh = () => {
  const lesson = createDirectPlotLesson("Plot A: 1, B: 2", plotSpecSchema.parse({kind:"bar",title:"Counts",xLabel:"Category",yLabel:"Count",provenance:"user",series:[{name:"Counts",points:[{x:0,y:1,label:"A"},{x:1,y:2,label:"B"}]}]}));
  lesson.objects.push({...lesson.objects[0],id:"second"});
  return lesson;
};
const complete = steps => Response.json({choices:[{message:{content:JSON.stringify({steps})}}]});
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("No external call permitted in narration tests"); };
try {
  const lesson = fresh();
  const narration = "A rises. B follows. An unknown feature. ".repeat(55);
  const cues = [
    ...Array.from({length:20},() => ({phrase:"A rises",targetId:"graph#series_0_point_0",kind:"circle"})),
    {phrase:"B follows",targetId:"second#series_0_point_1",kind:"focus"},
    {phrase:"An unknown feature",targetId:"graph#made_up",kind:"circle"},
    {phrase:"A rises",targetId:"graph#series_0_point_0",kind:"arrow",toTargetId:"second#series_0_point_0"},
    {phrase:"Not actually spoken",targetId:"graph",kind:"focus"},
  ];
  globalThis.__narrationTestFetch = async () => complete([{narration,cues}]);
  await groundNarrationInImages(lesson,lesson.question,"User data",{});
  assert.equal(lesson.segments[0].cues.length,21);
  assert.deepEqual(lesson.segments[0].targetIds,["graph","second"]);
  assert.equal(lesson.segments[0].durationMs,120000);
  let calls = 0;
  globalThis.__narrationTestFetch = async () => {
    calls++;
    return calls === 1 ? Response.json({choices:[{message:{content:"broken json"}}]}) : complete([{narration:"A rises",cues:[{phrase:"A rises",targetId:"graph#series_0_point_0",kind:"arrow",toTargetId:"graph#series_0_point_1"}]}]);
  };
  const repaired = fresh();
  await groundNarrationInImages(repaired,repaired.question,"User data",{});
  assert.equal(calls,2);
  assert.equal(repaired.segments[0].cues[0].kind,"arrow");
  const unavailable = Object.assign(new Error("Provider unavailable"),{code:"FREE_LIMIT_REACHED"});
  calls = 0;
  globalThis.__narrationTestFetch = async () => { calls++; throw unavailable; };
  await assert.rejects(groundNarrationInImages(fresh(),"Plot", "User data",{}),error => error === unavailable);
  assert.equal(calls,1,"Provider failures should neither be masked nor retried as schema errors");
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(groundNarrationInImages(fresh(),"Plot","User data",{signal:cancelled.signal}),{name:"AbortError"});
  console.log("Grounded narration checks passed: exact targets, bounded visibility/duration, schema repair, and provider/cancellation propagation.");
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__narrationTestFetch;
}
