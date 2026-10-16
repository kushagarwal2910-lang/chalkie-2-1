/** Store image bytes independently of lightweight lesson JSON. */
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("chalkie-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadImageBlob(id: string, url: string, signal: AbortSignal): Promise<Blob> {
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const cached = await new Promise<Blob | undefined>((resolve, reject) => {
      const req = db!.transaction("images").objectStore("images").get(id);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    if (cached instanceof Blob) return cached;
  } catch { /* caching is optional */ }
  finally { db?.close(); }
  const response = await fetch(`/api/image?${new URLSearchParams({ url })}`, { signal });
  if (!response.ok) throw new Error("Reference image could not load");
  const blob = await response.blob();
  try {
    db = await database();
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(blob, id);
    tx.oncomplete = tx.onerror = () => db?.close();
  } catch { db?.close(); }
  return blob;
}
