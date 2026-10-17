import test from "node:test";
import assert from "node:assert/strict";
import { playNarrationPhrases, playDeviceNarrationPhrases, splitNarrationAtCues, splitNarrationAtCuePositions } from "./phrase-playback.ts";
import type { TeachingCue } from "./teaching-focus.ts";

const cue = (phrase: string, targetId = "image#matrix"): TeachingCue => ({ phrase, targetId, kind: "focus" });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const recording = () => new Blob(["audio"], { type: "audio/wav" });

class FakeAudio {
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  cleared = false;
  play = async () => undefined;
  pause = () => { this.paused = true; };
  removeAttribute = (name: string) => { if (name === "src") this.cleared = true; };
  load = () => undefined;
  start() { this.onplaying?.(); }
  end() { this.onended?.(); }
}

test("phrase splitting preserves every original character and matches exact cue text", () => {
  const text = "देखिए। Matrix से protons जाते हैं। फिर graph पर ध्यान दें।";
  const chunks = splitNarrationAtCues(text, [cue("Matrix", "image#matrix"), cue("graph", "plot#peak"), cue("missing")]);
  assert.equal(chunks.map(chunk => chunk.text).join(""), text);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].start, text.indexOf("Matrix"));
  assert.equal(chunks[2].start, text.indexOf("graph"));
  assert.equal(chunks[2].cue?.targetId, "plot#peak");
  assert.equal(chunks[0].cue, undefined);
  assert.deepEqual(splitNarrationAtCues("", [cue("x")]), []);
});

test("repeated phrases target their own occurrence and chunk count is bounded", () => {
  const text = Array.from({ length: 20 }, () => "Matrix. ").join("");
  const chunks = splitNarrationAtCues(text, Array.from({ length: 20 }, (_, index) => cue("Matrix", `image#${index}`)));
  assert.equal(chunks.length, 12);
  assert.equal(chunks[0].cue?.targetId, "image#0");
  assert.equal(chunks[1].cue?.targetId, "image#1");
  assert.equal(chunks.map(chunk => chunk.text).join(""), text);
  assert.equal(splitNarrationAtCues(text, [cue("Matrix")], { maxChunks: 1 }).length, 1);
});

test("verified spans preserve matcher punctuation, case and a lone cue at character zero", () => {
  const text = "Matrix → membrane. Matrix moves next.";
  const first = { ...cue("matrix membrane"), kind: "arrow" as const, toTargetId: "image#membrane" };
  const chunks = splitNarrationAtCuePositions(text, [
    { charIndex: 0, matchedToken: "Matrix → membrane", cue: first },
    { charIndex: text.lastIndexOf("Matrix"), matchedToken: "Matrix", cue: cue("matrix", "image#second") },
    { charIndex: 5, matchedToken: "incorrect span", cue: cue("ignored") },
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].cue, first);
  assert.equal(chunks[1].start, text.lastIndexOf("Matrix"));
  assert.equal(chunks.map(chunk => chunk.text).join(""), text);
  const single = splitNarrationAtCuePositions("Matrix", [{ charIndex: 0, matchedToken: "Matrix", cue: first }]);
  assert.equal(single.length, 1);
  assert.ok(single.some(chunk => chunk.cue), "Even a one-chunk interaction needs phrase start playback without timestamps");
});

test("cues fire on actual audio playing, start once, one-ahead synthesis remains serial", async t => {
  const revoked: string[] = [];
  t.mock.method(URL, "createObjectURL", () => `blob:${Math.random()}`);
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  const audio: FakeAudio[] = [];
  const events: string[] = [];
  let activeSynthesis = 0; let maxSynthesis = 0;
  const controller = new AbortController();
  const chunks = splitNarrationAtCues("Matrix first. Graph next.", [cue("Matrix"), cue("Graph", "plot#peak")]);
  const finished = playNarrationPhrases({ chunks, signal: controller.signal,
    synthesize: async () => { activeSynthesis++; maxSynthesis = Math.max(maxSynthesis, activeSynthesis); await turn(); activeSynthesis--; return recording(); },
    createAudio: () => { const element = new FakeAudio(); audio.push(element); return element as unknown as HTMLAudioElement; },
    onStart: () => events.push("start"), onCue: next => events.push(next.targetId),
  });
  await turn(); await turn();
  assert.equal(audio.length, 1);
  assert.deepEqual(events, [], "Synthesis completion does not trigger the pointer");
  audio[0].start(); audio[0].start();
  assert.deepEqual(events, ["start", "image#matrix"], "Buffering/resume must not repeat the cue");
  await turn();
  audio[0].end();
  await turn(); await turn();
  assert.equal(audio.length, 2);
  assert.equal(revoked.length, 1);
  audio[1].start(); audio[1].end();
  await finished;
  assert.deepEqual(events, ["start", "image#matrix", "plot#peak"]);
  assert.equal(maxSynthesis, 1);
  assert.equal(revoked.length, 2);
  assert.ok(audio.every(element => element.paused && element.cleared));
});

test("abort pauses audio, releases URLs and suppresses stale playing handlers", async t => {
  let revoked = 0;
  t.mock.method(URL, "createObjectURL", () => "blob:cancel");
  t.mock.method(URL, "revokeObjectURL", () => { revoked++; });
  const audio = new FakeAudio();
  const controller = new AbortController();
  const events: string[] = [];
  const finished = playNarrationPhrases({ chunks: splitNarrationAtCues("Matrix", [cue("Matrix")]), signal: controller.signal, synthesize: async () => recording(),
    createAudio: () => audio as unknown as HTMLAudioElement, onStart: () => events.push("start"), onCue: () => events.push("cue"),
  });
  await turn();
  const stalePlaying = audio.onplaying;
  const rejected = assert.rejects(finished, { name: "AbortError" });
  controller.abort();
  stalePlaying?.();
  await rejected;
  assert.deepEqual(events, []);
  assert.equal(revoked, 1);
  assert.ok(audio.paused && audio.cleared);
});

test("abort rejects promptly while synthesis is pending and ignores a late result", async t => {
  let created = 0;
  t.mock.method(URL, "createObjectURL", () => { created++; return "blob:late"; });
  const controller = new AbortController();
  let complete!: (audio: Blob) => void;
  const finished = playNarrationPhrases({ chunks: splitNarrationAtCues("Matrix", [cue("Matrix")]), signal: controller.signal,
    synthesize: () => new Promise<Blob>(resolve => { complete = resolve; }),
  });
  await turn();
  const rejected = assert.rejects(finished, { name: "AbortError" });
  controller.abort();
  await rejected;
  complete(recording());
  await turn();
  assert.equal(created, 0);
});

test("autoplay rejection releases resources without firing any teaching cue", async t => {
  let revoked = 0;
  t.mock.method(URL, "createObjectURL", () => "blob:blocked");
  t.mock.method(URL, "revokeObjectURL", () => { revoked++; });
  const audio = new FakeAudio();
  audio.play = async () => { throw new Error("Autoplay blocked"); };
  const events: string[] = [];
  await assert.rejects(playNarrationPhrases({ chunks: splitNarrationAtCues("Matrix", [cue("Matrix")]), signal: new AbortController().signal, synthesize: async () => recording(),
    createAudio: () => audio as unknown as HTMLAudioElement, onCue: () => events.push("cue"),
  }), /Autoplay blocked/);
  assert.deepEqual(events, []);
  assert.equal(revoked, 1);
  assert.ok(audio.paused && audio.cleared);
});

class FakeUtterance {
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  text: string;
  constructor(text: string) { this.text = text; }
}

test("device voices without word boundaries synchronize each interaction to actual utterance start", async () => {
  const spoken: FakeUtterance[] = [];
  const events: string[] = [];
  const speech = { speak: (utterance: SpeechSynthesisUtterance) => { spoken.push(utterance as unknown as FakeUtterance); }, cancel: () => undefined } as unknown as SpeechSynthesis;
  const chunks = splitNarrationAtCues("देखिए। Matrix से protons जाते हैं। Graph देखें।", [cue("Matrix"), cue("Graph", "plot#peak")]);
  const finished = playDeviceNarrationPhrases({ chunks, signal: new AbortController().signal, speech,
    createUtterance: text => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
    onStart: () => events.push("start"), onCue: next => events.push(next.targetId),
  });
  assert.equal(spoken.length, 1);
  assert.deepEqual(events, []);
  spoken[0].onstart?.(); spoken[0].onend?.();
  await turn();
  assert.deepEqual(events, ["start"]);
  spoken[1].onstart?.(); spoken[1].onstart?.(); spoken[1].onend?.();
  await turn();
  spoken[2].onstart?.(); spoken[2].onend?.();
  await finished;
  assert.deepEqual(events, ["start", "image#matrix", "plot#peak"]);
  assert.equal(spoken.map(utterance => utterance.text).join(""), chunks.map(chunk => chunk.text).join(""));
});

test("device phrase cancellation stops speech and prevents late cues or queued utterances", async () => {
  let cancellations = 0;
  const spoken: FakeUtterance[] = [];
  const events: string[] = [];
  const controller = new AbortController();
  const speech = { speak: (utterance: SpeechSynthesisUtterance) => { spoken.push(utterance as unknown as FakeUtterance); }, cancel: () => { cancellations++; } } as unknown as SpeechSynthesis;
  const finished = playDeviceNarrationPhrases({ chunks: splitNarrationAtCues("Matrix then Graph", [cue("Matrix"), cue("Graph")]), signal: controller.signal, speech,
    createUtterance: text => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
    onCue: next => events.push(next.targetId),
  });
  const staleStart = spoken[0].onstart;
  const staleEnd = spoken[0].onend;
  const rejected = assert.rejects(finished, { name: "AbortError" });
  controller.abort();
  staleStart?.(); staleEnd?.();
  await rejected;
  assert.deepEqual(events, []);
  assert.equal(spoken.length, 1);
  assert.equal(cancellations, 1, "A stale event must not cancel speech belonging to a later playback run");
  assert.equal(spoken[0].onstart, null);
});
