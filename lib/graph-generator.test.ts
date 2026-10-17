import test from "node:test";
import assert from "node:assert/strict";
import { generateScientificGraph, renderScientificSvgGraph } from "./graph-generator.ts";

test("renderScientificSvgGraph renders dark mode SVG with mathematical regions", () => {
  const result = renderScientificSvgGraph({
    title: "Damped vs Resonant Wave",
    graphType: "wave-comparison",
    xAxisLabel: "Time (s)",
    yAxisLabel: "Amplitude",
    seriesSpec: "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e",
  });

  assert.ok(result.dataUrl.startsWith("data:image/svg+xml;base64,"));
  assert.equal(result.width, 800);
  assert.equal(result.height, 520);
  assert.ok(result.regions.length >= 3);
  
  const resPeak = result.regions.find(r => r.id === "resonance_peak");
  assert.ok(resPeak, "Should contain resonance_peak region");
  assert.equal(resPeak.confidence, 1.0);
  assert.ok(resPeak.x > 0 && resPeak.x < 1);
  assert.ok(resPeak.y > 0 && resPeak.y < 1);

  const dampedEnv = result.regions.find(r => r.id === "damped_envelope");
  assert.ok(dampedEnv, "Should contain damped_envelope region");
});

test("generateScientificGraph runs Python renderer or fallback smoothly", async () => {
  const result = await generateScientificGraph({
    title: "Tacoma Narrows Resonance vs Damped Oscillation",
    graphType: "wave-comparison",
    xAxisLabel: "Time (seconds)",
    yAxisLabel: "Displacement / Amplitude (meters)",
    seriesSpec: "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e",
  });

  assert.ok(result.dataUrl.startsWith("data:image/"));
  assert.equal(result.width, 800);
  assert.equal(result.height, 520);
  assert.ok(result.regions.length >= 3);
  assert.ok(result.regions.some(r => r.label.includes("Resonance Peak")));
});
