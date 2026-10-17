import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeNarrationForSpeech } from "./local-speech.ts";
import { formatNarrationForSpeech } from "./speech-formatter.ts";

test("sanitizeNarrationForSpeech strips Markdown asterisks, underscores, and backticks", () => {
  const input = "This is **bold**, *italic*, ***both***, `inline code`, and stray * or # or ~ characters.";
  const output = sanitizeNarrationForSpeech(input);
  assert.ok(!output.includes("*"), "Should not contain asterisks");
  assert.ok(!output.includes("`"), "Should not contain backticks");
  assert.ok(!output.includes("#"), "Should not contain #");
  assert.ok(!output.includes("~"), "Should not contain ~");
  assert.equal(output, "This is bold, italic, both, inline code, and stray or or characters.");
});

test("sanitizeNarrationForSpeech and formatNarrationForSpeech never mangle cross-section into cross-seconds-tion", () => {
  const input = "Look at this cross-section of the eye. Wait 5 sec for the response.";
  const sanitized = sanitizeNarrationForSpeech(input);
  assert.ok(sanitized.includes("cross-section"), "cross-section must be preserved");
  assert.ok(!sanitized.includes("cross-seconds"), "Must not contain cross-seconds");

  const formatted = formatNarrationForSpeech(input);
  assert.ok(formatted.includes("cross-section"), "cross-section must be preserved in formatNarrationForSpeech");
  assert.ok(!formatted.includes("cross-seconds"), "Must not contain cross-seconds in formatNarrationForSpeech");
  assert.ok(formatted.includes("5 seconds"), "5 sec should expand to 5 seconds");
});

test("sanitizeNarrationForSpeech normalizes scientific terms phonetically", () => {
  const input = "cGMP activates protein kinase, while ATP supplies energy to opsins.";
  const output = sanitizeNarrationForSpeech(input);
  assert.ok(output.includes("cyclic G M P"), "cGMP should be normalized to cyclic G M P");
  assert.ok(output.includes("A T P"), "ATP should be normalized to A T P");
  assert.ok(output.includes("op-sins"), "opsins should be normalized to op-sins");
});

test("sanitizeNarrationForSpeech strips subtitles markdown completely (e.g. Tacoma Narrows Bridge)", () => {
  const input = "**Tacoma Narrows Bridge — overall view**";
  const output = sanitizeNarrationForSpeech(input, "hi-IN");
  assert.equal(output, "Tacoma Narrows Bridge — overall view");
  assert.ok(!output.includes("*"));
});

test("sanitizeNarrationForSpeech handles Hindi and English numeric ranges without 'minus'", () => {
  const hindiInput = "हवा की गति 35-46 mph तक पहुँच गई थी";
  const hindiOutput = sanitizeNarrationForSpeech(hindiInput, "hi-IN");
  assert.ok(hindiOutput.includes("35 से 46"), `Expected '35 से 46', got: ${hindiOutput}`);

  const englishInput = "The wind speed was 35-46 mph";
  const englishOutput = sanitizeNarrationForSpeech(englishInput, "en-US");
  assert.ok(englishOutput.includes("35 to 46"), `Expected '35 to 46', got: ${englishOutput}`);
});

test("sanitizeNarrationForSpeech handles vs / versus in Hindi and English", () => {
  const hindiInput = "damped oscillation vs resonant amplification";
  const hindiOutput = sanitizeNarrationForSpeech(hindiInput, "hi-IN");
  assert.ok(hindiOutput.includes("वर्सेस"), `Expected 'वर्सेस', got: ${hindiOutput}`);

  const englishInput = "damped oscillation vs resonant amplification";
  const englishOutput = sanitizeNarrationForSpeech(englishInput, "en-US");
  assert.ok(englishOutput.includes("versus"), `Expected 'versus', got: ${englishOutput}`);
});

test("sanitizeNarrationForSpeech formats formula f = St U / D correctly", () => {
  const formula = "f = St U / D";
  const output = sanitizeNarrationForSpeech(formula);
  assert.ok(output.includes("divided by"), `Expected 'divided by', got: ${output}`);
  assert.ok(!output.includes("STUD"), "Must not form the word STUD");
  assert.ok(output.includes("S t U") || output.includes("St U"), "Variables should be spaced");
});

test("sanitizeNarrationForSpeech strips internal node IDs from narration", () => {
  const input = "इस चरण को n3 बॉक्स में दर्शाया गया है, जैसा कि n2 चित्र में और n1 का आरेख (n4) दिखाता है.";
  const output = sanitizeNarrationForSpeech(input, "hi-IN");
  assert.ok(!/\bn[1-6]\b/.test(output), `Must not contain n1..n6, got: ${output}`);
  assert.ok(output.includes("बॉक्स में"), "Should keep the noun 'बॉक्स में'");
  assert.ok(output.includes("चित्र में"), "Should keep the noun 'चित्र में'");
  assert.ok(!output.includes("(n4)"), "Should remove (n4)");
});

