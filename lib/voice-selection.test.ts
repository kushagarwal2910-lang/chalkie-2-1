import test from "node:test";
import assert from "node:assert/strict";
import { getBestAvailableVoice, readAvatarVoicePreferences, voicePreferenceKey } from "./voice-selection.ts";

const voice = (name: string, lang = "en-US") => ({ name, lang, voiceURI: name } as SpeechSynthesisVoice);
const windows = [voice("Microsoft David"), voice("Microsoft Mark"), voice("Microsoft Zira")];

test("Mira and Arjun select matching Windows voices", () => {
  assert.equal(getBestAvailableVoice(windows, null, "mira")?.name, "Microsoft Zira");
  assert.equal(getBestAvailableVoice(windows, null, "arjun")?.name, "Microsoft David");
});
test("matching avatar voice takes precedence over mismatched neural voice", () => {
  const voices = [...windows, voice("Microsoft Guy Online (Natural)")];
  assert.equal(getBestAvailableVoice(voices, null, "mira")?.name, "Microsoft Zira");
  assert.equal(getBestAvailableVoice(voices, null, "arjun")?.name, "Microsoft Guy Online (Natural)");
  assert.equal(getBestAvailableVoice([...voices, voice("Microsoft Jenny Online (Natural)")], null, "mira")?.name, "Microsoft Jenny Online (Natural)");
});
test("male matching does not accidentally match female and explicit choices win", () => {
  const voices = [voice("Google UK English Female"), voice("Google UK English Male")];
  assert.equal(getBestAvailableVoice(voices, null, "arjun")?.name, "Google UK English Male");
  assert.equal(getBestAvailableVoice(windows, "Microsoft Mark", "mira")?.name, "Microsoft Mark");
  assert.equal(getBestAvailableVoice(windows, "Unavailable voice", "mira")?.name, "Microsoft Zira");
  assert.equal(getBestAvailableVoice([], null, "mira"), null);
});
test("voice, pitch and pace preferences are isolated per avatar", () => {
  const values = new Map([[voicePreferenceKey("arjun"), JSON.stringify({ uri: "Microsoft Mark", pitch: 0.98, rate: 1.08 })], ["chalkie:preferred-voice", "Microsoft David"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.deepEqual(readAvatarVoicePreferences("arjun", storage), { uri: "Microsoft Mark", pitch: 0.98, rate: 1.08 });
  assert.deepEqual(readAvatarVoicePreferences("mira", storage), { uri: null, pitch: 1.04, rate: 0.92 });
});
test("corrupt and out-of-range saved settings fall back safely", () => {
  for (const value of ["null", "broken", '{"uri":{},"rate":9,"pitch":-2}']) {
    assert.deepEqual(readAvatarVoicePreferences("mira", { getItem: () => value }), { uri: null, pitch: 1.04, rate: 0.92 });
  }
  assert.equal(getBestAvailableVoice([voice("Unknown voice"), voice("Microsoft David")], null, "mira")?.name, "Unknown voice");
});
