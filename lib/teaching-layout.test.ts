import test from "node:test";
import assert from "node:assert/strict";
import { compileTeachingPlan, type TeachingPlan } from "./lesson-v2.ts";
import { boardTextLines, layoutTeachingScene, teachingFrameIds } from "./teaching-layout.ts";
import { followUpPlanSchema, lessonPlanSchema, type LessonPlan } from "./lesson-schema.ts";
import { mergeFollowUpLesson } from "./follow-up.ts";
import { getProgressiveVisibleObjects } from "./progressive-scene.ts";

const base: TeachingPlan = { title: "Test lesson", summary: "Test explanation", teachingMode: "reference", coverage: "append", nodes: [
  { id: "reference", kind: "image", label: "Reference", imageQuery: "test diagram", regions: [] },
  { id: "reason", kind: "box", label: "A short explanation", imageQuery: "", regions: [] },
], links: [], steps: [
  { title: "Answer", narration: "Test answer", targetIds: ["reason"] },
  { title: "Explain", narration: "Test explanation", targetIds: ["reference"] },
] };
function withImage(lesson: LessonPlan) {
  lesson.objects[0].image = { id: "test-image", title: "Reference", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.png", sourceUrl: "https://commons.wikimedia.org/wiki/File:Test.png", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", author: "Test", width: 1000, height: 600, regions: [] };
  return lesson;
}

test("reference appears with the first explanation and persists across teaching steps", () => {
  const lesson = compileTeachingPlan(base, "Test question", []);
  assert.deepEqual(lesson.segments[0].targetIds, ["reference", "reason"]);
  assert.ok(getProgressiveVisibleObjects(lesson, 0, true).some(o => o.id === "reference"));
  assert.equal(lessonPlanSchema.parse(lesson).teachingMode, "reference");
  const existing = withImage(lesson);
  const followup = compileTeachingPlan({ ...base, coverage: "existing", nodes: [], steps: [{ ...base.steps[0], targetIds: ["reference"] }, { ...base.steps[1], targetIds: ["reason"] }] }, "Test doubt", [], existing);
  assert.ok(followup.segments.every(step => step.targetIds.includes("reference")));
});

test("reference layout uses a prominent image and non-overlapping borderless notes", () => {
  const raw = withImage(compileTeachingPlan(base, "Test question", []));
  const plan = layoutTeachingScene(raw);
  const [image, note] = plan.objects;
  assert.equal(note.shapeType, "note");
  assert.ok(note.x >= image.x + image.width + 40);
  assert.equal(image.width, 640);
  assert.equal(raw.objects[1].shapeType, "geo", "Layout must not mutate cached input");
});

test("comparisons keep paired observations aligned instead of forming a chain", () => {
  const nodes = Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, column: i % 2 ? "right" as const : "left" as const, kind: "text" as const, label: `Criterion ${Math.floor(i / 2)} alternative ${i % 2}`, imageQuery: "", regions: [] }));
  const lesson = compileTeachingPlan({ ...base, teachingMode: "comparison", nodes, steps: [{ title: "Compare", narration: "Compare the alternatives", targetIds: nodes.map(n => n.id) }] }, "Compare these", []);
  const { objects } = layoutTeachingScene(lesson);
  assert.equal(objects[0].y, objects[1].y);
  assert.equal(objects[2].y, objects[3].y);
  assert.equal(objects[0].x, objects[2].x);
  assert.ok(objects[2].y > objects[0].y + objects[0].height);
});

test("worked examples preserve line breaks and reserve room for wrapped text", () => {
  const nodes = ["first", "second"].map(id => ({ id, kind: "text" as const, label: `An intentionally long handwritten explanation with a second line\nx = 12`, imageQuery: "", regions: [] }));
  const lesson = compileTeachingPlan({ ...base, teachingMode: "worked-example", nodes, steps: [{ title: "Work", narration: "Test calculation", targetIds: nodes.map(n => n.id) }] }, "Work this example", []);
  const { objects } = layoutTeachingScene(lesson);
  assert.ok(boardTextLines(objects[0]).includes("x = 12"));
  assert.ok(objects[1].y > objects[0].y + objects[0].height);
  assert.ok(objects.every(object => object.shapeType === "note"));
});

test("appending a laid-out follow-up preserves the board and translates its routed arrows", () => {
  const current = layoutTeachingScene(withImage(compileTeachingPlan(base, "Test question", [])));
  const objects = current.objects.map((o, i) => ({ ...o, id: `new-${i}`, x: 64 + i * 400, y: 112 }));
  const plan = followUpPlanSchema.parse({ id: "follow", teachingMode: "reference", title: "Detail", answer: "More detail", coverage: "append", visualStrategy: "Explain", objects, targetIds: [objects[0].id], connections: [{ id: "new-link", from: objects[0].id, to: objects[1].id, label: "causes", points: [{ x: 100, y: 150 }, { x: 500, y: 150 }] }], segments: [{ id: "s", title: "Detail", narration: "Test detail", targetIds: [objects[0].id] }] });
  const merged = mergeFollowUpLesson(current, plan);
  assert.deepEqual(merged.lesson.objects.slice(0, current.objects.length), current.objects);
  const appended = merged.lesson.objects[current.objects.length];
  const offset = appended.x - objects[0].x;
  assert.equal(merged.lesson.connections.at(-1)?.points?.[0].x, 100 + offset);
  assert.equal(merged.lesson.segments.at(-1)?.targetIds[0], appended.id);
  assert.ok(appended.image);
});

test("camera frames the teaching group and resolves image regions to their parent image", () => {
  const lesson = compileTeachingPlan(base, "Test", []);
  assert.deepEqual([...teachingFrameIds(lesson, ["reference#0", "reason"])], ["reference", "reason"]);
});

test("a follow-up ID collision cannot overwrite or silently drop a new image", () => {
  const current = withImage(compileTeachingPlan(base, "Test", []));
  const followup = compileTeachingPlan(base, "New detail", [], current);
  const fresh = followup.objects.find(object => object.shapeType === "image")!;
  assert.notEqual(fresh.id, "reference");
  assert.equal(followup.segments[0].targetIds[0], fresh.id);
  assert.equal(current.objects[0].id, "reference");
  assert.ok(current.objects[0].image);
});

test("merging a follow-up preserves region target IDs (#regionIndex) for vision outlines", () => {
  const current = layoutTeachingScene(withImage(compileTeachingPlan(base, "Base topic", [])));
  const imgObj = {
    ...current.objects[0],
    id: "detail-image",
    image: {
      ...current.objects[0].image!,
      id: "img-detail",
      regions: [{ label: "Beta cells", x: 0.2, y: 0.3, width: 0.4, height: 0.4, confidence: 0.95 }],
    },
  };
  const plan = followUpPlanSchema.parse({
    id: "fu-regions",
    teachingMode: "reference",
    title: "Detail",
    answer: "Focusing on beta cells",
    coverage: "append",
    visualStrategy: "Explain",
    objects: [imgObj],
    targetIds: ["detail-image#0"],
    connections: [],
    segments: [{ id: "seg-fu", title: "Beta cells detail", narration: "Observe the beta cells in the islet.", targetIds: ["detail-image#0"] }],
  });
  const merged = mergeFollowUpLesson(current, plan);
  const appended = merged.lesson.objects.find(o => o.id.includes("detail-image"))!;
  assert.ok(appended, "Appended image object must exist");
  assert.equal(merged.lesson.segments.at(-1)?.targetIds[0], `${appended.id}#0`, "Target ID must preserve #0 region index");
});

test("mergeFollowUpLesson strictly freezes existing object coordinates and avoids margin callout collisions", () => {
  const current = layoutTeachingScene(withImage(compileTeachingPlan(base, "Base topic", [])));
  // Add right-margin annotation to the hero image
  current.objects[0].annotations = [{
    id: "ann-lens",
    targetImageId: current.objects[0].id,
    regionLabel: "Crystalline Lens",
    normalized: { x: 0.7, y: 0.5, width: 0.2, height: 0.2 },
    color: "amber",
    drawStyle: "callout_arrow",
    calloutText: "Crystalline Lens",
  }];

  const initialCoordinates = current.objects.map(o => ({ id: o.id, x: o.x, y: o.y, width: o.width, height: o.height }));

  const plan = followUpPlanSchema.parse({
    id: "fu-seq",
    teachingMode: "sequence",
    title: "Light Pathway Sequence",
    answer: "Light enters the cornea...",
    coverage: "append",
    visualStrategy: "Sequence",
    objects: [{
      id: "stage-cornea",
      role: "component",
      shapeType: "note",
      label: "Stage 1: Cornea refraction",
      x: 0,
      y: 0,
      width: 380,
      height: 100,
      parts: [],
    }],
    targetIds: ["stage-cornea"],
    connections: [],
    segments: [{ id: "seg-1", title: "Cornea", narration: "Light enters through cornea.", targetIds: ["stage-cornea"] }],
  });

  const merged = mergeFollowUpLesson(current, plan);

  // Existing objects MUST have 100% frozen coordinates
  merged.lesson.objects.slice(0, current.objects.length).forEach((obj, idx) => {
    assert.equal(obj.x, initialCoordinates[idx].x, `Object ${obj.id} x must remain frozen`);
    assert.equal(obj.y, initialCoordinates[idx].y, `Object ${obj.id} y must remain frozen`);
    assert.equal(obj.width, initialCoordinates[idx].width, `Object ${obj.id} width must remain frozen`);
    assert.equal(obj.height, initialCoordinates[idx].height, `Object ${obj.id} height must remain frozen`);
  });

  // Appended object must be placed past existing objects AND margin callout badge with +220px gap
  const appended = merged.lesson.objects.find(o => o.id.includes("stage-cornea"))!;
  assert.ok(appended, "Appended object must exist");
  const rightMarginBadgeEdge = current.objects[0].x + current.objects[0].width + 36 + Math.min(220, Math.max(90, Math.round("Crystalline Lens".length * 8.2 + 26)));
  const rightMostBoundary = Math.max(...current.objects.map(o => o.x + o.width), rightMarginBadgeEdge);
  assert.ok(appended.x >= rightMostBoundary + 220, `Appended x (${appended.x}) must be >= rightMostBoundary + 220 (${rightMostBoundary + 220})`);
});

test("cards have minimum width of 380px and wrap cleanly without clipping labels", () => {
  const nodes = [
    { id: "c1", kind: "text" as const, label: "Lens - fine-tunes focus", imageQuery: "", regions: [] },
    { id: "c2", kind: "text" as const, label: "Retina - light-sensitive screen", imageQuery: "", regions: [] },
  ];
  const lesson = compileTeachingPlan({
    ...base,
    teachingMode: "reference",
    nodes,
    steps: [{ title: "Eye parts", narration: "Explaining eye parts", targetIds: nodes.map(n => n.id) }],
  }, "How does the eye focus?", []);

  const laidOut = layoutTeachingScene(lesson);
  const cards = laidOut.objects.filter(o => !o.image);

  for (const card of cards) {
    assert.ok(card.width >= 380, `Card ${card.id} width (${card.width}) must be >= 380px`);
    const lines = boardTextLines(card);
    for (const line of lines) {
      assert.ok(line.length <= 32, `Line "${line}" length (${line.length}) should not exceed 32 characters`);
    }
  }

  // Specifically check "Lens - fine-tunes focus" and "Retina - light-sensitive screen"
  const lensCard = cards.find(c => c.label.includes("Lens"))!;
  const retinaCard = cards.find(c => c.label.includes("Retina"))!;
  assert.ok(lensCard.width >= 380);
  assert.ok(retinaCard.width >= 380);
  const retinaLines = boardTextLines(retinaCard);
  assert.ok(retinaLines.length >= 2, "Retina label should wrap onto 2 lines cleanly");
});

