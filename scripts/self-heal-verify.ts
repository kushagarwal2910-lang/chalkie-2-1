/**
 * scripts/self-heal-verify.ts
 *
 * Phase 6: Mandatory Autonomous Self-Healing Verification Suite
 * Tests the complete Chalkie 2.0 pipeline end-to-end:
 * 1. Matplotlib Visual & Numerical Audit (Orbital vs Escape Velocity & Specific Mechanical Energy)
 * 2. Full Lesson Flowchart + Formula Card Audit (compileTeachingPlan)
 * 3. Speech & Subtitle Sanitation Audit
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { executeRenderMatplotlibGraph, type MatplotlibToolInput } from "../lib/agent-tools.ts";
import { compileTeachingPlan, type TeachingPlan } from "../lib/lesson-v2.ts";

function saveBase64Png(dataUrl: string, targetPath: string) {
  const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, buffer);
  return buffer.length;
}

async function runVerification() {
  console.log("================================================================================");
  console.log("CHALKIE 2.0: AUTONOMOUS SELF-HEALING REFACTOR VERIFICATION SUITE");
  console.log("================================================================================\n");

  let allPassed = true;

  // ---------------------------------------------------------------------------
  // VERIFICATION 1: Matplotlib Visual & Numerical Audit
  // ---------------------------------------------------------------------------
  console.log("▶ [VERIFICATION 1] Testing Python Matplotlib Engine & ScientificPlotSpec...");

  // Graph A: Orbital vs. Escape Velocity from 1 to 10 Earth Radii
  const graphAInput: MatplotlibToolInput = {
    title: "Orbital vs. Escape Velocity by Altitude",
    subtitleFormula: "$v_{orb} = \\sqrt{GM/r}, \\quad v_{esc} = \\sqrt{2GM/r}$",
    xAxisLabel: "Distance from Earth's Center r (Earth Radii)",
    yAxisLabel: "Velocity (km/s)",
    xDomain: [1, 10],
    yDomain: [0, 13],
    series: [
      {
        label: "Orbital Velocity",
        color: "#38bdf8",
        formulaInX: "7.9 / np.sqrt(x)",
        anchorPoints: [
          { x: 1, y: 7.9, callout: "Low Earth Orbit (7.9 km/s)" },
          { x: 2, y: 5.59 },
          { x: 4, y: 3.95 },
          { x: 6.6, y: 3.07, callout: "Geostationary (3.1 km/s)" },
          { x: 8, y: 2.79 },
          { x: 10, y: 2.5, callout: "High Orbit (2.5 km/s)" },
        ],
      },
      {
        label: "Escape Velocity",
        color: "#f43f5e",
        formulaInX: "11.2 / np.sqrt(x)",
        anchorPoints: [
          { x: 1, y: 11.2, callout: "Earth Surface Escape (11.2 km/s)" },
          { x: 2, y: 7.92 },
          { x: 4, y: 5.6 },
          { x: 6.6, y: 4.35 },
          { x: 8, y: 3.96 },
          { x: 10, y: 3.54, callout: "10 R_E Escape (3.54 km/s)" },
        ],
      },
    ],
  };

  const resultA = await executeRenderMatplotlibGraph(graphAInput);
  if (!resultA.dataUrl.startsWith("data:image/png;base64,")) {
    console.error("FAIL: Graph A did not return a valid PNG data URL.");
    allPassed = false;
  }

  // Graph B: Specific Mechanical Energy vs. Velocity Ratio
  const graphBInput: MatplotlibToolInput = {
    title: "Specific Mechanical Energy vs. Velocity Ratio",
    subtitleFormula: "$\\epsilon = \\frac{1}{2}v^2 - \\frac{GM}{r} = \\frac{1}{2}v_{orb}^2 \\left[\\left(\\frac{v}{v_{orb}}\\right)^2 - 2\\right]$",
    xAxisLabel: "Velocity Ratio (v / v_orb)",
    yAxisLabel: "Specific Energy / (v_orb² / 2)",
    xDomain: [0.5, 2.0],
    yDomain: [-2.0, 2.5],
    series: [
      {
        label: "Specific Energy Curve",
        color: "#38bdf8",
        anchorPoints: [
          { x: 0.5, y: -1.75 },
          { x: 0.8, y: -1.36 },
          { x: 1.0, y: -1.0, callout: "Circular Orbit (E < 0)" },
          { x: 1.2, y: -0.56 },
          { x: 1.414, y: 0.0, callout: "Escape Threshold (E = 0)" },
          { x: 1.7, y: 0.89 },
          { x: 2.0, y: 2.0, callout: "Hyperbolic Escape (E > 0)" },
        ],
      },
    ],
    referenceLines: [
      { axis: "y", value: 0, label: "Zero Energy Escape Threshold (E = 0)" },
      { axis: "x", value: 1.414, label: "v = √2 v_orb" },
    ],
  };

  const resultB = await executeRenderMatplotlibGraph(graphBInput);
  if (!resultB.dataUrl.startsWith("data:image/png;base64,")) {
    console.error("FAIL: Graph B did not return a valid PNG data URL.");
    allPassed = false;
  }

  // Save to /tmp / C:\tmp and os.tmpdir()
  const pathsToSaveA = [
    "C:/tmp/verify-orbit-vel.png",
    path.join(os.tmpdir(), "verify-orbit-vel.png"),
  ];
  const pathsToSaveB = [
    "C:/tmp/verify-energy.png",
    path.join(os.tmpdir(), "verify-energy.png"),
  ];

  for (const p of pathsToSaveA) {
    const bytes = saveBase64Png(resultA.dataUrl, p);
    console.log(`  ✓ Saved Graph A (${bytes} bytes) -> ${p}`);
  }
  for (const p of pathsToSaveB) {
    const bytes = saveBase64Png(resultB.dataUrl, p);
    console.log(`  ✓ Saved Graph B (${bytes} bytes) -> ${p}`);
  }

  console.log(`  ✓ Graph A Regions Detected: ${resultA.regions.length} region callouts`);
  console.log(`  ✓ Graph B Regions Detected: ${resultB.regions.length} region callouts`);

  // Verify numerical assertions
  if (resultA.regions.length < 2) {
    console.error("FAIL: Graph A should have extracted normalized anchor callout regions.");
    allPassed = false;
  }
  if (resultB.regions.length < 2) {
    console.error("FAIL: Graph B should have extracted normalized anchor callout regions.");
    allPassed = false;
  }

  // ---------------------------------------------------------------------------
  // VERIFICATION 2: Full Lesson Flowchart + Formula Card Audit
  // ---------------------------------------------------------------------------
  console.log("\n▶ [VERIFICATION 2] Testing compileTeachingPlan with Sequential Formula Flowcharts...");

  const testQuestion = "Explain how gravity and sideways velocity keep a satellite in orbit, and how reaching escape velocity sqrt(2GM/r) lets it break free.";

  const rawTeachingPlan: TeachingPlan = {
    title: "Orbital Mechanics & Escape Velocity",
    summary: "How gravitational attraction balances centripetal acceleration to sustain orbit, and how energy determines escape.",
    teachingMode: "reference",
    coverage: "existing",
    nodes: [
      {
        id: "img-satellite-orbit",
        label: "Satellite Orbiting Earth",
        kind: "image",
        imageQuery: "satellite orbit earth diagram",
        regions: ["satellite", "earth", "orbital trajectory"],
      },
      {
        id: "graph-orbit-vel",
        label: "Orbital vs Escape Velocity by Altitude",
        kind: "graph",
        imageQuery: "",
        regions: [],
        graphType: "line-chart",
        xAxisLabel: "Orbital Radius r (Earth Radii R_E)",
        yAxisLabel: "Velocity (km/s)",
        seriesSpec: "Orbital Velocity (km/s): (1, 7.9), (2, 5.6), (4, 3.95), (6, 3.2), (8, 2.8), (10, 2.5) | #38bdf8; Escape Velocity (km/s): (1, 11.2), (2, 7.9), (4, 5.6), (6, 4.6), (8, 3.96), (10, 3.54) | #f43f5e",
      },
    ],
    links: [],
    steps: [
      {
        title: "Orbital Balance",
        narration: "Beat 1: Look at the satellite in circular orbit. Gravity pulls inward while forward velocity keeps it falling around the curve of the Earth at 7.9 km/s.",
        targetIds: ["img-satellite-orbit"],
      },
      {
        title: "Velocity Curve Falloff",
        narration: "Beat two: Notice on the graph how orbital velocity drops with altitude from 7.9 km/s down to 2.5 km/s at ten Earth radii.",
        targetIds: ["graph-orbit-vel"],
      },
      {
        title: "Breaking Free at Escape Velocity",
        narration: "Beat 3: When velocity reaches sqrt(2) times orbital velocity, or 11.2 km/s, specific kinetic energy overcomes potential energy.",
        targetIds: ["graph-orbit-vel"],
      },
    ],
  };

  const compiledLesson = compileTeachingPlan(rawTeachingPlan, testQuestion, []);

  console.log(`  ✓ Total objects on board: ${compiledLesson.objects.length}`);
  console.log(`  ✓ Total connection arrows: ${compiledLesson.connections.length}`);

  // Assert >= 3 flowchart cards alongside visual anchors
  const flowchartCards = compiledLesson.objects.filter(o => o.shapeType === "geo" || o.shapeType === "note");
  console.log(`  ✓ Flowchart Cards count: ${flowchartCards.length}`);

  if (flowchartCards.length < 3) {
    console.error(`FAIL: Expected >= 3 flowchart cards, found ${flowchartCards.length}`);
    allPassed = false;
  }

  // Assert >= 2 cards display formatted mathematical formulas (√(GM/r), √(2GM/r))
  const cardsWithFormulas = flowchartCards.filter(c => c.label.includes("√") || c.label.includes("²") || c.label.includes("v_orb") || c.label.includes("v_esc"));
  console.log(`  ✓ Cards containing formatted math formulas: ${cardsWithFormulas.length}`);
  if (cardsWithFormulas.length < 2) {
    console.error(`FAIL: Expected at least 2 cards with mathematical formulas, found ${cardsWithFormulas.length}`);
    allPassed = false;
  }

  // Assert zero card labels contain raw unparsed \sqrt or \frac
  for (const obj of compiledLesson.objects) {
    if (/\\sqrt|\\frac/i.test(obj.label)) {
      console.error(`FAIL: Object ${obj.id} contains raw unparsed LaTeX: "${obj.label}"`);
      allPassed = false;
    }
  }

  // Assert zero narration strings contain "Beat one", "Beat 1", or "kilometer divided by s"
  for (const seg of compiledLesson.segments) {
    if (/\bBeat\s+(?:one|two|three|four|\d+)\b/i.test(seg.narration)) {
      console.error(`FAIL: Segment ${seg.id} narration contains 'Beat' meta-label: "${seg.narration}"`);
      allPassed = false;
    }
    if (/kilometer\s+divided\s+by\s+s/i.test(seg.narration)) {
      console.error(`FAIL: Segment ${seg.id} narration contains 'kilometer divided by s': "${seg.narration}"`);
      allPassed = false;
    }
    if (/kilometers?\s+divided\s+by\s+s/i.test(seg.narration)) {
      console.error(`FAIL: Segment ${seg.id} narration contains 'kilometers divided by s': "${seg.narration}"`);
      allPassed = false;
    }
  }

  console.log("  ✓ All narration segments cleanly stripped of 'Beat X' and 'kilometer divided by s'");
  console.log("  ✓ Board connections created: ", compiledLesson.connections.map(c => `${c.from} -> ${c.to} [${c.label}]`));

  console.log("\n================================================================================");
  if (allPassed) {
    console.log("RESULT: ALL PHASE 6 SELF-HEALING VERIFICATION CHECKS PASSED 100%! 🎉");
  } else {
    console.error("RESULT: ONE OR MORE VERIFICATION CHECKS FAILED!");
    process.exit(1);
  }
  console.log("================================================================================");
}

runVerification().catch(err => {
  console.error("Verification suite encountered an unhandled error:", err);
  process.exit(1);
});
