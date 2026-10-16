import test from "node:test";
import assert from "node:assert/strict";
import { fetchCommonsImage } from "./commons-fetch.ts";

const url = "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e0/Heart.svg/960px-Heart.svg.png";
test("Commons images are fetched with redirects blocked and bytes ready for vision", async t => {
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return new Response(bytes, { headers: { "Content-Type": "image/png" } });
  });
  const image = await fetchCommonsImage(url);
  assert.equal(image.type, "image/png");
  assert.equal(image.bytes.toString("base64"), "iVBORw==");
});
test("untrusted hosts and HTML errors never become vision input", async t => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response("error", { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(fetchCommonsImage("https://example.com/image.png"), { status: 400 });
  assert.equal(request.mock.callCount(), 0);
  await assert.rejects(fetchCommonsImage(url), { status: 502 });
});
test("image body size is bounded even without a Content-Length header", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(6 * 1024 * 1024 + 1), { headers: { "Content-Type": "image/png" } }));
  await assert.rejects(fetchCommonsImage(url), { status: 413 });
});
