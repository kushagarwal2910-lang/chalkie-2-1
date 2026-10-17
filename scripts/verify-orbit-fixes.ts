/**
 * scripts/verify-orbit-fixes.ts
 *
 * Automated verification suite for the 6 critical production fixes:
 * 1. Beat 1..4 removal & physical unit pronunciation (km/s, J/kg, m/s^2, sqrt)
 * 2. Graph generator explicit coordinates interpolation, Y-axis max around 12, zero "Curve 1" labels
 * 3. Route C vs Route D visual agent dispatch on "Point back to..."
 * 4. Subtitle and narration label sanitization
 */

import assert from "node:assert/strict";
import { generateScientificGraph } from "../lib/graph-generator.ts";
import { sanitizeNarrationForSpeech } from "../lib/local-speech.ts";
import { formatSubtitleForDisplay } from "../lib/math-formatter.ts";
import { readableNarration } from "../lib/narration-labels.ts";
import { routeVisualIntent } from "../lib/visual-agent.ts";
import type { LessonPlan } from "../lib/lesson-schema.ts";

async function runVerification() {
  console.log("===============================================================");
  console.log("  CHALKIE 2.0 ORBIT & COGNITIVE FIXES VERIFICATION");
  console.log("===============================================================\n");

  // --------------------------------------------------------------------------
  // TEST 1: sanitizeNarrationForSpeech & Math Formatter
  // --------------------------------------------------------------------------
  console.log(">>> TEST 1: sanitizeNarrationForSpeech & Unit Pronunciation");
  const testInput = "Beat 1: Look at Velocity (km/s) and J/kg where v = sqrt(2*G*M/r)";
  const spoken = sanitizeNarrationForSpeech(testInput);
  console.log("Input: ", testInput);
  console.log("Spoken:", spoken);

  assert.ok(!/Beat\s+1/i.test(spoken), "Must not contain 'Beat 1'");
  assert.ok(!/Beat\s+(?:one|two|three|four|\d+)/i.test(spoken), "Must not contain any Beat labels");
  assert.ok(spoken.includes("kilometers per second"), "Must pronounce km/s as kilometers per second");
  assert.ok(!spoken.includes("divided by s"), "Must NOT pronounce km/s as divided by s");
  assert.ok(spoken.includes("joules per kilogram"), "Must pronounce J/kg as joules per kilogram");
  assert.ok(!spoken.includes("divided by kg"), "Must NOT pronounce J/kg as divided by kg");
  assert.ok(spoken.includes("the square root of"), "Must convert sqrt(...) to the square root of");

  // Additional units
  const unitsInput = "Acceleration is 9.8 m/s^2, speed is 5 m/s, tension is 20 N/m, angular rate is 3 rad/s.";
  const unitsSpoken = sanitizeNarrationForSpeech(unitsInput);
  console.log("Units spoken:", unitsSpoken);
  assert.ok(unitsSpoken.includes("meters per second squared"), "Must pronounce m/s^2 as meters per second squared");
  assert.ok(unitsSpoken.includes("meters per second"), "Must pronounce m/s as meters per second");
  assert.ok(unitsSpoken.includes("newtons per meter"), "Must pronounce N/m as newtons per meter");
  assert.ok(unitsSpoken.includes("radians per second"), "Must pronounce rad/s as radians per second");

  // Subtitle display test
  const subtitle = formatSubtitleForDisplay("Beat 2: Now look closely at the orbit diagram");
  console.log("Subtitle:", subtitle);
  assert.ok(!/Beat\s+2/i.test(subtitle), "Subtitle must strip 'Beat 2'");

  // readableNarration test
  const readClean = readableNarration("Beat 3: Here is why gravity acts as centripetal force", []);
  console.log("Readable narration:", readClean);
  assert.ok(!/Beat\s+3/i.test(readClean), "readableNarration must strip 'Beat 3'");

  console.log("✓ TEST 1 PASSED: Speech and narration sanitization working perfectly.\n");

  // --------------------------------------------------------------------------
  // TEST 2: Graph Generator Calibration & Zero Curve 1 Labels
  // --------------------------------------------------------------------------
  console.log(">>> TEST 2: Graph Generator Calibration & Zero 'Curve 1' Labels");
  const graphReq = {
    title: "Orbital and Escape Velocity vs Radius",
    graphType: "line-chart",
    xAxisLabel: "Orbital Radius r (in Earth Radii R_E)",
    yAxisLabel: "Velocity (km/s)",
    seriesSpec:
      "Orbital Velocity (km/s): (1, 7.9), (2, 5.6), (4, 3.95), (10, 2.5); Escape Velocity (km/s): (1, 11.2), (2, 7.9), (4, 5.6), (10, 3.54)",
  };

  const graphResult = await generateScientificGraph(graphReq);
  console.log("Graph result dataUrl length:", graphResult.dataUrl.length);
  console.log("Graph result plotMetadata:", JSON.stringify(graphResult.plotMetadata, null, 2));

  assert.ok(graphResult.plotMetadata, "Must return plotMetadata");
  const yMax = graphResult.plotMetadata.yMax;
  console.log(`Computed Y-Axis Maximum: ${yMax}`);
  assert.ok(yMax >= 11.0 && yMax <= 15.0, `Y-axis maximum must be around 12 (was ${yMax}), NOT 70 or 80!`);
  assert.ok(graphResult.plotMetadata.yMin >= 0.0, "Y-axis minimum should start at 0.0 for physical velocity");

  // Verify zero "Curve 1" labels in seriesSummary
  const seriesNames = graphResult.plotMetadata.seriesSummary?.map(s => s.name) || [];
  console.log("Rendered series names:", seriesNames);
  for (const name of seriesNames) {
    assert.ok(!name.includes("Curve 1"), `Series name '${name}' must NOT contain 'Curve 1'`);
    assert.ok(!name.includes("Curve 2"), `Series name '${name}' must NOT contain 'Curve 2'`);
  }

  // Check peak values
  const orbSeries = graphResult.plotMetadata.seriesSummary?.find(s => s.name.includes("Orbital"));
  const escSeries = graphResult.plotMetadata.seriesSummary?.find(s => s.name.includes("Escape"));
  assert.ok(orbSeries, "Must have Orbital Velocity series");
  assert.ok(escSeries, "Must have Escape Velocity series");
  console.log(`Orbital Peak: (${orbSeries.peakX}, ${orbSeries.peakY}) - expected peakY around 7.9`);
  console.log(`Escape Peak: (${escSeries.peakX}, ${escSeries.peakY}) - expected peakY around 11.2`);
  assert.ok(Math.abs(orbSeries.peakY - 7.9) < 0.2, "Orbital peak should be 7.9");
  assert.ok(Math.abs(escSeries.peakY - 11.2) < 0.2, "Escape peak should be 11.2");

  console.log("✓ TEST 2 PASSED: Graph calibration and series names 100% physically accurate.\n");

  // --------------------------------------------------------------------------
  // TEST 3: Visual Agent Route C vs Route D Follow-Up Dispatch
  // --------------------------------------------------------------------------
  console.log(">>> TEST 3: Visual Agent Route C Priority on Follow-Up");
  const mockLesson: LessonPlan = {
    version: 2,
    id: "lesson-test",
    title: "Orbital Mechanics",
    question: "How do satellites stay in orbit?",
    summary: "Balance between gravity and centripetal acceleration",
    diagramType: "structure",
    visualStrategy: "diagram and graph",
    sources: [],
    objects: [
      {
        id: "orbit-diagram",
        label: "Orbit Diagram",
        shapeType: "image",
        role: "subject",
        labelPlacement: "below",
        parts: [],
        x: 64,
        y: 112,
        width: 420,
        height: 380,
        image: {
          id: "img-orbit",
          title: "Orbit Diagram",
          url: "https://example.com/orbit.png",
          sourceUrl: "https://example.com",
          author: "Wikimedia",
          license: "CC-BY-SA",
          licenseUrl: "https://creativecommons.org",
          width: 800,
          height: 600,
          description: "Earth with elliptical satellite orbit",
          regions: [],
          provenance: "retrieved",
        },
      },
      {
        id: "velocity-graph",
        label: "Orbital and Escape Velocity vs Radius",
        shapeType: "image",
        role: "subject",
        labelPlacement: "below",
        parts: [],
        x: 64,
        y: 540,
        width: 420,
        height: 380,
        image: {
          id: "img-graph",
          title: "Velocity vs Distance",
          url: "https://example.com/graph.png",
          sourceUrl: "https://example.com",
          author: "Chalkie",
          license: "CC0",
          licenseUrl: "https://creativecommons.org",
          width: 800,
          height: 520,
          description: "Velocity vs distance graph",
          regions: [],
          provenance: "plot",
        },
      },
    ],
    connections: [],
    segments: [
      {
        id: "step-0",
        title: "Orbital Balance",
        narration: "A satellite is in free fall.",
        action: "reveal",
        targetIds: ["orbit-diagram"],
        cues: [],
        durationMs: 4000,
      },
    ],
  };

  const followUpQuestion =
    "Point back to both the orbit diagram and the velocity graph—what happens if the satellite speeds up?";
  const decision = await routeVisualIntent(followUpQuestion, mockLesson, "satellite speeds up");
  console.log("Follow-up Question:", followUpQuestion);
  console.log("Agent Decision Action:", decision.action);

  assert.strictEqual(
    decision.action,
    "canvas_concept_focus",
    "Must select Route C (canvas_concept_focus) instead of generating redundant graphs!"
  );
  if (decision.action === "canvas_concept_focus") {
    console.log("Agent Target IDs:", decision.targetObjectIds);
    assert.ok(
      decision.targetObjectIds?.includes("orbit-diagram"),
      "Target IDs must include existing orbit diagram"
    );
    assert.ok(
      decision.targetObjectIds?.includes("velocity-graph"),
      "Target IDs must include existing velocity graph"
    );
  }

  console.log("✓ TEST 3 PASSED: Route C correctly selected for pointing back to existing visuals.\n");

  console.log("===============================================================");
  console.log("  ALL TESTS PASSED SUCCESSFULLY!");
  console.log("===============================================================");
}

runVerification().catch(err => {
  console.error("Verification failed with error:", err);
  process.exit(1);
});
