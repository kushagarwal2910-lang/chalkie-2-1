import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { compileTeachingPlan, type TeachingPlan } from "../lib/lesson-v2.ts";
import { doBoxesOverlap } from "../lib/elk-spatial-layout.ts";
import { routeIntersectsBox } from "../lib/connector-routing.ts";
import { getProgressiveScene } from "../lib/progressive-scene.ts";

console.log("===============================================================");
console.log("  CHALKIE 2.0 FLOWCARDS & SEQUENTIAL ARROWS VERIFICATION SUITE");
console.log("===============================================================\n");

// ----------------------------------------------------------------------------
// TEST 1: Card Content & Formula Formatting Assertion
// ----------------------------------------------------------------------------
console.log(">>> TEST 1: Card Content & Formula Formatting Assertion");

const sampleOrbitalPlan: TeachingPlan = {
  title: "Orbital Mechanics: Balance of Gravity and Inertia",
  summary: "How satellites achieve perpetual orbit around Earth.",
  teachingMode: "sequence",
  coverage: "append",
  nodes: [
    {
      id: "hero-orbit",
      label: "Orbital Trajectory & Velocity Vectors",
      kind: "image",
      imageQuery: "satellite orbit earth velocity gravity vectors diagram",
      regions: ["Earth Core", "Orbit Path", "Forward Velocity", "Gravitational Pull"],
      visualIntent: "canonical",
    },
    {
      id: "card-gravity",
      label: "**1. Gravitational Force**\n• F_g = G * (M * m) / r²\n• Inward pull toward Earth center",
      kind: "box",
      imageQuery: "",
      regions: [],
    },
    {
      id: "card-inertia",
      label: "**2. Tangential Inertia**\n• v_t = constant forward speed\n• Tends to fly in straight line",
      kind: "box",
      imageQuery: "",
      regions: [],
    },
    {
      id: "card-centripetal",
      label: "**3. Centripetal Balance**\n• F_c = (m * v²) / r\n• Gravity acts as centripetal force",
      kind: "box",
      imageQuery: "",
      regions: [],
    },
    {
      id: "card-freefall",
      label: "**4. Perpetual Free-Fall**\n• Falling around Earth's curvature\n• Zero normal force = weightless",
      kind: "box",
      imageQuery: "",
      regions: [],
    },
    {
      id: "card-orbital-speed",
      label: "**5. Orbital Velocity**\n• v = √(G * M / r)\n• Lower orbit requires higher speed",
      kind: "box",
      imageQuery: "",
      regions: [],
    },
  ],
  links: [
    { from: "hero-orbit", to: "card-gravity", label: "exerts" },
    { from: "card-gravity", to: "card-inertia", label: "opposes" },
    { from: "card-inertia", to: "card-centripetal", label: "balances" },
    { from: "card-centripetal", to: "card-freefall", label: "causes" },
    { from: "card-freefall", to: "card-orbital-speed", label: "determines" },
  ],
  steps: [
    {
      title: "1. Gravitational Attraction",
      narration: "A massive body exerts an inward gravitational force drawing the satellite toward its center.",
      targetIds: ["hero-orbit", "card-gravity"],
    },
    {
      title: "2. Tangential Inertia",
      narration: "Newton's first law keeps the satellite moving forward at high velocity along a straight line.",
      targetIds: ["card-inertia", "link-1"],
    },
    {
      title: "3. Centripetal Balance",
      narration: "The inward pull curves the straight path into a circle, providing the exact centripetal force needed.",
      targetIds: ["card-centripetal", "link-2"],
    },
    {
      title: "4. Perpetual Free-Fall",
      narration: "The satellite is perpetually falling, but the Earth curves away underneath it at the exact same rate.",
      targetIds: ["card-freefall", "link-3"],
    },
    {
      title: "5. Orbital Velocity Formula",
      narration: "The required orbital velocity depends inversely on the square root of the distance from the center.",
      targetIds: ["card-orbital-speed", "link-4"],
    },
  ],
};

const cardNodes = sampleOrbitalPlan.nodes.filter((n) => n.kind === "box" || n.kind === "text");
console.log(`  Evaluating ${cardNodes.length} whiteboard card nodes for micro-content laws...`);

assert.ok(cardNodes.length >= 3 && cardNodes.length <= 6, "Must decompose into 3 to 6 sequential micro-cards");

for (const card of cardNodes) {
  const lines = card.label.split("\n");
  console.log(`  Testing Card [${card.id}]:`);
  console.log(`    Lines (${lines.length}): ${JSON.stringify(lines)}`);

  // Assert zero paragraphs longer than 80 chars
  for (const line of lines) {
    assert.ok(
      line.length <= 80,
      `Card [${card.id}] line exceeds 80 characters (${line.length} chars): "${line}"`
    );
  }

  // Assert bullet points or formula notation present
  const hasBulletsOrFormulas =
    card.label.includes("•") ||
    card.label.includes("- ") ||
    /[=+\-*/√^²]/.test(card.label);
  assert.ok(
    hasBulletsOrFormulas,
    `Card [${card.id}] must include bullet points or formula terms`
  );

  // Assert plain-text math notation (not raw LaTeX)
  assert.ok(!card.label.includes("\\frac"), `Card [${card.id}] should not contain raw LaTeX \\frac`);
  assert.ok(!card.label.includes("$"), `Card [${card.id}] should not contain dollar sign math delimiters`);
}
console.log("  ✓ TEST 1 PASSED: All micro-cards adhere strictly to formatting & formula laws.\n");

// ----------------------------------------------------------------------------
// TEST 2: Flowcard Layout Collision & Obstacle Avoidance Routing Check
// ----------------------------------------------------------------------------
console.log(">>> TEST 2: Flowcard Layout Collision & Obstacle Avoidance Routing Check");

const compiledLesson = compileTeachingPlan(
  sampleOrbitalPlan,
  "How do satellites stay in orbit around Earth?",
  []
);

console.log(`  Compiled lesson contains ${compiledLesson.objects.length} objects and ${compiledLesson.connections.length} connections.`);

// 2.1 Spatial Zoning Check
const heroImage = compiledLesson.objects.find((o) => o.image);
assert.ok(heroImage, "Hero image must be present in compiled lesson");
console.log(`  Hero Image Position: (${heroImage.x}, ${heroImage.y}), Size: ${heroImage.width}x${heroImage.height}`);
assert.strictEqual(heroImage.x, 64, "Hero image must occupy focus zone x: 64");
assert.strictEqual(heroImage.y, 112, "Hero image must occupy focus zone y: 112");

// 2.2 Bounding Box Overlap Assertion
console.log("  Checking all object bounding boxes for zero overlap (minimum 16px clearance)...");
for (let i = 0; i < compiledLesson.objects.length; i++) {
  for (let j = i + 1; j < compiledLesson.objects.length; j++) {
    const a = compiledLesson.objects[i];
    const b = compiledLesson.objects[j];
    const overlaps = doBoxesOverlap(a, b, 16);
    assert.ok(
      !overlaps,
      `Collision detected between object [${a.id}] at (${a.x},${a.y},${a.width}x${a.height}) and [${b.id}] at (${b.x},${b.y},${b.width}x${b.height})!`
    );
  }
}
console.log("  ✓ Zero bounding box collisions verified across all diagram objects.");

// 2.3 Orthogonal Connector Waypoints Routing Around Obstacles Check
console.log("  Verifying orthogonal elbow connector routes avoid card obstacle hulls...");
for (const conn of compiledLesson.connections) {
  assert.strictEqual(conn.route, "elbow", `Connection [${conn.id}] route must be 'elbow'`);
  assert.strictEqual(conn.arrowhead, "arrow", `Connection [${conn.id}] arrowhead must be 'arrow'`);
  assert.ok(conn.points && conn.points.length >= 2, `Connection [${conn.id}] must have at least 2 waypoints`);

  // Check that connector does not intersect any intermediate obstacle cards
  const intermediateObstacles = compiledLesson.objects.filter(
    (o) => o.id !== conn.from && o.id !== conn.to
  );

  for (const obs of intermediateObstacles) {
    const intersects = routeIntersectsBox(conn.points, obs);
    assert.ok(
      !intersects,
      `Connector [${conn.id}] intersects card obstacle [${obs.id}] hull!`
    );
  }
  console.log(`    ✓ Connection [${conn.id}] (${conn.from} -> ${conn.to}) routes cleanly with ${conn.points.length} waypoints.`);
}
console.log("  ✓ All connector routes avoid obstacle card hulls.");

// 2.4 Synchronized Progressive Disclosure Check
console.log("  Verifying Step-Linked Progressive Disclosure across 5 steps...");
for (let step = 0; step < 5; step++) {
  const scene = getProgressiveScene(compiledLesson, step, true);
  console.log(
    `    Step ${step}: ${scene.visibleObjects.length} objects visible (${[...scene.visibleObjectIds].join(
      ", "
    )}), newly revealed: ${[...scene.newlyRevealedIds].join(", ")}`
  );

  if (step === 0) {
    // Only Step 0 targets visible
    assert.ok(scene.visibleObjectIds.has("hero-orbit"), "Step 0 must reveal hero image");
    assert.ok(scene.visibleObjectIds.has("card-gravity"), "Step 0 must reveal card-gravity");
    assert.ok(!scene.visibleObjectIds.has("card-inertia"), "Step 0 must NOT reveal card-inertia");
    assert.ok(!scene.visibleObjectIds.has("card-orbital-speed"), "Step 0 must NOT reveal card-orbital-speed");
  } else if (step === 1) {
    assert.ok(scene.visibleObjectIds.has("card-inertia"), "Step 1 must reveal card-inertia");
    assert.ok(scene.newlyRevealedIds.has("card-inertia"), "card-inertia must be newly revealed in Step 1");
    assert.ok(!scene.visibleObjectIds.has("card-orbital-speed"), "Step 1 must NOT reveal card-orbital-speed");
  } else if (step === 4) {
    assert.strictEqual(
      scene.visibleObjects.length,
      compiledLesson.objects.length,
      "Step 4 (final step) must reveal all objects"
    );
  }
}
console.log("  ✓ Synchronized progressive disclosure verified (zero Turn 1 flood).\n");

console.log("  ✓ TEST 2 PASSED: Flowcard spatial zoning, collision avoidance, and routing verified.\n");

// ----------------------------------------------------------------------------
// TEST 3: TypeScript Build Check
// ----------------------------------------------------------------------------
console.log(">>> TEST 3: TypeScript Build Check");
try {
  const tscOutput = execFileSync("npx", ["tsc", "--noEmit"], { encoding: "utf8", shell: true });
  console.log("  ✓ tsc --noEmit executed cleanly with zero errors!");
  console.log("  ✓ TEST 3 PASSED.\n");
} catch (err: any) {
  console.error("  ✗ tsc --noEmit failed:\n", err.stdout || err.message);
  process.exit(1);
}

console.log("===============================================================");
console.log("  ALL FLOWCARD & ARROW ENGINE TESTS PASSED SUCCESSFULLY! 🎉");
console.log("===============================================================");
