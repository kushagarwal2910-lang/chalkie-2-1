import test from "node:test";
import assert from "node:assert/strict";
import { generateScientificGraph, renderScientificSvgGraph } from "./graph-generator.ts";

test("renderScientificSvgGraph renders dark mode SVG with mathematical regions", () => {
  const result = renderScientificSvgGraph({
    title: "Enzyme Reaction Rate vs Substrate Concentration",
    chartKind: "curve",
    xAxisLabel: "Substrate Concentration [S] (mM)",
    yAxisLabel: "Reaction Velocity V (μmol/min)",
    series: [
      {
        name: "Standard Kinetics",
        color: "#38bdf8",
        points: [
          { x: 0, y: 0, label: "Origin" },
          { x: 2, y: 15 },
          { x: 5, y: 25, label: "Half Vmax" },
          { x: 10, y: 30, label: "Vmax Asymptote" },
        ],
      },
    ],
  });

  assert.ok(result.dataUrl.startsWith("data:image/svg+xml;base64,"));
  assert.equal(result.width, 800);
  assert.equal(result.height, 520);
  assert.ok(result.regions.length >= 3);

  const xAxis = result.regions.find(r => r.id === "x_axis");
  assert.ok(xAxis, "Should contain x_axis region");
  assert.equal(xAxis.confidence, 1.0);

  const yAxis = result.regions.find(r => r.id === "y_axis");
  assert.ok(yAxis, "Should contain y_axis region");
  assert.equal(yAxis.confidence, 1.0);

  const calloutPt = result.regions.find(r => r.label === "Half Vmax");
  assert.ok(calloutPt, "Should contain Half Vmax point callout region");
  assert.ok(calloutPt.x > 0 && calloutPt.x < 1);
  assert.ok(calloutPt.y > 0 && calloutPt.y < 1);
});

test("generateScientificGraph runs Python renderer or fallback smoothly", async () => {
  const result = await generateScientificGraph({
    title: "Microeconomics Supply & Demand Equilibrium",
    chartKind: "curve",
    xAxisLabel: "Quantity (Q)",
    yAxisLabel: "Price ($)",
    series: [
      {
        name: "Demand",
        color: "#38bdf8",
        points: [
          { x: 10, y: 90, label: "High Price Point" },
          { x: 30, y: 70 },
          { x: 50, y: 50 },
          { x: 70, y: 30 },
          { x: 90, y: 10, label: "Low Price Point" },
        ],
      },
      {
        name: "Supply",
        color: "#10b981",
        points: [
          { x: 10, y: 15 },
          { x: 30, y: 32.5 },
          { x: 50, y: 50 },
          { x: 70, y: 67.5 },
          { x: 90, y: 85 },
        ],
      },
    ],
  });

  assert.ok(result.dataUrl.startsWith("data:image/"));
  assert.equal(result.width, 800);
  assert.equal(result.height, 520);
  assert.ok(result.regions.length >= 3);
  assert.ok(result.regions.some(r => r.id === "x_axis"));
  assert.ok(result.regions.some(r => r.id === "y_axis"));
});
