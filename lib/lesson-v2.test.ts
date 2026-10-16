import test from "node:test";
import assert from "node:assert/strict";
import { compileTeachingPlan, type TeachingPlan } from "./lesson-v2.ts";
import { commonsAsset, isCommonsImageUrl } from "./commons-images.ts";
import { projectImageRegion, getRegionCenter } from "./image-coordinates.ts";
import { imageRegionSchema, lessonPlanSchema } from "./lesson-schema.ts";
import { computeTargetPositions } from "./target-matcher.ts";
import { readableNarration } from "./narration-labels.ts";

const plan: TeachingPlan = { title: "Lesson", summary: "A concise explanation", coverage: "append", nodes: [{ id: "heart", label: "Heart", kind: "image", imageQuery: "heart anatomy", regions: ["Left ventricle"] }], links: [], steps: [{ title: "Heart", narration: "The left ventricle pumps blood to the body.", targetIds: ["heart"] }] };
test("narration uses readable labels, omits parenthetical IDs and preserves chemical names", () => {
  assert.equal(readableNarration("The rotor (node rotor-1) spins. The pad-left node applies friction to rotor-1. CO2 is unchanged.", [{ id: "rotor-1", label: "rotor" }, { id: "pad-left", label: "brake pad" }, { id: "CO2", label: "carbon dioxide" }]), "The rotor spins. The brake pad applies friction to rotor. CO2 is unchanged.");
});
test("compact plans become versioned, persistent lessons", () => {
  const lesson = compileTeachingPlan(plan, "Explain the heart", []);
  assert.equal(lesson.version, 2);
  assert.equal(lesson.objects[0].shapeType, "image");
  assert.equal(lessonPlanSchema.parse(JSON.parse(JSON.stringify(lesson))).version, 2);
});
test("rejects invented references and duplicate IDs", () => {
  assert.throws(() => compileTeachingPlan({ ...plan, nodes: [plan.nodes[0], plan.nodes[0]] }, "Explain", []), /Duplicate/);
  assert.throws(() => compileTeachingPlan({ ...plan, steps: [{ ...plan.steps[0], targetIds: ["missing"] }] }, "Explain", []), /Unknown target/);
  assert.throws(() => compileTeachingPlan({ ...plan, links: [{ from: "heart", to: "missing", label: "" }] }, "Explain", []), /endpoint/);
});
test("existing follow-ups need no new canvas objects", () => {
  const lesson = compileTeachingPlan(plan, "Explain", []);
  const next = compileTeachingPlan({ ...plan, coverage: "existing", nodes: [] }, "Why?", [], lesson);
  assert.equal(next.objects.length, 0);
  assert.deepEqual(next.segments[0].targetIds, ["heart"]);
});
test("image proxy only accepts HTTPS Commons upload URLs", () => {
  assert.equal(isCommonsImageUrl("https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.png"), true);
  assert.equal(isCommonsImageUrl("https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e0/Heart.svg/960px-Heart.svg.png"), true);
  for (const url of ["http://upload.wikimedia.org/wikipedia/commons/a.png", "https://upload.wikimedia.org.evil.com/wikipedia/commons/a.png", "https://user@upload.wikimedia.org/wikipedia/commons/a.png", "https://127.0.0.1/a.png", "https://upload.wikimedia.org:8443/wikipedia/commons/a.png", "https://upload.wikimedia.org/wikipedia/commons/../../private"]) assert.equal(isCommonsImageUrl(url), false);
});
test("only explicitly free commercial image licenses are admitted", () => {
  const page = { title: "File:Heart.png", imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.png", width: 800, height: 600, sha1: "hash", mime: "image/png", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" }, Artist: { value: "<a>Artist</a>" } } }] };
  assert.equal(commonsAsset(page)?.author, "Artist");
  page.imageinfo[0].extmetadata.LicenseShortName.value = "CC BY-NC 4.0";
  assert.equal(commonsAsset(page), null);
  page.imageinfo[0].extmetadata.LicenseShortName.value = "Unknown";
  assert.equal(commonsAsset(page), null);
});
test("image regions cannot extend outside the image", () => {
  assert.equal(imageRegionSchema.safeParse({ label: "part", x: .9, y: .2, width: .4, height: .2, confidence: .9 }).success, false);
});
test("annotations follow image translation, resize, rotation and flip", () => {
  const region = { x: 0, y: 0, width: .5, height: .5 };
  const points = projectImageRegion({ x: 10, y: 20, width: 200, height: 100, angle: 0 }, region);
  assert.deepEqual(points[0], { x: 10, y: 20 }); assert.deepEqual(points[2], { x: 110, y: 70 });
  const rotated = projectImageRegion({ x: 10, y: 20, width: 200, height: 100, angle: Math.PI }, region);
  assert.ok(Math.abs(rotated[0].x - 210) < .001); assert.ok(Math.abs(rotated[0].y - 120) < .001);
  const flipped = projectImageRegion({ x: 10, y: 20, width: 200, height: 100, angle: 0, scale: [-1, 1] }, region);
  assert.equal(flipped[0].x, 210);
});
test("spoken image region labels produce region pointer cues", () => {
  const lesson = compileTeachingPlan(plan, "Explain", []);
  lesson.objects[0].image = { id: "a", title: "Heart", sourceUrl: "https://commons.wikimedia.org/wiki/File:Heart.png", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.png", author: "Artist", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", width: 800, height: 600, regions: [{ label: "Left ventricle", x: .2, y: .4, width: .2, height: .3, confidence: .9 }] };
  assert.ok(computeTargetPositions(plan.steps[0].narration, ["heart"], lesson.objects).some(cue => cue.targetId === "heart#0"));
});

test("Syllable-0 locks to sub-region when targetIds contains region anchor", () => {
  const objects = [{
    id: "eye-img",
    label: "Cross-section of the human eye diagram",
    role: "subject" as const,
    shapeType: "image" as const,
    labelPlacement: "below" as const,
    x: 64,
    y: 112,
    width: 640,
    height: 480,
    image: {
      id: "eye-asset",
      title: "Human eye",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Eye.png",
      url: "https://upload.wikimedia.org/wikipedia/commons/e/ee/Eye.png",
      author: "Artist",
      license: "CC0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      width: 800,
      height: 600,
      regions: [
        { label: "Cornea", x: 0.1, y: 0.3, width: 0.15, height: 0.25, confidence: 0.95 },
        { label: "Lens", x: 0.25, y: 0.35, width: 0.12, height: 0.2, confidence: 0.9 },
      ],
    },
    parts: [],
  }];

  const narration = "In the human eye, light first passes through the cornea and then the lens.";
  const cues = computeTargetPositions(narration, ["eye-img", "eye-img#0"], objects);

  assert.ok(cues.length > 0);
  // Syllable-0 anchor MUST be the cornea sub-region, NOT the bare eye-img!
  assert.equal(cues[0].charIndex, 0);
  assert.equal(cues[0].targetId, "eye-img#0");
  assert.equal(cues[0].partLabel, "Cornea");

  // Mid-sentence keyword matching: "eye" should NOT match bare eye-img because eye is a stopword and sub-region is targeted
  const bareMatches = cues.filter(c => c.targetId === "eye-img");
  assert.equal(bareMatches.length, 0, "Bare whole-image ID should never hijack laser when sub-region is targeted");
});

test("getRegionCenter accurately computes center of normalized bounding box", () => {
  const image = { x: 100, y: 200, width: 400, height: 300 };
  const region = { x: 0.1, y: 0.2, width: 0.4, height: 0.2 };
  const center = getRegionCenter(image, region);
  // center x = 100 + (0.1 + 0.4/2) * 400 = 100 + 0.3 * 400 = 220
  // center y = 200 + (0.2 + 0.2/2) * 300 = 200 + 0.3 * 300 = 290
  assert.equal(center.x, 220);
  assert.equal(center.y, 290);
});

