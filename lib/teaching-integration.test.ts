import test from "node:test";
import assert from "node:assert/strict";
import { compileTeachingPlan, normalizeTeachingPlanForExisting, teachingPlanSchema, type TeachingPlan } from "./lesson-v2.ts";
import { lessonPlanSchema, type FollowUpPlan, type ResearchSource } from "./lesson-schema.ts";
import { createDirectPlotLesson, attachPlot } from "./plot-lesson.ts";
import { plotSpecSchema } from "./plot-tool.ts";
import { normalizeLessonLayout, repairAndValidateLessonPlan } from "./lesson-layout.ts";
import { mergeFollowUpLesson } from "./follow-up.ts";
import { resolveTeachingTarget } from "./teaching-focus.ts";

const plot = plotSpecSchema.parse({ kind: "bar", title: "Values", xLabel: "Year", yLabel: "Count", provenance: "user", series: [{ name: "Count", points: [{ x: 2024, y: 10, label: "2024" }, { x: 2025, y: 15, label: "2025" }] }] });
const existing = () => createDirectPlotLesson("Chart 2024: 10, 2025: 15", plot);
const plan: TeachingPlan = {
  title: "More detail", summary: "Explain the values", coverage: "append", teachingMode: "reference",
  nodes: [{ id: "graph", label: "Values", kind: "plot", imageQuery: "", regions: [], plot }], links: [],
  steps: [{ title: "Growth", narration: "The 2025 count is fifteen.", targetIds: ["graph#series_0_point_1"] }],
};

test("compact planning accepts numeric and Unicode region anchors used by in-place follow-ups", () => {
  for (const target of ["graph#0", "graph#inner_membrane", "graph#आंतरिक_झिल्ली"]) {
    const parsed = teachingPlanSchema.parse({ ...plan, coverage: "existing", nodes: [], steps: [{ ...plan.steps[0], targetIds: [target] }] });
    const compiled = compileTeachingPlan(parsed, "Explain this region", [], existing());
    assert.ok(compiled.segments[0].targetIds.includes(target));
  }
  assert.equal(teachingPlanSchema.safeParse({ ...plan, steps: [{ ...plan.steps[0], targetIds: ["graph##invalid"] }] }).success, false);
});

test("namespace collisions preserve the requested region suffix", () => {
  const compiled = compileTeachingPlan(plan, "Explain the next graph", [], existing());
  assert.equal(compiled.objects[0].id, "graph-detail");
  assert.ok(compiled.segments[0].targetIds.includes("graph-detail#series_0_point_1"));
  attachPlot(compiled.objects[0]);
  assert.ok(resolveTeachingTarget("graph-detail#series_0_point_1", compiled.objects));
});

test("effective follow-up coverage and retrieval nodes match the declarations actually compiled", () => {
  const current = existing();
  const raw: TeachingPlan = { ...plan, coverage: "existing", nodes: [plan.nodes[0], { ...plan.nodes[0], id: "new-graph" }, { id: "new-image", label: "New image", kind: "image", imageQuery: "cell diagram", regions: ["Matrix"] }], steps: [{ ...plan.steps[0], targetIds: ["graph", "new-graph", "new-image"] }] };
  const effective = normalizeTeachingPlanForExisting(raw, current);
  assert.equal(effective.coverage, "append");
  assert.deepEqual(effective.nodes.map(node => node.id), ["new-graph", "new-image"]);
  assert.equal(raw.coverage, "existing", "normalization must not mutate its input");
  const compiled = compileTeachingPlan(effective, "Add detail", [], current);
  assert.deepEqual(compiled.objects.map(object => object.id), effective.nodes.map(node => node.id));
  assert.equal(compiled.objects[1].id, effective.nodes.find(node => node.kind === "image")?.id);
});

test("v2 persistence and layout preserve deterministic plot metadata and pixels", () => {
  const lesson = existing();
  const restored = lessonPlanSchema.parse(JSON.parse(JSON.stringify(lesson)));
  const repaired = repairAndValidateLessonPlan(restored);
  const normalized = normalizeLessonLayout(repaired);
  assert.deepEqual(normalized.objects[0].plot, plot);
  assert.equal(normalized.objects[0].image?.url, lesson.objects[0].image?.url);
  assert.deepEqual(normalized.objects[0].image?.regions, lesson.objects[0].image?.regions);
});

test("layout remaps source and destination cues with object IDs and annotation ownership", () => {
  const lesson = existing();
  const oldId = "chart-" + "long-object-name-".repeat(5);
  const oldAnnotation = "ann-" + "long-annotation-".repeat(5);
  const object = lesson.objects[0];
  object.id = oldId;
  object.annotations = [{ id: oldAnnotation, targetImageId: oldId, regionLabel: "Selected data", normalized: { x: .2, y: .2, width: .1, height: .1 }, color: "cyan", drawStyle: "callout_arrow" }];
  lesson.segments[0] = { ...lesson.segments[0], narration: "Select the data, then compare the years.", targetIds: [`${oldId}#${oldAnnotation}`], cues: [
    { phrase: "Select the data", targetId: `${oldId}#${oldAnnotation}`, kind: "circle" },
    { phrase: "compare the years", targetId: `${oldId}#series_0_point_0`, toTargetId: `${oldId}#series_0_point_1`, kind: "arrow" },
  ] };
  const normalized = normalizeLessonLayout(lesson);
  const next = normalized.objects[0];
  assert.notEqual(next.id, oldId);
  assert.equal(next.annotations?.[0].targetImageId, next.id);
  assert.equal(next.image?.id, object.image?.id, "binary asset IDs remain stable across object renaming");
  for (const cue of normalized.segments[0].cues ?? []) {
    assert.ok(resolveTeachingTarget(cue.targetId, normalized.objects));
    if (cue.toTargetId) assert.ok(resolveTeachingTarget(cue.toTargetId, normalized.objects));
  }
  assert.equal(normalized.segments[0].cues?.length, 2);
});

test("layout drops cues whose phrase is outside the retained narration", () => {
  const lesson = existing();
  lesson.segments[0] = { ...lesson.segments[0], narration: "a".repeat(2400) + " beyond the cap", cues: [{ phrase: "beyond the cap", targetId: "graph#x_axis", kind: "focus" }] };
  const normalized = normalizeLessonLayout(lesson);
  assert.equal(normalized.segments[0].narration.length, 2400);
  assert.deepEqual(normalized.segments[0].cues, []);
});

test("full narration lengths compile without exceeding the persisted duration limit", () => {
  const compiled = compileTeachingPlan({ ...plan, steps: [{ ...plan.steps[0], narration: "The explanation continues. ".repeat(72).slice(0, 1900) }] }, "Explain the graph", []);
  assert.equal(compiled.segments[0].narration.length, 1900);
  assert.equal(compiled.segments[0].durationMs, 120000);
  assert.ok(lessonPlanSchema.safeParse(compiled).success);
});

test("follow-up merge keeps graph data, its rendered image, and remapped teaching cues", () => {
  const current = existing();
  const extension = compileTeachingPlan(plan, "Explain another chart", [], current);
  attachPlot(extension.objects[0]);
  const id = extension.objects[0].id;
  extension.segments[0].cues = [{ phrase: "2025 count", targetId: `${id}#series_0_point_1`, kind: "circle" }];
  const follow: FollowUpPlan = { id: "extension", title: extension.title, answer: extension.summary, coverage: "append", teachingMode: "reference", visualStrategy: "Graph details", targetIds: [id], objects: extension.objects, connections: [], segments: extension.segments, sources: [] };
  const merged = mergeFollowUpLesson(current, follow);
  const added = merged.lesson.objects.find(object => merged.newObjectIds.includes(object.id))!;
  assert.deepEqual(added.plot, plot);
  assert.equal(added.image?.url, extension.objects[0].image?.url);
  const cue = merged.lesson.segments[merged.startIndex].cues?.[0];
  assert.ok(cue);
  assert.ok(resolveTeachingTarget(cue.targetId, merged.lesson.objects));
  assert.equal(current.objects[0].id, "graph");
});

const source = (id: string, url: string): ResearchSource => ({ id, url, title: id, publisher: "Reference", summary: "The referenced dataset contains values 10 and 15.", score: .9 });
function sourcedExtension(current: ReturnType<typeof existing>, incoming: ResearchSource): FollowUpPlan {
  const incomingPlot = { ...plot, provenance: "sourced" as const, sourceIds: [incoming.id] };
  const extension = compileTeachingPlan({ ...plan, nodes: [{ ...plan.nodes[0], plot: incomingPlot }] }, "Explain more data", [incoming], current);
  attachPlot(extension.objects[0], [incoming.id]);
  return { id: "sourced-followup", title: "Additional data", answer: "The count changed.", coverage: "append", teachingMode: "reference", visualStrategy: "Sourced graph", targetIds: extension.segments[0].targetIds, objects: extension.objects, connections: [], segments: extension.segments, sources: [incoming] };
}

test("same-URL source aliases are remapped in the new plot and its rendered attribution", () => {
  const current = existing();
  const original = source("source-1", "https://example.org/data");
  current.sources = [original];
  const alias = source("user-imported-url", original.url);
  const merged = mergeFollowUpLesson(current, sourcedExtension(current, alias));
  const graph = merged.lesson.objects.find(object => merged.newObjectIds.includes(object.id))!;
  assert.deepEqual(graph.plot?.sourceIds, [original.id]);
  assert.equal(merged.lesson.sources.length, 1);
  assert.equal(merged.lesson.sources[0].id, original.id);
  assert.ok(decodeURIComponent(graph.image!.url).includes("Sources: source-1"));
  assert.equal(decodeURIComponent(graph.image!.url).includes("Sources: user-imported-url"), false);
});

test("different source URLs with colliding IDs receive separate cited identities", () => {
  const current = existing();
  current.sources = [source("source-1", "https://example.org/old")];
  current.objects[0].plot = { ...plot, provenance: "sourced", sourceIds: ["source-1"] };
  attachPlot(current.objects[0], ["source-1"]);
  const before = current.objects[0].image!.url;
  const incoming = source("source-1", "https://example.org/new");
  const merged = mergeFollowUpLesson(current, sourcedExtension(current, incoming));
  const graph = merged.lesson.objects.find(object => merged.newObjectIds.includes(object.id))!;
  assert.notEqual(graph.plot!.sourceIds[0], "source-1");
  assert.equal(merged.lesson.sources.find(item => item.id === graph.plot!.sourceIds[0])?.url, incoming.url);
  assert.equal(merged.lesson.objects[0].image!.url, before, "existing plot pixels and citations stay unchanged");
});

test("source cap retains all plotted citations and the newly supplied evidence", () => {
  const current = existing();
  current.sources = Array.from({ length: 20 }, (_, i) => source(`source-${i + 1}`, `https://example.org/${i}`));
  current.objects[0].plot = { ...plot, provenance: "sourced", sourceIds: ["source-20"] };
  attachPlot(current.objects[0], current.sources.map(item => item.id));
  const incoming = source("source-new", "https://example.org/new");
  const merged = mergeFollowUpLesson(current, sourcedExtension(current, incoming));
  assert.equal(merged.lesson.sources.length, 20);
  assert.ok(merged.lesson.sources.some(item => item.id === "source-20"));
  assert.ok(merged.lesson.sources.some(item => item.id === incoming.id));
});
