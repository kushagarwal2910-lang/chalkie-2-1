import test from "node:test";
import assert from "node:assert/strict";
import {
  visualAgentDecisionSchema,
  inPlaceAnnotationPlanSchema,
  openLibrarySearchPlanSchema,
  canvasConceptFocusPlanSchema,
  normalizedRegionBoxSchema,
  visualAgentDecisionJsonSchema,
} from "./visual-agent-schema.ts";

test("inPlaceAnnotationPlanSchema validates legitimate Route A plan", () => {
  const raw = {
    action: "in_place_image_annotation",
    rationale: "The user is asking about the glomerulus, which is present in the nephron diagram already on canvas.",
    targetImageId: "img-nephron",
    targetFeatureQuery: "glomerulus capillaries",
    shadingColor: "amber",
    drawStyle: "full_annotation",
    calloutLabel: "Glomerulus",
  };
  const parsed = inPlaceAnnotationPlanSchema.parse(raw);
  assert.equal(parsed.action, "in_place_image_annotation");
  assert.equal(parsed.targetImageId, "img-nephron");
  assert.equal(parsed.shadingColor, "amber");
});

test("inPlaceAnnotationPlanSchema rejects conversational callout labels", () => {
  const badLabels = [
    "Point to the cornea",
    "Now draw step by step",
    "Show me the retina",
    "Explain how lens works",
    "Where is the pupil",
    "This is a very long callout label that definitely exceeds twenty eight characters",
    "one two three four five words",
  ];

  for (const label of badLabels) {
    assert.throws(() => {
      inPlaceAnnotationPlanSchema.parse({
        action: "in_place_image_annotation",
        rationale: "Highlighting part",
        targetImageId: "img-1",
        targetFeatureQuery: "cornea",
        shadingColor: "amber",
        drawStyle: "callout_arrow",
        calloutLabel: label,
      });
    }, `Should reject label: ${label}`);
  }
});

test("openLibrarySearchPlanSchema validates legitimate Route B plan", () => {
  const raw = {
    action: "open_library_search",
    rationale: "The user asks how a four-stroke engine works; no engine visual exists on canvas.",
    imageQuery: "four stroke internal combustion engine diagram",
    regionsToLocate: ["piston", "spark plug", "crankshaft", "valves"],
    teachingMode: "sequence",
  };
  const parsed = openLibrarySearchPlanSchema.parse(raw);
  assert.equal(parsed.action, "open_library_search");
  assert.equal(parsed.teachingMode, "sequence");
  assert.equal(parsed.regionsToLocate.length, 4);
});

test("canvasConceptFocusPlanSchema validates legitimate Route C plan", () => {
  const raw = {
    action: "canvas_concept_focus",
    rationale: "Existing cards explain supply and demand curve shifts thoroughly.",
    targetObjectIds: ["card-supply", "card-demand"],
  };
  const parsed = canvasConceptFocusPlanSchema.parse(raw);
  assert.equal(parsed.action, "canvas_concept_focus");
  assert.equal(parsed.targetObjectIds.length, 2);
});

test("visualAgentDecisionSchema parses union actions correctly", () => {
  const decisionA = visualAgentDecisionSchema.parse({
    action: "in_place_image_annotation",
    rationale: "Zooming into existing cell membrane",
    targetImageId: "cell-1",
    targetFeatureQuery: "lipid bilayer",
    shadingColor: "cyan",
    drawStyle: "shade",
    calloutLabel: "Bilayer",
  });
  assert.equal(decisionA.action, "in_place_image_annotation");

  const decisionB = visualAgentDecisionSchema.parse({
    action: "open_library_search",
    rationale: "Need new plant cell diagram",
    imageQuery: "chloroplast structure diagram",
    regionsToLocate: ["thylakoid", "stroma"],
    teachingMode: "reference",
  });
  assert.equal(decisionB.action, "open_library_search");
});

test("normalizedRegionBoxSchema rejects out-of-bounds coordinates", () => {
  assert.throws(() => {
    normalizedRegionBoxSchema.parse({ x: -0.1, y: 0.2, width: 0.5, height: 0.5 });
  });
  assert.throws(() => {
    normalizedRegionBoxSchema.parse({ x: 0.1, y: 1.2, width: 0.5, height: 0.5 });
  });
});

test("scientificGraphPlotPlanSchema validates legitimate Route D graph plan", () => {
  const raw = {
    action: "scientific_graph_plot",
    rationale: "Comparing normal damped oscillation wave against resonant amplification curve",
    graphTitle: "Damped vs Resonant Wave Comparison",
    graphType: "wave-comparison",
    xAxisLabel: "Time (s)",
    yAxisLabel: "Amplitude / Displacement",
    seriesSpec: "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e",
    teachingMode: "comparison",
  };
  const parsed = visualAgentDecisionSchema.parse(raw);
  assert.equal(parsed.action, "scientific_graph_plot");
  if (parsed.action === "scientific_graph_plot") {
    assert.equal(parsed.graphType, "wave-comparison");
    assert.equal(parsed.xAxisLabel, "Time (s)");
    assert.equal(parsed.yAxisLabel, "Amplitude / Displacement");
    assert.ok(parsed.seriesSpec.includes("Damped Wave"));
  }
});

test("visualAgentDecisionJsonSchema adheres to Groq strict schema format", () => {
  const schema = visualAgentDecisionJsonSchema;
  assert.equal(schema.schema.type, "object");
  assert.equal(schema.name, "chalkie_visual_agent_decision");
  assert.equal(schema.strict, true);
  assert.ok(schema.schema.properties.action);
  assert.ok(Array.isArray(schema.schema.required));
  assert.ok(schema.schema.required.includes("action"));
  assert.ok(schema.schema.required.includes("rationale"));
  assert.ok(schema.schema.required.includes("graphType"));
  assert.ok(schema.schema.required.includes("seriesSpec"));
});

