import test from "node:test";
import assert from "node:assert/strict";
import { compileImageAnnotationSkeletons, ANNOTATION_COLOR_MAP } from "./image-annotations.ts";
import type { VisualObject } from "./lesson-schema.ts";
import type { ImageAnnotation } from "./visual-agent-schema.ts";

const sampleImageObject: VisualObject = {
  id: "img-nephron",
  role: "component",
  shapeType: "custom",
  label: "Nephron Diagram",
  labelPlacement: "below",
  x: 100,
  y: 150,
  width: 400,
  height: 300,
  parts: [],
  image: {
    id: "asset-nephron",
    title: "Nephron Anatomy",
    url: "https://upload.wikimedia.org/wikipedia/commons/test-nephron.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Test-nephron.png",
    license: "CC-BY-SA-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    author: "Wikimedia Contributor",
    width: 800,
    height: 600,
    regions: [],
  },
};

test("compileImageAnnotationSkeletons returns empty array if no image or empty annotations", () => {
  assert.deepEqual(compileImageAnnotationSkeletons({ ...sampleImageObject, image: undefined }, []), []);
  assert.deepEqual(compileImageAnnotationSkeletons(sampleImageObject, []), []);
});

test("compileImageAnnotationSkeletons accurately projects normalized coordinates to world coordinates and points arrow to target", () => {
  // Image width = 400, aspect ratio = 600/800 = 0.75, so imgH = 400 * 0.75 = 300
  // Normalized x=0.25, y=0.5, w=0.1, h=0.2
  // annX = 100 + 0.25 * 400 = 200, annY = 150 + 0.5 * 300 = 300
  // annW = 0.1 * 400 = 40, annH = 0.2 * 300 = 60
  // targetX = 220, targetY = 330
  const annotation: ImageAnnotation = {
    id: "ann-glom",
    targetImageId: "img-nephron",
    regionLabel: "Glomerulus",
    normalized: { x: 0.25, y: 0.5, width: 0.1, height: 0.2 },
    color: "amber",
    drawStyle: "callout_arrow",
  };

  const skeletons = compileImageAnnotationSkeletons(sampleImageObject, [annotation]);
  // No shading box, no contour rectangle — only arrow and badge
  assert.equal(skeletons.some((s) => s.type === "rectangle"), false);
  assert.equal(skeletons.length, 2);

  const arrow = skeletons.find((s) => s.id === "ann-glom-arrow");
  assert.ok(arrow);
  assert.equal(arrow.type, "arrow");
  assert.equal(arrow.endArrowhead, "arrow");

  // Arrow originates in left margin outside image
  assert.ok(arrow.x! < sampleImageObject.x);
  const pts = (arrow as unknown as { points: number[][] }).points;
  // Arrowhead at points[1] lands precisely on targetX (220) and targetY (330)
  assert.equal(arrow.x! + pts[1][0], 220);
  assert.equal(arrow.y! + pts[1][1], 330);
});

test("compileImageAnnotationSkeletons creates ONLY arrow and badge without shading or contour boxes for full_annotation", () => {
  const annotation: ImageAnnotation = {
    id: "ann-bowman",
    targetImageId: "img-nephron",
    regionLabel: "Bowman's Capsule",
    normalized: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    color: "cyan",
    drawStyle: "full_annotation",
    calloutText: "Bowman Capsule",
  };

  const skeletons = compileImageAnnotationSkeletons(sampleImageObject, [annotation]);
  // Strictly no shading rectangles or contours
  assert.equal(skeletons.some((s) => s.type === "rectangle"), false);
  assert.equal(skeletons.length, 2);

  const ids = skeletons.map((s) => s.id);
  assert.equal(ids.includes("ann-bowman-shade"), false);
  assert.equal(ids.includes("ann-bowman-contour"), false);
  assert.ok(ids.includes("ann-bowman-arrow"));
  assert.ok(ids.includes("ann-bowman-badge"));

  const badge = skeletons.find((s) => s.id === "ann-bowman-badge");
  assert.equal(badge?.type, "text");
  assert.equal((badge as { text?: string })?.text, "✦ Bowman Capsule");
});

test("compileImageAnnotationSkeletons positions callout in right margin and points inward when target is on right half", () => {
  // Near right edge: x=0.85, w=0.1. Image x=100, width=400 (bounds 100 to 500).
  // targetX = 100 + 0.85 * 400 + 20 = 460
  const annotation: ImageAnnotation = {
    id: "ann-edge",
    targetImageId: "img-nephron",
    regionLabel: "Collecting Duct",
    normalized: { x: 0.85, y: 0.3, width: 0.1, height: 0.2 },
    color: "emerald",
    drawStyle: "callout_arrow",
  };

  const skeletons = compileImageAnnotationSkeletons(sampleImageObject, [annotation]);
  const arrow = skeletons.find((s) => s.id === "ann-edge-arrow");
  assert.ok(arrow);
  // Arrow starts in the right margin outside the image (x > 500)
  assert.ok(arrow.x! > sampleImageObject.x + sampleImageObject.width);

  const points = (arrow as unknown as { points: number[][] }).points;
  assert.ok(points);
  // Second point dx should be negative (pointing inward from right margin to image feature)
  assert.ok(points[1][0] < 0, `Expected negative dx arrow pointing inward, got ${points[1][0]}`);
  // Arrowhead lands directly on targetX
  assert.equal(arrow.x! + points[1][0], 460);
});

test("compileImageAnnotationSkeletons guarantees zero label overlap for concentric shells", () => {
  const concentricAnnotations: ImageAnnotation[] = [
    {
      id: "ann-hydrogen",
      targetImageId: "img-nephron",
      regionLabel: "hydrogen shell",
      calloutText: "hydrogen shell",
      normalized: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
      color: "cyan",
      drawStyle: "callout_arrow",
    },
    {
      id: "ann-silicon",
      targetImageId: "img-nephron",
      regionLabel: "silicon core",
      calloutText: "silicon core",
      normalized: { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
      color: "amber",
      drawStyle: "callout_arrow",
    },
  ];

  const skeletons = compileImageAnnotationSkeletons(sampleImageObject, concentricAnnotations);
  const badges = skeletons.filter((s) => s.id?.endsWith("-badge"));
  assert.equal(badges.length, 2);

  // Both badges should be in left margin, outside the image
  for (const b of badges) {
    assert.ok(b.x! + (b.width ?? 0) < sampleImageObject.x);
  }

  // Badges must have at least 40px vertical separation
  const badgeY0 = badges[0].y!;
  const badgeY1 = badges[1].y!;
  assert.ok(Math.abs(badgeY1 - badgeY0) >= 40, `Expected at least 40px gap between badges, got ${Math.abs(badgeY1 - badgeY0)}`);

  // Arrows must not cross and must point to their respective parts
  const arrow0 = skeletons.find((s) => s.id === "ann-hydrogen-arrow");
  const arrow1 = skeletons.find((s) => s.id === "ann-silicon-arrow");
  assert.ok(arrow0 && arrow1);
  assert.ok(arrow0.y! < arrow1.y!, "Outer shell arrow should start above inner core arrow");
});
