import assert from "node:assert";
import { computeTargetPositions } from "../lib/target-matcher.ts";
import { teachingPlanSchema, compileTeachingPlan } from "../lib/lesson-v2.ts";

console.log("=== Testing 110% Audio-Visual Precision & Offline Classroom Pedagogy ===");

// 1. Test Acronym and Prefix Target Matching
const mockObjects = [
  {
    id: "rocket-image",
    role: "subject",
    shapeType: "image",
    label: "Falcon 9 Staging",
    x: 100, y: 100, width: 480, height: 320,
    parts: [],
    image: {
      id: "img-1", title: "Rocket", url: "https://example.com/rocket.png",
      width: 800, height: 600,
      regions: [
        { label: "Interstage Fairing", x: 0.4, y: 0.3, width: 0.2, height: 0.15, confidence: 0.95 },
        { label: "Merlin Vacuum Engine (M-Vac)", x: 0.42, y: 0.45, width: 0.16, height: 0.2, confidence: 0.98 }
      ]
    },
    annotations: [
      {
        id: "ann-interstage",
        regionLabel: "Interstage Fairing",
        calloutText: "Interstage Fairing (Separation Ring)",
        normalized: { x: 0.4, y: 0.3, width: 0.2, height: 0.15 },
        color: "amber"
      }
    ]
  },
  {
    id: "stage-meco",
    role: "component",
    shapeType: "geo",
    label: "2. Main Engine Cut-Off (MECO)",
    x: 650, y: 100, width: 260, height: 120,
    parts: [
      { text: "Nine Merlin 1D engines shutdown", data: "shutdown" },
      { text: "Vehicle coasts in vacuum", data: "coast" }
    ]
  },
  {
    id: "stage-sep",
    role: "component",
    shapeType: "geo",
    label: "3. Pneumatic Separation",
    x: 650, y: 260, width: 260, height: 120,
    parts: [
      { text: "Pneumatic pushers deploy", data: "pushers" }
    ]
  }
];

const mockConnections = [
  { id: "conn-1", from: "stage-meco", to: "stage-sep", label: "triggers staging", color: "slate", route: "elbow", fromAnchor: "bottom", toAnchor: "top", arrowhead: "arrow", bend: 0 }
];

// Test A: Spoken narration with acronym "MECO"
const narration1 = "To understand how rockets reach orbit, we first observe Main Engine Cut-Off, commonly known as MECO. At this instant, the first stage shuts down all nine engines to prevent structural overload.";
const cues1 = computeTargetPositions(narration1, ["stage-meco"], mockObjects, mockConnections);

console.log("Cues for narration 1 (MECO & Staging):", cues1);
assert.ok(cues1.length > 0, "Should generate cues");
assert.equal(cues1[0].charIndex, 0, "Must start at syllable 0 on primary target");
assert.equal(cues1[0].targetId, "stage-meco", "Must start on stage-meco");

// Test A2: If only the acronym is spoken
const narration1b = "At T plus two minutes, MECO occurs and the engines shut down.";
const cues1b = computeTargetPositions(narration1b, ["stage-meco"], mockObjects, mockConnections);
console.log("Cues for narration 1b (acronym-only):", cues1b);
assert.ok(cues1b.some(c => c.matchedToken.toLowerCase() === "meco"), "Must match parenthetical acronym 'MECO'");

// Test B: VLM region with acronym "M-Vac"
const narration2 = "Look inside the interstage fairing where the Merlin Vacuum Engine, or M-Vac, is sheltered until stage separation.";
const cues2 = computeTargetPositions(narration2, ["rocket-image"], mockObjects, mockConnections);

console.log("Cues for narration 2 (Interstage & M-Vac):", cues2);
assert.ok(cues2.some(c => c.targetId === "rocket-image#0" || c.targetId === "rocket-image#ann-interstage"), "Must match Interstage");
assert.ok(cues2.some(c => c.targetId === "rocket-image#1"), "Must match M-Vac VLM region");

// Test C: Bullet points inside card
const narration3 = "Notice the pneumatic pushers deploy to gently push the two stages apart in microgravity.";
const cues3 = computeTargetPositions(narration3, ["stage-sep"], mockObjects, mockConnections);
console.log("Cues for narration 3 (Pneumatic pushers):", cues3);
assert.ok(cues3.some(c => c.targetId === "stage-sep#0"), "Must match exact bullet line in card");

// Test D: Connection transition
const narration4 = "This critical command immediately triggers staging between the booster and the upper stage.";
const cues4 = computeTargetPositions(narration4, ["stage-meco"], mockObjects, mockConnections);
console.log("Cues for narration 4 (Triggers staging):", cues4);
assert.ok(cues4.some(c => c.targetId === "conn-1"), "Must match flowchart connector arrow transition");

// Test E: Zero-drift fallback when words are general (NO random mid-sentence jumping!)
const narration5 = "During this initial period, intense physical forces are felt.";
const cues5 = computeTargetPositions(narration5, ["stage-meco", "stage-sep"], mockObjects, mockConnections);
console.log("Cues for narration 5 (Fallback without random hopping):", cues5);
assert.equal(cues5.length, 1, "Must have exactly 1 stable anchor, zero random hops!");
assert.equal(cues5[0].charIndex, 0, "Anchored at 0");
assert.equal(cues5[0].targetId, "stage-meco", "Anchored steadily on primary target");

// Test F: Deep Master Educator Lesson Schema Validation (rich in-depth narration)
const deepPlan = {
  title: "Cellular Respiration Masterclass",
  summary: "A comprehensive classroom journey from glucose glycolysis to mitochondrial ATP synthesis.",
  teachingMode: "sequence",
  coverage: "append",
  nodes: [
    { id: "glycolysis", label: "1. Cytoplasmic Glycolysis", kind: "box", column: "full", imageQuery: "", regions: [] },
    { id: "krebs", label: "2. Krebs Citric Acid Cycle", kind: "box", column: "full", imageQuery: "", regions: [] }
  ],
  links: [
    { from: "glycolysis", to: "krebs", label: "pyruvate enters matrix" }
  ],
  steps: [
    {
      title: "Foundations of Glycolysis: Splitting the Sugar",
      narration: "Imagine you are holding a single molecule of glucose, which is a six-carbon sugar packed with stored chemical energy. In the very first stage, called glycolysis, the cell does not even require oxygen yet; this entire reaction takes place directly inside the watery cytoplasm. Here, a cascade of specific biological enzymes physically snaps that six-carbon ring in half, producing two smaller three-carbon molecules known as pyruvate. Along the way, the cell invests two initial ATP molecules like starter capital, but in return nets four ATP molecules and two high-energy electron carriers called NADH, yielding a net positive energy balance for the cell.",
      targetIds: ["glycolysis"]
    }
  ]
};

const parsed = teachingPlanSchema.parse(deepPlan);
console.log("Deep Plan Narration length:", parsed.steps[0].narration.length);
assert.ok(parsed.steps[0].narration.length > 500, "Deep narration easily accommodated");

console.log("All precision and pedagogy tests PASSED successfully!");
