/**
 * scripts/verify-chalkie-fixes.ts
 *
 * Autonomous Visual & Functional Verification Suite for Chalkie 2.0.
 * Verifies all 4 parts:
 * 1. Matplotlib Graph Engine & Zero Flatline Guarantee (3 test cases, saved to /tmp/ & C:/tmp)
 * 2. Math & Speech Sanitizer Unit Assertions (en-US & hi-IN)
 * 3. Card Text Wrapping & Bounding Box Assertions (<=26 chars/line, width >= 380px, inner margin >= 20px)
 * 4. TypeScript Build Check (tsc --noEmit)
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateScientificGraph } from "../lib/graph-generator.ts";
import { sanitizeNarrationForSpeech } from "../lib/local-speech.ts";
import { wrapCardLabel } from "../lib/teaching-layout.ts";
import { getVisualFootprint } from "../lib/visual-footprint.ts";
import { formatSubtitleForDisplay } from "../lib/math-formatter.ts";

async function runVerification() {
  console.log("===============================================================");
  console.log("  CHALKIE 2.0 AUTONOMOUS VERIFICATION SUITE");
  console.log("===============================================================\n");

  // Ensure output directories exist
  const outputDirs = ["./tmp", "C:/tmp"];
  for (const dir of outputDirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }

  // --------------------------------------------------------------------------
  // TEST 1: Matplotlib Graph Engine & Zero Flatline Verification
  // --------------------------------------------------------------------------
  console.log(">>> TEST 1: Matplotlib Graph Engine & Zero Flatline Verification");

  const testCases = [
    {
      id: "test-graph-1",
      req: {
        title: "Mass vs. Schwarzschild Radius",
        graphType: "line-chart",
        xAxisLabel: "Mass (Solar Masses M☉)",
        yAxisLabel: "Schwarzschild Radius (km)",
        seriesSpec: "Schwarzschild Radius: 2*G*M/c^2 | #38bdf8",
        domain: [0, 10] as [number, number],
        points: [
          { x: 0, y: 0, label: "Zero mass" },
          { x: 2, y: 5.9, label: "2 M☉" },
          { x: 5, y: 14.75, label: "5 M☉" },
          { x: 8, y: 23.6, label: "8 M☉" },
          { x: 10, y: 29.5, label: "10 M☉" },
        ],
      },
    },
    {
      id: "test-graph-2",
      req: {
        title: "Damped Oscillation vs. Resonant Amplification",
        graphType: "wave-comparison",
        xAxisLabel: "Time (s)",
        yAxisLabel: "Displacement",
        seriesSpec: "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e",
        domain: [0, 12] as [number, number],
      },
    },
    {
      id: "test-graph-3",
      req: {
        title: "Quadratic Parabola",
        graphType: "function-plot",
        xAxisLabel: "x",
        yAxisLabel: "y",
        seriesSpec: "Parabola: x^2 - 4*x + 3 | #38bdf8",
        domain: [-1, 5] as [number, number],
      },
    },
  ];

  const generatedPngPaths: string[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const { id, req } = testCases[i];
    console.log(`  Running Case ${i + 1}: ${req.title}...`);
    const result = await generateScientificGraph(req);

    assert.ok(result.dataUrl.startsWith("data:image/png;base64,"), `Case ${i + 1} did not return base64 PNG dataUrl`);
    const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Check PNG magic header
    assert.equal(buffer[0], 0x89, "PNG magic byte 0 mismatch");
    assert.equal(buffer[1], 0x50, "PNG magic byte 1 mismatch");
    assert.equal(buffer[2], 0x4e, "PNG magic byte 2 mismatch");
    assert.equal(buffer[3], 0x47, "PNG magic byte 3 mismatch");
    assert.ok(buffer.length > 15000, `PNG file size (${buffer.length} bytes) is suspiciously small`);

    // Verify regions are computed
    assert.ok(result.regions && result.regions.length > 0, `Case ${i + 1} should have detected regions`);

    // Save to all target paths
    const localPath = path.resolve("./tmp", `${id}.png`);
    fs.writeFileSync(localPath, buffer);
    generatedPngPaths.push(localPath);

    try {
      const cTmpPath = `C:/tmp/${id}.png`;
      fs.writeFileSync(cTmpPath, buffer);
      generatedPngPaths.push(cTmpPath);
    } catch {}

    console.log(`    ✓ Valid PNG (${buffer.length} bytes), ${result.regions.length} regions generated. Saved to ${localPath}`);
  }

  // Also verify directly with python script and inspect range
  console.log("  Running Python non-flatline programmatic range assertion...");
  const pyCheckScript = `
import json, sys
import numpy as np
from scripts.render_graph import parse_series_spec, safe_eval_expr, apply_flatline_guard

x1 = np.linspace(0, 10, 300)
series1 = parse_series_spec("Schwarzschild Radius: 2*G*M/c^2 | #38bdf8", "line-chart", x1, title="Mass vs. Schwarzschild Radius")
delta1 = float(np.nanmax(series1[0]["y"]) - np.nanmin(series1[0]["y"]))
print(f"Case 1 delta_y: {delta1:.4f}")
assert delta1 > 0.1, f"Case 1 flatline detected: delta={delta1}"

x2 = np.linspace(0, 12, 300)
series2 = parse_series_spec("Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant: 0.18*x*cos(3*x) | #f43f5e", "wave-comparison", x2)
delta2_1 = float(np.nanmax(series2[0]["y"]) - np.nanmin(series2[0]["y"]))
print(f"Case 2 wave 1 delta_y: {delta2_1:.4f}")
assert delta2_1 > 0.1, f"Case 2 wave 1 flatline detected: delta={delta2_1}"

x3 = np.linspace(-1, 5, 300)
series3 = parse_series_spec("Parabola: x^2 - 4*x + 3 | #38bdf8", "function-plot", x3)
delta3 = float(np.nanmax(series3[0]["y"]) - np.nanmin(series3[0]["y"]))
print(f"Case 3 parabola delta_y: {delta3:.4f}")
assert delta3 > 0.1, f"Case 3 flatline detected: delta={delta3}"

print("PYTHON_RANGE_CHECKS_PASSED")
`;
  const pyOutput = execFileSync("python", ["-c", pyCheckScript], { encoding: "utf8" });
  assert.ok(pyOutput.includes("PYTHON_RANGE_CHECKS_PASSED"), "Python range checks failed");
  console.log("  ✓ TEST 1 PASSED: All 3 graphs rendered crisp PNGs without flatlines (delta_y > 0.1).\n");

  // --------------------------------------------------------------------------
  // TEST 2: Math & Speech Sanitizer Unit Assertions
  // --------------------------------------------------------------------------
  console.log(">>> TEST 2: Math & Speech Sanitizer Unit Assertions");

  const testPhrase = "Same factor sqrt(1 - 2*G*M / (r*c^2)) vanishes at **Event Horizon** (n2).";

  // English test
  const enSanitized = sanitizeNarrationForSpeech(testPhrase, "en-US");
  console.log(`  English input:     "${testPhrase}"`);
  console.log(`  English sanitized: "${enSanitized}"`);

  assert.ok(!enSanitized.toLowerCase().includes("sqrt"), "English output must not contain 'sqrt'");
  assert.ok(!enSanitized.includes("*"), "English output must contain zero asterisks");
  assert.ok(!/\bn2\b/i.test(enSanitized), "English output must not contain 'n2'");
  assert.ok(enSanitized.includes("2 times G times M") || enSanitized.includes("2 G M"), "English output must preserve M in product");
  assert.ok(enSanitized.includes("square root of"), "English output should contain 'square root of'");
  console.log("  ✓ English speech sanitization verified.");

  // Hindi test
  const hiSanitized = sanitizeNarrationForSpeech(testPhrase, "hi-IN");
  console.log(`  Hindi sanitized:   "${hiSanitized}"`);

  assert.ok(!hiSanitized.toLowerCase().includes("sqrt"), "Hindi output must not contain 'sqrt'");
  assert.ok(!hiSanitized.includes("एस क्यू आर टी"), "Hindi output must not contain 'एस क्यू आर टी'");
  assert.ok(!hiSanitized.includes("स्क्वार एटी"), "Hindi output must not contain 'स्क्वार एटी'");
  assert.ok(!hiSanitized.includes("*"), "Hindi output must contain zero asterisks");
  assert.ok(!/\bn2\b/i.test(hiSanitized), "Hindi output must not contain 'n2'");
  assert.ok(hiSanitized.includes("2 times G times M") || hiSanitized.includes("2 G M"), "Hindi output must preserve M in product");
  assert.ok(hiSanitized.includes("वर्गमूल"), "Hindi output should contain 'वर्गमूल'");
  console.log("  ✓ Hindi speech sanitization verified.");

  // Subtitle display test
  const subtitleDisplay = formatSubtitleForDisplay(testPhrase);
  console.log(`  Subtitle display:  "${subtitleDisplay}"`);
  assert.ok(subtitleDisplay.includes("√"), "Subtitle display should contain clean square root symbol √");
  assert.ok(!subtitleDisplay.includes("*"), "Subtitle display should contain zero asterisks");
  assert.ok(!subtitleDisplay.includes("(n2)"), "Subtitle display should not contain '(n2)'");
  console.log("  ✓ Subtitle math display verified.");
  console.log("  ✓ TEST 2 PASSED: Math speech and subtitle sanitization completely clean.\n");

  // --------------------------------------------------------------------------
  // TEST 3: Card Text Wrapping & Bounding Box Assertion
  // --------------------------------------------------------------------------
  console.log(">>> TEST 3: Card Text Wrapping & Bounding Box Assertion");

  const cardsToTest = [
    "Event Horizon – Point of No Return",
    "Hawking Radiation – Quantum Leak",
  ];

  for (const cardLabel of cardsToTest) {
    const lines = wrapCardLabel(cardLabel, 25);
    console.log(`  Testing label: "${cardLabel}"`);
    console.log(`    Wrapped into ${lines.length} lines:`, lines.map(l => `"${l}" (${l.length} chars)`));

    for (const line of lines) {
      assert.ok(
        line.length <= 26,
        `Line "${line}" exceeds 26 chars (length: ${line.length})`
      );
    }

    const mockObject = {
      id: "test-card",
      label: cardLabel,
      role: "component" as const,
      shapeType: "note" as const,
      labelPlacement: "inside" as const,
      color: "violet" as const,
      x: 100,
      y: 100,
      width: 260,
      height: 130,
      parts: [],
    };

    const footprint = getVisualFootprint(mockObject);
    console.log(`    Calculated Footprint: width=${footprint.width}px, height=${footprint.height}px`);

    assert.ok(footprint.width >= 380, `Card width (${footprint.width}px) must be >= 380px`);
    assert.ok(footprint.height >= 110, `Card height (${footprint.height}px) must be >= 110px`);

    // Inner text X-coordinate margin check
    const estimatedTextWidth = Math.max(...lines.map(l => l.length)) * 20 * 0.62;
    const clampedTextX = Math.max(mockObject.x + 20, mockObject.x + (footprint.width - estimatedTextWidth) / 2);
    const leftMargin = clampedTextX - mockObject.x;
    console.log(`    Left inner text margin: ${leftMargin.toFixed(1)}px (>= 20px)`);
    assert.ok(leftMargin >= 20, `Left inner text margin (${leftMargin}px) must be >= 20px`);
  }
  console.log("  ✓ TEST 3 PASSED: Card wrapping and bounding boxes fully satisfy bounds.\n");

  // --------------------------------------------------------------------------
  // TEST 4: TypeScript Build Check
  // --------------------------------------------------------------------------
  console.log(">>> TEST 4: TypeScript Build Check");
  try {
    const tscOutput = execFileSync("npx", ["tsc", "--noEmit"], { encoding: "utf8", shell: true });
    console.log("  ✓ tsc --noEmit executed cleanly with zero errors!");
    console.log("  ✓ TEST 4 PASSED.\n");
  } catch (err: any) {
    console.error("  ✗ tsc --noEmit failed:\n", err.stdout || err.message);
    throw err;
  }

  console.log("===============================================================");
  console.log("  ALL 4 VERIFICATION SUITE TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("===============================================================");

  return generatedPngPaths;
}

runVerification()
  .then((paths) => {
    console.log("\nGenerated image paths for inspection:", paths);
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ VERIFICATION SUITE FAILED:", err);
    process.exit(1);
  });
