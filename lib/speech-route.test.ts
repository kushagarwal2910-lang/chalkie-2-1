import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../app/api/speech/route.ts";

async function withEnvironment(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { await run(); }
  finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
const body = { text: "नमस्ते graph", settings: { mode: "code-switch", language: "hi-IN" }, speed: 0.92, provider: "auto" };
const request = (value: unknown = body) => new Request("http://localhost/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

test("speech works without provider credentials by reporting device/caption alternatives", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider request expected"); });
  await withEnvironment({ SARVAM_API_KEY: undefined, ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined }, async () => {
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /device voice \(no account needed\)/);
    assert.equal(fetch.mock.callCount(), 0);
  });
});

test("availability exposes configuration booleans without server secrets", async () => {
  await withEnvironment({ SARVAM_API_KEY: "test-secret-never-client", ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined }, async () => {
    const response = await GET();
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const result = await response.text();
    assert.ok(!result.includes("test-secret-never-client"));
    assert.equal(JSON.parse(result).providers.sarvam.configured, true);
  });
});

test("Sarvam uses the verified Bulbul v3 contract and never invents timestamps", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model, "bulbul:v3");
    assert.equal(payload.language_code, "hi-IN");
    assert.equal(payload.text, body.text);
    assert.equal(payload.pace, body.speed);
    assert.equal(payload.output_audio_codec, "mp3");
    assert.equal(payload.target_language_code, undefined);
    return Response.json({ audios: [Buffer.from("test-audio").toString("base64")] });
  });
  await withEnvironment({ SARVAM_API_KEY: "fake", ELEVENLABS_API_KEY: undefined }, async () => {
    const response = await POST(request());
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.provider, "sarvam");
    assert.equal(result.timingSource, "none");
    assert.deepEqual(result.alignment, []);
    assert.equal(fetch.mock.callCount(), 1);
  });
});

test("ElevenLabs returns validated original-text alignment for graph cue timing", async t => {
  const text = "Hola graph";
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.match(String(url), /\/with-timestamps\?/);
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model_id, "eleven_flash_v2_5");
    assert.equal(payload.language_code, "es");
    return Response.json({ audio_base64: Buffer.from("test-audio").toString("base64"), alignment: {
      characters: [...text], character_start_times_seconds: [...text].map((_, i) => i / 10), character_end_times_seconds: [...text].map((_, i) => (i + 1) / 10),
    } });
  });
  await withEnvironment({ ELEVENLABS_API_KEY: "fake", ELEVENLABS_VOICE_ID: "voice-id", SARVAM_API_KEY: undefined }, async () => {
    const response = await POST(request({ ...body, text, settings: { mode: "native", language: "es-ES" } }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.timingSource, "provider");
    assert.deepEqual(result.alignment[1], { text: "graph", charIndex: 5, charLength: 5, start: 0.5, end: 1 });
  });
});

test("malformed, oversized, cross-site and unsupported language requests never reach providers", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider request expected"); });
  for (const value of [null, { ...body, text: "x".repeat(2501) }, { ...body, speed: 9 }, { ...body, settings: { mode: "native", language: "xx-XX" } }, { ...body, provider: "unknown" }]) assert.equal((await POST(request(value))).status, 400);
  const crossSite = new Request("http://localhost/api/speech", { method: "POST", headers: { Origin: "https://other.example" }, body: JSON.stringify(body) });
  assert.equal((await POST(crossSite)).status, 403);
  assert.equal(fetch.mock.callCount(), 0);
});

test("provider authentication failures hide provider payloads and suggest device speech", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "sensitive-provider-debug" }, { status: 401 }));
  await withEnvironment({ SARVAM_API_KEY: "fake" }, async () => {
    const response = await POST(request());
    assert.equal(response.status, 503);
    const result = await response.text();
    assert.ok(!result.includes("sensitive-provider-debug"));
    assert.match(result, /device voice/);
  });
});

test("cancelling narration cancels the provider request", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    assert.ok(options?.signal);
    controller.abort();
    options.signal.throwIfAborted();
    return Response.json({});
  });
  await withEnvironment({ SARVAM_API_KEY: "fake" }, async () => {
    const incoming = new Request("http://localhost/api/speech", { method: "POST", body: JSON.stringify(body), signal: controller.signal });
    assert.equal((await POST(incoming)).status, 499);
  });
});
