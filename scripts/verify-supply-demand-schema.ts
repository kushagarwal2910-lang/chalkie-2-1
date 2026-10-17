import assert from "node:assert/strict";
import { visualObjectSchema, lessonPlanSchema } from "../lib/lesson-schema.ts";

console.log("Testing supply and demand plot schema resilience...");

// Case 1: Python Matplotlib graph object with plotMetadata and no plot
const graphNode = {
  id: "supply-demand-graph",
  label: "Supply and Demand Equilibrium",
  role: "subject",
  shapeType: "image",
  labelPlacement: "inside",
  color: "violet",
  x: 0,
  y: 0,
  width: 720,
  height: 468,
  parts: [],
  annotations: [],
  image: {
    id: "graph-sd",
    title: "Supply and Demand",
    url: "https://example.com/plot.png",
    sourceUrl: "https://chalkie.local/scientific-graph",
    author: "Chalkie",
    license: "Computed",
    licenseUrl: "https://chalkie.local",
    width: 720,
    height: 468,
    regions: [],
    provenance: "plot",
  },
  plotMetadata: {
    xMin: 0,
    xMax: 100,
    yMin: 0,
    yMax: 50,
    seriesSummary: [
      { name: "Supply", peakX: 100, peakY: 50 },
      { name: "Demand", peakX: 0, peakY: 50 },
    ],
  },
};

const parsed1 = visualObjectSchema.parse(graphNode);
assert.strictEqual(parsed1.id, "supply-demand-graph");
assert.strictEqual(parsed1.plot, undefined);
assert.ok(parsed1.plotMetadata);
console.log("✓ Case 1 passed: graphNode with plotMetadata parses cleanly without plot.kind error");

// Case 2: Object with malformed/partial plot property (missing kind/title)
const corruptedNode = {
  ...graphNode,
  id: "corrupted-plot-node",
  plot: {
    plotMetadata: { xMin: 0, xMax: 10 },
    xMin: 0,
    xMax: 10,
    yMin: 0,
    yMax: 20,
  },
};

const parsed2 = visualObjectSchema.parse(corruptedNode);
assert.strictEqual(parsed2.plot, undefined, "Malformed plot without valid kind must be safely dropped to undefined");
console.log("✓ Case 2 passed: corrupted plot missing kind is safely dropped without Zod error");

// Case 3: Complete lesson plan containing both graph and concept cards
const fullLesson = {
  version: 2,
  id: "lesson-sd-123",
  title: "Supply and Demand Dynamics",
  question: "explain me supply and demand",
  summary: "Equilibrium where quantity supplied equals quantity demanded",
  diagramType: "quantitative",
  visualStrategy: "Graph and flowcards",
  sources: [],
  objects: [parsed1, parsed2],
  connections: [],
  segments: [
    {
      id: "step-0",
      title: "Market Equilibrium",
      narration: "The intersection determines market price.",
      targetIds: ["supply-demand-graph"],
      cues: [],
      durationMs: 4000,
    },
  ],
};

const parsedLesson = lessonPlanSchema.parse(fullLesson);
assert.strictEqual(parsedLesson.objects.length, 2);
console.log("✓ Case 3 passed: lessonPlanSchema parses full lesson successfully");

console.log("\nALL SCHEMA RESILIENCE TESTS PASSED!");
