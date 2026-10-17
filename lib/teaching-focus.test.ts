import test from "node:test";
import assert from "node:assert/strict";
import type { VisualObject } from "./lesson-schema.ts";
import { cameraForTarget, interactionCurve, resolveTeachingTarget, type TeachingCue } from "./teaching-focus.ts";
import { computeTargetPositions } from "./target-matcher.ts";
import { cueAtCharacter, playDeviceNarration, playRecordedNarration } from "./playback-sync.ts";

const diagram: VisualObject = {
  id: "mitochondrion", label: "Mitochondrion", shapeType: "image", role: "subject", labelPlacement: "below",
  x: 100, y: 100, width: 800, height: 400, parts: [],
  image: {
    id: "mito-image", title: "Mitochondrion", url: "https://example.org/image.png", sourceUrl: "https://example.org", author: "Test", license: "CC0", licenseUrl: "https://example.org/license",
    width: 800, height: 400,
    regions: [
      { label: "Matrix", x: 0.2, y: 0.4, width: 0.2, height: 0.2, confidence: 0.95 },
      { label: "Inner Membrane", x: 0.6, y: 0.2, width: 0.2, height: 0.1, confidence: 0.9 },
    ],
  },
};

test("named slugs and numeric indices resolve the same actual image region", () => {
  const named = resolveTeachingTarget("mitochondrion#inner_membrane", [diagram]);
  const indexed = resolveTeachingTarget("mitochondrion#1", [diagram]);
  assert.ok(named);
  assert.deepEqual(named.bounds, indexed?.bounds);
  assert.deepEqual(named.center, { x: 660, y: 200 });
});

test("region targeting tracks moved, resized, flipped and rotated live images", () => {
  const live = { id: diagram.id, type: "image", x: 400, y: 200, width: 400, height: 200, angle: Math.PI / 2, scale: [-1, 1] };
  const target = resolveTeachingTarget("mitochondrion#matrix", [diagram], [], [live]);
  assert.ok(target);
  assert.ok(Math.abs(target.center.x - 600) < 0.001);
  assert.ok(Math.abs(target.center.y - 380) < 0.001);
  assert.ok(Math.abs(target.bounds.width - 40) < 0.001);
  assert.ok(Math.abs(target.bounds.height - 80) < 0.001);
});

test("unknown, invisible, failed-image and unreliable features produce no fabricated pointer", () => {
  assert.equal(resolveTeachingTarget("mitochondrion#invented", [diagram]), null);
  assert.equal(resolveTeachingTarget("absent", [diagram]), null);
  assert.equal(resolveTeachingTarget("mitochondrion#matrix", [diagram], [], []), null);
  assert.equal(resolveTeachingTarget("mitochondrion#matrix", [diagram], [], [{ id: diagram.id, type: "rectangle", x: 0, y: 0, width: 400, height: 200 }]), null);
  const uncertain = structuredClone(diagram);
  uncertain.image!.regions[0].confidence = 0.2;
  assert.equal(resolveTeachingTarget("mitochondrion#matrix", [uncertain]), null);
  uncertain.image!.regions[0] = { ...uncertain.image!.regions[0], confidence: 1, x: 0.95, width: 0.2 };
  assert.equal(resolveTeachingTarget("mitochondrion#matrix", [uncertain]), null);
});

test("whole image occupies 70 percent of the limiting viewport dimension", () => {
  const target = resolveTeachingTarget(diagram.id, [diagram])!;
  const camera = cameraForTarget(target, { width: 1000, height: 600 });
  assert.equal(camera.zoom * target.bounds.width, 700);
  assert.equal((target.center.x + camera.scrollX) * camera.zoom, 500);
  assert.equal((target.center.y + camera.scrollY) * camera.zoom, 300);
});

test("detail camera is bounded at 2.5x and keeps a broad region visible on small screens", () => {
  const target = resolveTeachingTarget("mitochondrion#matrix", [diagram])!;
  assert.equal(cameraForTarget(target, { width: 1200, height: 800 }).zoom, 2.5);
  const camera = cameraForTarget(target, { width: 250, height: 200 });
  assert.ok(camera.zoom * target.bounds.width <= 250 * 0.7 + 0.001);
});

test("curved interaction arrows connect real regions within one image only", () => {
  const from = resolveTeachingTarget("mitochondrion#matrix", [diagram])!;
  const to = resolveTeachingTarget("mitochondrion#inner_membrane", [diagram])!;
  const curve = interactionCurve(from, to)!;
  assert.deepEqual(curve.start, from.center);
  assert.deepEqual(curve.end, to.center);
  assert.ok(curve.control.x >= diagram.x && curve.control.x <= diagram.x + diagram.width);
  assert.ok(curve.control.y >= diagram.y && curve.control.y <= diagram.y + diagram.height);
  assert.equal(interactionCurve(from, { ...to, objectId: "other-image" }), null);
  assert.equal(interactionCurve(from, from), null);
});

test("graph region IDs use the same deterministic geometry as image features", () => {
  const graph = structuredClone(diagram);
  graph.image!.regions = [{ id: "series-revenue-2025", label: "2025 revenue", x: 0.3, y: 0.25, width: 0.04, height: 0.04, confidence: 1 } as NonNullable<VisualObject["image"]>["regions"][number]];
  const target = resolveTeachingTarget(`${graph.id}#series-revenue-2025`, [graph]);
  assert.ok(target);
  assert.deepEqual(target.center, { x: 356, y: 208 });
});

test("exact label matching does not chase generic fragments or unmentioned regions", () => {
  const narration = "The inner structure contains a membrane. Later we inspect the Inner Membrane.";
  const positions = computeTargetPositions(narration, [diagram.id], [diagram]);
  assert.equal(positions.length, 2);
  assert.equal(positions[1].charIndex, narration.indexOf("Inner Membrane"));
  assert.equal(positions[1].targetId, `${diagram.id}#1`);
});

test("explicit phrase cues fire at their spoken phrase, not at the start of the step", () => {
  const cue: TeachingCue = { phrase: "moves across", targetId: `${diagram.id}#matrix`, toTargetId: `${diagram.id}#inner_membrane`, kind: "arrow" };
  const positions = computeTargetPositions("Energy now moves across the Inner Membrane.", [diagram.id], [diagram], [], [cue]);
  assert.equal(cueAtCharacter(positions, 0)?.cue, undefined);
  assert.equal(cueAtCharacter(positions, 10)?.cue, undefined);
  assert.deepEqual(cueAtCharacter(positions, 11)?.cue, cue);
});

test("native-language phrases preserve UTF-16 character offsets for speech boundaries", () => {
  const cue: TeachingCue = { phrase: "यहाँ ऊर्जा", targetId: `${diagram.id}#matrix`, kind: "circle" };
  const narration = "देखिए, यहाँ ऊर्जा बनती है।";
  const positions = computeTargetPositions(narration, [diagram.id], [diagram], [], [cue]);
  assert.equal(positions.find(p => p.cue)?.charIndex, narration.indexOf("यहाँ"));
});

test("ambiguous equal labels do not jump between two image features", () => {
  const duplicate = structuredClone(diagram);
  duplicate.image!.regions[1].label = "Matrix";
  const positions = computeTargetPositions("The Matrix stores material.", [diagram.id], [duplicate]);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].targetId, diagram.id);
});

test("invalid explicit interaction destinations are dropped", () => {
  const positions = computeTargetPositions("Now move across.", [diagram.id], [diagram], [], [{ phrase: "move across", targetId: `${diagram.id}#matrix`, toTargetId: `${diagram.id}#invented`, kind: "arrow" }]);
  assert.ok(positions.every(p => !p.cue));
});

test("recorded narration aligned cues follow provider word times, stop while paused, and clean up on abort", async () => {
  const controller = new AbortController();
  const seen: Array<TeachingCue | null> = [];
  const cue: TeachingCue = { phrase: "moves", targetId: "a", kind: "circle" };
  const fakeAudio = { paused: false, currentTime: 0, duration: 10, play: async () => {}, pause() { this.paused = true; }, onplaying: null, ontimeupdate: null, onended: null, onerror: null };
  const audio = fakeAudio as unknown as HTMLAudioElement;
  playRecordedNarration(audio, 100, { signal: controller.signal, cues: [{ charIndex: 0, targetId: "image" }, { charIndex: 50, targetId: "a", cue }], wordTimings: [{ charIndex: 0, start: 0, end: 1 }, { charIndex: 50, start: 6, end: 7 }], onStart() {}, onTarget() {}, onCue: c => seen.push(c), onEnd() {}, onError() { assert.fail("unexpected audio error"); } });
  audio.onplaying?.(new Event("playing"));
  fakeAudio.currentTime = 5.9;
  audio.ontimeupdate?.(new Event("timeupdate"));
  assert.deepEqual(seen, [null]);
  fakeAudio.currentTime = 6;
  audio.ontimeupdate?.(new Event("timeupdate"));
  assert.deepEqual(seen, [null, cue]);
  fakeAudio.paused = true;
  audio.ontimeupdate?.(new Event("timeupdate"));
  assert.equal(seen.length, 2);
  controller.abort();
  assert.equal(audio.ontimeupdate, null);
  assert.equal(audio.onplaying, null);
});

test("unaligned recordings never draw an interaction at a guessed word time", () => {
  const controller = new AbortController();
  const seen: Array<TeachingCue | null> = [];
  const targets: string[] = [];
  const audio = { paused: false, currentTime: 8, duration: 10, play: async () => {}, pause() {} } as unknown as HTMLAudioElement;
  playRecordedNarration(audio, 100, { signal: controller.signal, cues: [{ charIndex: 0, targetId: "image" }, { charIndex: 50, targetId: "matrix", cue: { phrase: "moves", targetId: "matrix", kind: "arrow", toTargetId: "membrane" } }], onStart() {}, onTarget: target => targets.push(target), onCue: cue => seen.push(cue), onEnd() {}, onError() {} });
  audio.onplaying?.(new Event("playing"));
  audio.ontimeupdate?.(new Event("timeupdate"));
  assert.deepEqual(targets, ["image", "matrix"]);
  assert.deepEqual(seen, [null]);
  controller.abort();
});

test("native speech word boundaries update interaction cues and cancellation removes handlers", () => {
  const controller = new AbortController();
  const seen: Array<TeachingCue | null> = [];
  const cue: TeachingCue = { phrase: "flows", targetId: "a", kind: "bracket" };
  const utterance = { rate: 1, onstart: null, onboundary: null, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance;
  let cancelled = false;
  const speech = { speak() {}, cancel() { cancelled = true; } } as unknown as SpeechSynthesis;
  playDeviceNarration(speech, utterance, { signal: controller.signal, cues: [{ charIndex: 0, targetId: "image" }, { charIndex: 100, targetId: "a", cue }], onStart() {}, onTarget() {}, onCue: c => seen.push(c), onEnd() {}, onError() {} });
  utterance.onstart?.({} as SpeechSynthesisEvent);
  utterance.onboundary?.({ name: "word", charIndex: 100 } as SpeechSynthesisEvent);
  assert.deepEqual(seen, [cue]);
  controller.abort();
  assert.equal(cancelled, true);
  assert.equal(utterance.onboundary, null);
});
