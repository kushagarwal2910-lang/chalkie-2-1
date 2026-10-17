import test from "node:test";
import assert from "node:assert/strict";
import { LessonEntryGuard } from "./lesson-entry.ts";

test("consuming a homepage question then clearing its URL cannot restore the previous lesson", () => {
  const entry = new LessonEntryGuard();
  assert.equal(entry.claimLaunch("Plot y=x^2", "first-request"), true);
  assert.equal(entry.claimRestore(), false);
  assert.equal(entry.claimLaunch("Plot y=x^2", "first-request"), false);
  entry.retryRestore();
  assert.equal(entry.claimRestore(), false, "A stale restore cleanup cannot undo a new-topic decision");
  assert.equal(entry.claimLaunch("Plot y=x^2", "second-request"), true, "An intentional repeat is a new launch");
});

test("ordinary studio visits still restore once and can retry an interrupted mount", () => {
  const entry = new LessonEntryGuard();
  assert.equal(entry.claimRestore(), true);
  assert.equal(entry.claimRestore(), false);
  entry.retryRestore();
  assert.equal(entry.claimRestore(), true);
  assert.equal(entry.claimLaunch("A different question"), true);
  assert.equal(entry.claimRestore(), false);
});
