"use client";

import { sourceMaterialsSchema, type SourceMaterial } from "./source-materials.ts";

type SavedSources = { materials: SourceMaterial[]; includeWebSearch: boolean };

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("chalkie-source-materials", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSourceMaterials(sessionId: string): Promise<SavedSources | null> {
  await pendingWrites.get(sessionId)?.catch(() => undefined);
  const db = await database();
  try {
    const saved = await new Promise<SavedSources | undefined>((resolve, reject) => {
      const request = db.transaction("sessions", "readonly").objectStore("sessions").get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!saved) return null;
    return { materials: sourceMaterialsSchema.parse(saved.materials), includeWebSearch: saved.includeWebSearch !== false };
  } finally { db.close(); }
}

const pendingWrites = new Map<string, Promise<void>>();

export function saveSourceMaterials(sessionId: string, materials: SourceMaterial[], includeWebSearch: boolean): Promise<void> {
  // A delayed form save must not overtake newer extraction from a live response.
  const write = (pendingWrites.get(sessionId) ?? Promise.resolve()).catch(() => undefined)
    .then(() => writeSourceMaterials(sessionId, materials, includeWebSearch));
  pendingWrites.set(sessionId, write);
  void write.finally(() => { if (pendingWrites.get(sessionId) === write) pendingWrites.delete(sessionId); }).catch(() => undefined);
  return write;
}

async function writeSourceMaterials(sessionId: string, materials: SourceMaterial[], includeWebSearch: boolean) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put({ materials, includeWebSearch }, sessionId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function clearSourceMaterials(sessionId?: string) {
  await Promise.allSettled(sessionId ? [pendingWrites.get(sessionId) ?? Promise.resolve()] : [...pendingWrites.values()]);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      const store = transaction.objectStore("sessions");
      if (sessionId) store.delete(sessionId); else store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
