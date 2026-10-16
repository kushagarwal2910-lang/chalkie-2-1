import test from "node:test";
import assert from "node:assert/strict";
import { relevantExcerpt, researchQuery, sourceAuthority, usableEvidenceUrl } from "./research-quality.ts";

test("research omits presentation instructions but preserves the subject", () => {
  assert.equal(researchQuery("Explain flower pollination. Include a freely sourced labelled flower diagram and point out the relevant visible parts."), "Explain flower pollination.");
  assert.equal(researchQuery("Show me a diagram of an engine"), "Show me a diagram of an engine");
  assert.equal(researchQuery("Why does it rain? What causes clouds?"), "Why does it rain? What causes clouds?");
});
test("stock catalogs and social listings are not teaching evidence", () => {
  for (const url of ["https://www.shutterstock.com/search/flower", "https://facebook.com/groups/1", "https://brainly.in/question/1", "file:///secret"]) assert.equal(usableEvidenceUrl(url), false);
  assert.ok(usableEvidenceUrl("https://www.nps.gov/teachers/lesson"));
  assert.equal(sourceAuthority("https://web.extension.illinois.edu/page"), 1);
  assert.equal(sourceAuthority("https://nps.gov.example.com/page"), 0);
});
test("retrieval keeps relevant content beyond the old 550-character cutoff", () => {
  const text = `${"Site navigation and links. ".repeat(35)} The test mechanism transfers energy between rotating parts. ${"More unrelated navigation. ".repeat(20)}`;
  const excerpt = relevantExcerpt("mechanism transfers energy rotating parts", text);
  assert.ok(excerpt.includes("transfers energy between rotating parts"));
  assert.ok(excerpt.length <= 700);
});
