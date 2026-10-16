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
  assert.equal(output, "This is bold, italic, both, inline code, and stray  or  or  characters.");
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
