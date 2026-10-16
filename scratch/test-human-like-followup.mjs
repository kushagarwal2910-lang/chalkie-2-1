import assert from "node:assert/strict";
import { compileTeachingPlan, schemaForTeaching } from "../lib/lesson-v2.ts";
import { layoutTeachingScene } from "../lib/teaching-layout.ts";
import { mergeFollowUpLesson } from "../lib/follow-up.ts";

console.log("=== 1. Testing Dynamic Follow-up Step Capacity ===");
const schema = schemaForTeaching(true);
assert.equal(schema.schema.properties.steps.maxItems, 6, "Schema must allow up to 6 steps for follow-ups");
console.log("✔ Schema allows up to 6 steps in follow-ups");

const initialPlan = {
  title: "Reusable Rockets",
  summary: "How rockets launch and land",
  teachingMode: "reference",
  coverage: "append",
  nodes: [
    { id: "rocket-full", kind: "image", label: "Falcon 9 Rocket", imageQuery: "falcon 9 launch", regions: [] },
    { id: "note-intro", kind: "text", label: "Two-stage orbital launch vehicle", imageQuery: "", regions: [] }
  ],
  links: [],
  steps: [
    { title: "Liftoff", narration: "The rocket ignites its first-stage engines.", targetIds: ["rocket-full"] },
    { title: "Ascent", narration: "Nine Merlin engines propel the stack through the dense lower atmosphere.", targetIds: ["note-intro"] }
  ]
};

const initialLesson = compileTeachingPlan(initialPlan, "How Reusable Rockets Work", []);
initialLesson.objects[0].image = {
  id: "img-rocket",
  title: "Falcon 9",
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Rocket.png",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Rocket.png",
  license: "CC0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  author: "SpaceX",
  width: 800,
  height: 600,
  regions: []
};

console.log("=== 2. Testing Follow-up With 4 Detailed Stages ===");
const followup4Stages = {
  title: "Rocket Stages Breakdown",
  summary: "Detailed explanation of each rocket stage",
  teachingMode: "reference",
  coverage: "append",
  nodes: [
    { id: "stage-1-booster", kind: "image", label: "First Stage Booster", imageQuery: "falcon 9 first stage booster", regions: [] },
    { id: "interstage", kind: "text", label: "Pneumatic Stage Separation", imageQuery: "", regions: [] },
    { id: "stage-2-vac", kind: "image", label: "Second Stage Vacuum Engine", imageQuery: "merlin vacuum engine", regions: [] },
    { id: "payload-fairing", kind: "text", label: "Payload Fairing & Deployment", imageQuery: "", regions: [] }
  ],
  links: [
    { from: "stage-1-booster", to: "interstage", label: "disconnects" },
    { from: "interstage", to: "stage-2-vac", label: "ignites" }
  ],
  steps: [
    { title: "Stage 1: Main Booster Burn", narration: "The first stage provides initial thrust for 2.5 minutes before MECO.", targetIds: ["stage-1-booster"] },
    { title: "Interstage: Clean Pneumatic Release", narration: "Pneumatic pushers separate the booster from the second stage in vacuum.", targetIds: ["interstage"] },
    { title: "Stage 2: Vacuum Orbit Insertion", narration: "The single vacuum-optimized Merlin engine burns to reach orbital velocity.", targetIds: ["stage-2-vac"] },
    { title: "Fairing Jettison & Deployment", narration: "Composite fairings split open once atmospheric drag is negligible.", targetIds: ["payload-fairing"] }
  ]
};

const compiledFollowup = compileTeachingPlan(followup4Stages, "Explain each stage of the rocket visually", [], initialLesson);
assert.equal(compiledFollowup.segments.length, 4, "Follow-up MUST retain all 4 stages without being sliced to 2!");
console.log(`✔ Follow-up retained all ${compiledFollowup.segments.length} stages! (No artificial 2-step cap)`);

console.log("=== 3. Testing Layout Non-Overlap Boundaries ===");
compiledFollowup.objects[0].image = {
  id: "img-booster",
  title: "Booster",
  url: "https://upload.wikimedia.org/wikipedia/commons/b/b1/Booster.png",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Booster.png",
  license: "CC0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  author: "SpaceX",
  width: 800,
  height: 600,
  regions: []
};
compiledFollowup.objects[2].image = {
  id: "img-vac",
  title: "Vacuum Engine",
  url: "https://upload.wikimedia.org/wikipedia/commons/c/c2/Vacuum.png",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Vacuum.png",
  license: "CC0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  author: "SpaceX",
  width: 800,
  height: 600,
  regions: []
};

const laidOut = layoutTeachingScene(compiledFollowup);
const images = laidOut.objects.filter(o => o.image);
const notes = laidOut.objects.filter(o => !o.image);

assert.equal(images.length, 2, "Both requested images are present");
assert.equal(notes.length, 2, "Both notes are present");

// Verify that notes do not overlap images in the horizontal dimension
const maxImageRight = Math.max(...images.map(img => img.x + img.width));
for (const note of notes) {
  assert.ok(note.x >= maxImageRight, `Note at ${note.x} must be safely to the right of images (max right: ${maxImageRight})`);
}
console.log(`✔ Notes strictly maintain boundaries: notes begin at x=${notes[0].x}, images end at x=${maxImageRight}`);

console.log("=== 4. Testing Merge With Initial Lesson Board ===");
const merged = mergeFollowUpLesson(initialLesson, {
  id: "followup-stages",
  teachingMode: compiledFollowup.teachingMode,
  title: compiledFollowup.title,
  answer: compiledFollowup.summary,
  coverage: "append",
  targetIds: compiledFollowup.segments.flatMap(s => s.targetIds),
  visualStrategy: compiledFollowup.visualStrategy,
  objects: laidOut.objects,
  connections: laidOut.connections,
  segments: compiledFollowup.segments,
  sources: []
});

assert.equal(merged.lesson.segments.length, initialLesson.segments.length + 4, "Merged lesson includes all 4 follow-up steps");
console.log(`✔ Merged lesson successfully has ${merged.lesson.segments.length} total segments!`);

console.log("\nALL DYNAMIC FOLLOW-UP & BOUNDARY VERIFICATIONS PASSED!");
