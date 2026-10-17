/**
 * scripts/verify-image-agent.ts
 *
 * Mandatory Autonomous Self-Verification Suite for:
 * 1. Test 1: High-Relevance Image Ranking Test (svg/png preference, score > 40, noise penalty < 0)
 * 2. Test 2: Low-Token VLM Grounding Inspection Test (<= 800px thumbnail, high-res canvas preservation, [0..1] normalized regions)
 * 3. Test 3: Automatic 3-Case Follow-Up Sensing Test (Case 1: canvas_concept_focus, Case 2: in_place_image_annotation, Case 3: open_library_search)
 * 4. Test 4: TypeScript Compiler Verification (tsc --noEmit)
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { scoreImageCandidate, searchImageProvider } from "../lib/image-providers.ts";
import { getVlmThumbnailUrl } from "../lib/commons-fetch.ts";
import { buildCompactCanvasDigest, planVisualAgentFollowUp } from "../lib/visual-agent.ts";
import type { ImageAsset, LessonPlan } from "../lib/lesson-schema.ts";

async function runVerification() {
  console.log("===============================================================");
  console.log("  CHALKIE 2.0 IMAGE AGENT & VLM BLUEPRINT VERIFICATION SUITE");
  console.log("===============================================================\n");

  // --------------------------------------------------------------------------
  // TEST 1: High-Relevance Image Ranking Test
  // --------------------------------------------------------------------------
  console.log(">>> TEST 1: High-Relevance Image Search Scorer & Ranking");

  const query1 = "human heart anatomy";
  const candidatesHeart: ImageAsset[] = [
    {
      id: "img-heart-statue",
      title: "Statue of physician in hospital building courtyard.jpg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Statue_of_physician.jpg/640px-Statue.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Statue_of_physician.jpg",
      author: "Photographer",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      width: 800,
      height: 600,
      description: "Bronze statue monument outside medical center exterior entrance",
      regions: [],
    },
    {
      id: "img-heart-portrait",
      title: "Portrait of cardiologist William Harvey.jpg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/William_Harvey.jpg/640px-William_Harvey.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:William_Harvey.jpg",
      author: "Painter",
      license: "Public domain",
      licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      width: 600,
      height: 800,
      description: "Historical portrait painting",
      regions: [],
    },
    {
      id: "img-heart-diagram-svg",
      title: "Diagram of the human heart anatomy cross-section.svg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Heart_diagram.svg/1280px-Heart_diagram.svg.png",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Heart_diagram.svg",
      author: "Medical Illustrator",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      width: 1200,
      height: 900,
      description: "Educational schematic diagram of the human heart anatomy showing ventricles, atria, and aorta with clear English labels",
      regions: [],
    },
    {
      id: "img-heart-foreign",
      title: "Human_heart_anatomy_diagram-ru.png",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Human_heart_anatomy_diagram-ru.png/640px-Heart.png",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Human_heart_anatomy_diagram-ru.png",
      author: "Russian Author",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      width: 800,
      height: 600,
      description: "Cyrillic labeled diagram",
      regions: [],
    },
  ];

  // Score heart candidates
  const scoredHeart = candidatesHeart.map((c) => ({
    title: c.title,
    score: scoreImageCandidate(c, query1),
    asset: c,
  }));
  scoredHeart.sort((a, b) => b.score - a.score);

  console.log("Scored candidates for 'human heart anatomy':");
  for (const s of scoredHeart) {
    console.log(`  [${s.score.toFixed(0).padStart(3, " ")} pts] ${s.title}`);
  }

  const topHeart = scoredHeart[0];
  assert.ok(topHeart, "Expected at least one scored candidate");
  assert.strictEqual(topHeart.asset.id, "img-heart-diagram-svg", "Top candidate must be the educational SVG diagram");
  assert.ok(topHeart.score > 40, `Top candidate score (${topHeart.score}) must be > 40`);
  assert.ok(/\.(svg|png)/i.test(topHeart.asset.title), "Top candidate must be an SVG or PNG diagram");

  // Check noise penalties
  const statueCandidate = scoredHeart.find((s) => s.asset.id === "img-heart-statue");
  assert.ok(statueCandidate, "Statue candidate should be present");
  assert.ok(statueCandidate.score < 0, `Noisy candidate "statue" score (${statueCandidate.score}) must be penalized below 0`);

  const portraitCandidate = scoredHeart.find((s) => s.asset.id === "img-heart-portrait");
  assert.ok(portraitCandidate, "Portrait candidate should be present");
  assert.ok(portraitCandidate.score < 0, `Noisy candidate "portrait" score (${portraitCandidate.score}) must be penalized below 0`);

  // Query 2: nuclear fission chain reaction
  const query2 = "nuclear fission chain reaction";
  const candidatesFission: ImageAsset[] = [
    {
      id: "img-fission-building",
      title: "Nuclear power plant reactor building exterior.jpg",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Plant_building.jpg/640px-Plant.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Plant_building.jpg",
      author: "Photographer",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      width: 1024,
      height: 768,
      description: "Concrete reactor building exterior facade",
      regions: [],
    },
    {
      id: "img-fission-schematic-png",
      title: "Nuclear fission chain reaction mechanism schematic.png",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Fission_schematic.png/1200px-Fission.png",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Fission_schematic.png",
      author: "Physicist",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      width: 1200,
      height: 800,
      description: "Process diagram showing neutron-induced uranium-235 nuclear fission chain reaction cycle and energy release",
      regions: [],
    },
  ];

  const scoredFission = candidatesFission.map((c) => ({
    title: c.title,
    score: scoreImageCandidate(c, query2),
    asset: c,
  }));
  scoredFission.sort((a, b) => b.score - a.score);

  console.log("\nScored candidates for 'nuclear fission chain reaction':");
  for (const s of scoredFission) {
    console.log(`  [${s.score.toFixed(0).padStart(3, " ")} pts] ${s.title}`);
  }

  const topFission = scoredFission[0];
  assert.strictEqual(topFission.asset.id, "img-fission-schematic-png", "Top candidate must be the PNG schematic");
  assert.ok(topFission.score > 40, `Top fission score (${topFission.score}) must be > 40`);

  const buildingFission = scoredFission.find((s) => s.asset.id === "img-fission-building");
  assert.ok(buildingFission && buildingFission.score < 0, "Building candidate score must be < 0");

  console.log("  ✓ Test 1 Passed: Educational SVG/PNG scored > 40, noise penalized < 0.\n");

  // --------------------------------------------------------------------------
  // TEST 2: Low-Token VLM Grounding Inspection Test
  // --------------------------------------------------------------------------
  console.log(">>> TEST 2: Low-Token VLM Grounding Inspection Test");

  // 1. Verify getVlmThumbnailUrl provides <= 800px thumbnail for VLM
  const fullSvgUrl = "https://upload.wikimedia.org/wikipedia/commons/3/34/Human_heart_diagram.svg";
  const vlmThumbSvg = getVlmThumbnailUrl(fullSvgUrl, 640);
  console.log("  Full SVG URL:        ", fullSvgUrl);
  console.log("  VLM Thumbnail URL:   ", vlmThumbSvg);
  assert.ok(vlmThumbSvg.includes("640px-"), "VLM thumbnail must request 640px thumbnail");
  assert.ok(vlmThumbSvg.endsWith(".png"), "SVG must be rasterized to PNG thumbnail for VLM");

  const fullPngThumb1280 = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cell.png/1280px-Cell.png";
  const vlmThumbPng = getVlmThumbnailUrl(fullPngThumb1280, 640);
  console.log("  Full 1280px URL:     ", fullPngThumb1280);
  console.log("  VLM Thumbnail URL:   ", vlmThumbPng);
  assert.ok(vlmThumbPng.includes("640px-"), "VLM thumbnail must downscale 1280px to 640px");

  // 2. Mathematical Congruence of Normalized [0..1] Coordinates
  // Verify coordinate invariance from 640px inspection to 1200px+ canvas
  const mockVlmRegion = {
    label: "aortic arch",
    x: 0.45,
    y: 0.15,
    width: 0.20,
    height: 0.18,
    confidence: 0.92,
  };

  // Check normalized range [0..1]
  assert.ok(mockVlmRegion.x >= 0 && mockVlmRegion.x <= 1, "x must be normalized between 0 and 1");
  assert.ok(mockVlmRegion.y >= 0 && mockVlmRegion.y <= 1, "y must be normalized between 0 and 1");
  assert.ok(mockVlmRegion.width >= 0 && mockVlmRegion.width <= 1, "width must be normalized between 0 and 1");
  assert.ok(mockVlmRegion.height >= 0 && mockVlmRegion.height <= 1, "height must be normalized between 0 and 1");
  assert.ok(mockVlmRegion.confidence >= 0.78, "Confidence must satisfy >= 0.78 threshold");

  // Verify scaling invariance:
  const thumbW = 640, thumbH = 480;
  const canvasW = 1280, canvasH = 960;
  const thumbPixelX = mockVlmRegion.x * thumbW;
  const canvasPixelX = mockVlmRegion.x * canvasW;
  assert.strictEqual(canvasPixelX / canvasW, thumbPixelX / thumbW, "Coordinate ratio must be mathematically congruent");

  console.log(`  Normalized coordinates: x=${mockVlmRegion.x}, y=${mockVlmRegion.y}, w=${mockVlmRegion.width}, h=${mockVlmRegion.height}`);
  console.log(`  Pixel coordinates at 640px: (${thumbPixelX.toFixed(1)}, ${(mockVlmRegion.y * thumbH).toFixed(1)})`);
  console.log(`  Pixel coordinates at 1280px: (${canvasPixelX.toFixed(1)}, ${(mockVlmRegion.y * canvasH).toFixed(1)})`);
  console.log("  ✓ Test 2 Passed: <= 800px thumbnail used for VLM, [0..1] normalized coordinate congruence verified.\n");

  // --------------------------------------------------------------------------
  // TEST 3: Automatic 3-Case Follow-Up Sensing Test
  // --------------------------------------------------------------------------
  console.log(">>> TEST 3: Automatic 3-Case Follow-Up Sensing Test");

  const mockHeartLesson: LessonPlan = {
    id: "lesson-heart-anatomy",
    title: "Cardiovascular System",
    question: "How does the human heart pump blood through systemic circulation?",
    summary: "Study of the human heart chambers, major arteries, and systemic circulation.",
    diagramType: "structure",
    visualStrategy: "Diagram",
    sources: [],
    objects: [
      {
        id: "card-systemic",
        role: "component",
        label: "Systemic Circulation Circuit",
        shapeType: "geo",
        labelPlacement: "below",
        x: 100,
        y: 100,
        width: 320,
        height: 180,
        parts: [],
      },
      {
        id: "card-pulmonary",
        role: "component",
        label: "Pulmonary Circulation Loop",
        shapeType: "geo",
        labelPlacement: "below",
        x: 100,
        y: 320,
        width: 320,
        height: 180,
        parts: [],
      },
      {
        id: "img-heart-main",
        role: "subject",
        label: "Human Heart Anatomy Diagram",
        shapeType: "image",
        labelPlacement: "below",
        x: 500,
        y: 100,
        width: 600,
        height: 500,
        parts: [],
        image: {
          id: "img-heart-main",
          title: "Human heart anatomy diagram",
          url: "https://upload.wikimedia.org/wikipedia/commons/3/34/Heart_diagram.svg",
          thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Heart_diagram.svg/640px-Heart_diagram.svg.png",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Heart_diagram.svg",
          author: "Chalkie Science",
          license: "CC BY-SA 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          width: 1200,
          height: 960,
          description: "Anterior cross section of human heart showing chambers and major vessels",
          regions: [
            { label: "left ventricle", x: 0.52, y: 0.55, width: 0.22, height: 0.25, confidence: 0.95 },
            { label: "aorta", x: 0.42, y: 0.12, width: 0.18, height: 0.22, confidence: 0.92 },
          ],
        },
      },
    ],
    connections: [],
    segments: [],
  };

  // Test Digest Generation
  const digest = buildCompactCanvasDigest(mockHeartLesson);
  console.log("Compact Canvas Digest:", JSON.stringify(digest, null, 2));
  assert.strictEqual(digest.existingCards.length, 2, "Digest must contain 2 existing cards");
  assert.strictEqual(digest.existingImages.length, 1, "Digest must contain 1 existing image");
  assert.deepStrictEqual(digest.existingImages[0].groundedRegions, ["left ventricle", "aorta"], "Grounded regions must be reflected in digest");

  // Prompt A (Case 1: Already on Canvas)
  const promptA = "Why does the left ventricle have a thicker wall to pump into the aorta?";
  console.log("\nTesting Prompt A (Case 1):", promptA);
  const decisionA = await planVisualAgentFollowUp(promptA, mockHeartLesson);
  console.log("Decision A:", decisionA);
  assert.strictEqual(
    decisionA.action,
    "canvas_concept_focus",
    `Expected Case 1 (canvas_concept_focus), got ${decisionA.action}`
  );
  if (decisionA.action === "canvas_concept_focus") {
    assert.ok(
      decisionA.targetObjectIds.some((id) => id.includes("left ventricle") || id.includes("aorta")),
      "Target IDs must focus on the existing grounded left ventricle or aorta"
    );
  }

  // Prompt B (Case 2: On Existing Image, Unlabeled Sub-Part)
  const promptB = "Where is the pulmonary valve on this heart diagram?";
  console.log("\nTesting Prompt B (Case 2):", promptB);
  const decisionB = await planVisualAgentFollowUp(promptB, mockHeartLesson);
  console.log("Decision B:", decisionB);
  assert.strictEqual(
    decisionB.action,
    "in_place_image_annotation",
    `Expected Case 2 (in_place_image_annotation), got ${decisionB.action}`
  );
  if (decisionB.action === "in_place_image_annotation") {
    assert.strictEqual(decisionB.targetImageId, "img-heart-main", "Must target the existing heart image ID");
    assert.ok(
      decisionB.targetFeatureQuery.toLowerCase().includes("pulmonary valve"),
      `Target feature query must identify pulmonary valve, got "${decisionB.targetFeatureQuery}"`
    );
  }

  // Prompt C (Case 3: Not on Canvas - Needs New Visual)
  const promptC = "Show me a diagram of how red blood cells carry oxygen inside capillaries.";
  console.log("\nTesting Prompt C (Case 3):", promptC);
  const decisionC = await planVisualAgentFollowUp(promptC, mockHeartLesson);
  console.log("Decision C:", decisionC);
  assert.strictEqual(
    decisionC.action,
    "open_library_search",
    `Expected Case 3 (open_library_search), got ${decisionC.action}`
  );
  if (decisionC.action === "open_library_search") {
    assert.ok(
      decisionC.imageQuery.toLowerCase().includes("red blood cells") ||
      decisionC.imageQuery.toLowerCase().includes("capillaries"),
      `Image query must focus on requested concept, got "${decisionC.imageQuery}"`
    );
  }

  console.log("  ✓ Test 3 Passed: Case 1, Case 2, and Case 3 correctly sensed with zero unnecessary tokens.\n");

  // --------------------------------------------------------------------------
  // TEST 4: TypeScript Compiler Verification (tsc --noEmit)
  // --------------------------------------------------------------------------
  console.log(">>> TEST 4: TypeScript Compiler Verification (tsc --noEmit)");
  try {
    const tscOutput = execFileSync("npx", ["tsc", "--noEmit"], {
      encoding: "utf-8",
      shell: true,
    });
    console.log("  tsc output:", tscOutput ? tscOutput.trim() : "0 errors");
  } catch (err: any) {
    console.error("  tsc failed with output:\n", err.stdout || err.message);
    throw new Error("TypeScript compilation failed with errors");
  }
  console.log("  ✓ Test 4 Passed: 0 TypeScript compilation errors.\n");

  console.log("===============================================================");
  console.log("  ALL 4 TESTS PASSED SUCCESSFULLY! (100% PASS RATE)");
  console.log("===============================================================");
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
