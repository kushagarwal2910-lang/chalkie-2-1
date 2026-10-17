import test from "node:test";
import assert from "node:assert/strict";
import { SourceSessionGuard } from "./source-session.ts";
import { loadSourceMaterials, saveSourceMaterials } from "./source-storage.ts";
import type { SourceMaterial } from "./source-materials.ts";

test("navigation and fresh generation invalidate pending source restoration", async () => {
  const guard = new SourceSessionGuard();
  const old = guard.begin(true);
  let resolveOld!: () => void;
  let applied = "";
  const pending = new Promise<void>(resolve => { resolveOld = resolve; }).then(() => {
    if (guard.isCurrent(old)) applied = "stale lesson sources";
    guard.finish(old);
  });
  const next = guard.begin(true);
  resolveOld();
  await pending;
  assert.equal(applied, "");
  assert.equal(guard.restoring, true, "An old completion cannot unblock a newer restore");
  assert.equal(guard.finish(next), true);
  assert.equal(guard.restoring, false);
  const restoring = guard.begin(true);
  const generation = guard.begin(false);
  assert.equal(guard.isCurrent(restoring), false);
  assert.equal(guard.isCurrent(generation), true);
  assert.equal(guard.restoring, false, "Fresh URL generation does not wait on unrelated hydration");
});

test("session writes remain ordered and restoration waits for the latest extraction", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const stored = new Map<string, unknown>();
  const writes: { session: string; finish: () => void }[] = [];
  const opened: string[] = [];
  const fakeDatabase = {
    close() {},
    transaction(_store: string, mode: string) {
      const transaction = { oncomplete: null as (() => void) | null, onerror: null, onabort: null, objectStore() {
        return {
          put(value: unknown, session: string) { writes.push({ session, finish: () => { stored.set(session, value); transaction.oncomplete?.(); } }); },
          get(session: string) {
            const request = { result: undefined as unknown, onsuccess: null as (() => void) | null, onerror: null };
            queueMicrotask(() => { request.result = stored.get(session); request.onsuccess?.(); });
            return request;
          },
        };
      } };
      opened.push(mode);
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() {
    const request = { result: fakeDatabase, onsuccess: null as (() => void) | null, onerror: null, onupgradeneeded: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } } });
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  const material = (text: string): SourceMaterial => ({ id: "notes", title: "Notes", kind: "text", text, images: [] });
  try {
    const first = saveSourceMaterials("session-a", [material("Original source text before extraction.")], false);
    const second = saveSourceMaterials("session-a", [material("Updated source text extracted from the PDF.")], false);
    const other = saveSourceMaterials("session-b", [material("A different lesson's source material.")], true);
    let restored = false;
    const restoration = loadSourceMaterials("session-a").then(result => { restored = true; return result; });
    await turn();
    assert.deepEqual(writes.map(write => write.session).sort(), ["session-a", "session-b"], "Only one write per session is in flight");
    assert.equal(opened.filter(mode => mode === "readonly").length, 0, "A read must wait for queued extraction");
    writes.find(write => write.session === "session-a")!.finish();
    writes.find(write => write.session === "session-b")!.finish();
    await first; await other; await turn();
    assert.equal(writes.length, 3);
    assert.equal(restored, false);
    writes[2].finish();
    await second;
    const result = await restoration;
    assert.match(result!.materials[0].text, /Updated source text/);
    assert.equal(result!.includeWebSearch, false);
    assert.match((await loadSourceMaterials("session-b"))!.materials[0].text, /different lesson/);
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
