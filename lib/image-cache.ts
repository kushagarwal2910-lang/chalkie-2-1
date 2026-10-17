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
  // Locally compiled SVG plots, scientific graphs, user/generated pixels never go through the remote proxy.
  if (url.startsWith("data:")) {
    if (url.length > 25_000_000) throw new Error("Image is too large");
    try {
      const response = await fetch(url, { signal });
      return await response.blob();
    } catch {
      // Fallback manual data URL parser in case fetch(data:) encounters browser quirks
      const match = url.match(/^data:([^;,]+)?(?:;(base64))?,(.*)$/);
      if (match) {
        const mimeType = match[1] || "image/png";
        const isBase64 = match[2] === "base64";
        const data = match[3];
        if (isBase64) {
          const binary = atob(data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return new Blob([bytes], { type: mimeType });
        } else {
          return new Blob([decodeURIComponent(data)], { type: mimeType });
        }
      }
      throw new Error("Invalid data URL");
    }
  }
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
