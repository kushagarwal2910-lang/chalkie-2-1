import test from "node:test";
import assert from "node:assert/strict";
import { getLessonLanguagePrompt, getMatchingDeviceVoice, normalizeLessonLanguage } from "./lesson-language.ts";
import { characterAlignmentToWords, ELEVENLABS_LANGUAGE_CODES, SARVAM_LANGUAGE_CODES, selectRemoteSpeechProvider, type SpeechAvailability } from "./remote-speech.ts";

test("code-switch preserves English board terms while native mode localizes both", () => {
  const mixed = getLessonLanguagePrompt({ language: "te-IN", mode: "code-switch" });
  assert.match(mixed, /Board language is English/);
  assert.match(mixed, /Spoken language is Telugu/);
  assert.match(mixed, /exact phrase from the spoken narration/);
  const native = getLessonLanguagePrompt({ language: "hi-IN", mode: "native" });
  assert.match(native, /Board language is Hindi/);
  assert.match(native, /Never translate stable object IDs/);
  assert.deepEqual(normalizeLessonLanguage({ language: "Spanish", mode: "code-switch" }), { language: "es-ES", mode: "code-switch" });
  assert.deepEqual(normalizeLessonLanguage({ language: "unrecognized", mode: "code-switch" }), { language: "en-US", mode: "native" });
});

test("regional voice selection never falls back to an English voice", () => {
  const voice = (name: string, lang: string) => ({ name, lang, voiceURI: name }) as SpeechSynthesisVoice;
  const english = voice("Natural English", "en-US");
  const hindi = voice("Hindi", "hi-IN");
  const naturalHindi = voice("Natural Hindi", "hi-IN");
  const settings = { language: "hi-IN", mode: "native" } as const;
  assert.equal(getMatchingDeviceVoice([english], settings), null);
  assert.equal(getMatchingDeviceVoice([english, hindi, naturalHindi], settings), naturalHindi);
  assert.equal(getMatchingDeviceVoice([english, hindi, naturalHindi], settings, hindi.voiceURI), hindi);
  assert.equal(getMatchingDeviceVoice([english, hindi], settings, english.voiceURI), hindi);
});

test("provider routing respects configured capabilities and explicit choice", () => {
  const availability: SpeechAvailability = { providers: {
    sarvam: { configured: true, model: "bulbul:v3", languages: Object.keys(SARVAM_LANGUAGE_CODES), wordTimestamps: false },
    elevenlabs: { configured: true, model: "eleven_flash_v2_5", languages: ELEVENLABS_LANGUAGE_CODES, wordTimestamps: true },
  } };
  assert.equal(selectRemoteSpeechProvider({ mode: "code-switch", language: "hi-IN" }, availability), "sarvam");
  assert.equal(selectRemoteSpeechProvider({ mode: "native", language: "es-ES" }, availability), "elevenlabs");
  assert.equal(selectRemoteSpeechProvider({ mode: "native", language: "te-IN" }, availability, "elevenlabs"), null);
  availability.providers.sarvam.configured = false;
  assert.equal(selectRemoteSpeechProvider({ mode: "native", language: "te-IN" }, availability), null);
  assert.equal(selectRemoteSpeechProvider({ mode: "native", language: "hi-IN" }, availability), "elevenlabs");
});

test("provider character timing maintains UTF-16 cue offsets across Unicode scripts", () => {
  const text = "🙂 नमस्ते graph";
  const characters = [...text];
  const words = characterAlignmentToWords({ characters, character_start_times_seconds: characters.map((_, i) => i / 10), character_end_times_seconds: characters.map((_, i) => (i + 1) / 10) }, text, "hi-IN");
  const graph = words.find(word => word.text === "graph")!;
  assert.equal(graph.charIndex, text.indexOf("graph"));
  assert.equal(graph.charLength, 5);
  assert.equal(graph.start, characters.indexOf("g") / 10);
  assert.ok(words.some(word => word.text === "नमस्ते"));
  assert.deepEqual(characterAlignmentToWords({ characters: ["a"], character_start_times_seconds: [1], character_end_times_seconds: [0] }, "a", "en-US"), []);
  assert.deepEqual(characterAlignmentToWords({ characters: ["a"], character_start_times_seconds: [0], character_end_times_seconds: [1] }, "b", "en-US"), [], "Normalized text cannot be misreported as original cue offsets");
});
