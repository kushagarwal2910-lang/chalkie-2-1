import test from "node:test";
import assert from "node:assert/strict";
import { requireResearchEvidence } from "./research-evidence.ts";
import { isStructuredOutputFailure } from "./plan-retry.ts";

test("missing research blocks live generation instead of knowledge fallback", () => {
  for (const [context, sources] of [["", []], ["   ", [{ summary: "evidence" }]], ["context", []], ["context", [{ summary: "  " }]]] as const) {
    assert.throws(() => requireResearchEvidence(context, sources), { code: "NO_RESEARCH_EVIDENCE" });
  }
});
test("retrieved content permits generation", () => {
  assert.doesNotThrow(() => requireResearchEvidence("[1] Retrieved passage", [{ summary: "Retrieved source" }]));
});
test("only structured output failures get a plan retry, not configuration or authentication errors", () => {
  assert.equal(isStructuredOutputFailure(400, '{"error":{"code":"json_validate_failed"}}'), true);
  for (const [status, body] of [[401, '{"error":{"code":"invalid_api_key"}}'], [400, '{"error":{"code":"model_not_found"}}'], [429, '{}'], [400, 'invalid body']] as const) assert.equal(isStructuredOutputFailure(status, body), false);
});
