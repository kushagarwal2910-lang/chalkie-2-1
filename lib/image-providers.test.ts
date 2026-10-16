import test from "node:test";
import assert from "node:assert/strict";
import { candidateScore, imageCandidates, imageSearchQueries, isLibraryImageUrl, openverseAsset, type OpenverseImage } from "./image-providers.ts";

test("image search broadens presentation qualifiers without losing the subject", () => {
  assert.deepEqual(imageSearchQueries("chloroplast diagram cross‑section"), ["chloroplast diagram cross-section", "chloroplast diagram"]);
  assert.deepEqual(imageSearchQueries("labelled flower diagram"), ["labelled flower diagram", "flower diagram"]);
  assert.deepEqual(imageSearchQueries("bee carrying pollen"), ["bee carrying pollen"]);
});

const reference: OpenverseImage = { id: "123", title: "Leaf", url: "https://live.staticflickr.com/1/leaf.jpg", thumbnail: "", foreign_landing_url: "https://flickr.com/photos/example/1", creator: "Photographer", license: "by", license_version: "4.0", width: 800, height: 600 };
test("Openverse rejects paid, unknown, noncommercial, no-derivatives and mature references", () => {
  assert.equal(openverseAsset(reference)?.license, "CC BY 4.0");
  for (const license of ["by-nc", "by-nd", "all-rights-reserved", "unknown"]) assert.equal(openverseAsset({ ...reference, license }), null);
  assert.equal(openverseAsset({ ...reference, mature: true }), null);
  assert.equal(openverseAsset({ ...reference, license_version: "9.0" }), null);
});
test("image proxy only permits approved image paths and rejects credential, redirect and host tricks", () => {
  assert.ok(isLibraryImageUrl(reference.url));
  for (const url of ["https://127.0.0.1/image.jpg", "https://images.metmuseum.org.evil.test/CRDImages/test.jpg", "https://user@images.metmuseum.org/CRDImages/test.jpg", "https://api.openverse.org/v1/images/", "http://live.staticflickr.com/1/leaf.jpg", "https://images.metmuseum.org/other/test.jpg"]) assert.equal(isLibraryImageUrl(url), false);
});
test("a failed primary image search falls through to the independent keyless library", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    assert.ok(!url.includes("tavily"));
    if (url.includes("wikimedia")) return new Response("unavailable", { status: 503 });
    return Response.json({ results: [reference] });
  });
  const candidates = imageCandidates("leaf");
  assert.equal((await candidates.next()).value?.url, reference.url);
  assert.equal(calls.length, 2);
  await candidates.return(undefined);
});

test("candidateScore prefers printed text labels and penalizes numbered-only diagrams", () => {
  const textLabeled: any = { title: "File:Human eye diagram labeled english.svg" };
  const genericDiagram: any = { title: "File:Eye structure.png" };
  const numberedOnly: any = { title: "File:Eye diagram numbered.svg" };
  const blankDiagram: any = { title: "File:Eye anatomy unlabeled.svg" };

  assert.ok(candidateScore(textLabeled) > candidateScore(genericDiagram));
  assert.ok(candidateScore(genericDiagram) > candidateScore(numberedOnly));
  assert.ok(candidateScore(genericDiagram) > candidateScore(blankDiagram));
  assert.ok(candidateScore(numberedOnly) < 0);
});

