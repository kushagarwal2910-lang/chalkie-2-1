import { isLibraryImageUrl } from "./image-providers.ts";
import { isCommonsImageUrl } from "./commons-images.ts";

export class CommonsImageError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/**
 * Returns a 640px-800px width thumbnail URL suitable for low-token VLM inspection.
 * Keeps vision LLM token costs ~80% lower than full 1200px+ images while preserving
 * exact [0..1] normalized coordinate precision.
 */
export function getVlmThumbnailUrl(url: string, targetWidth = 640): string {
  if (!url || typeof url !== "string") return "";
  if (url.startsWith("data:")) return url;

  if (isCommonsImageUrl(url)) {
    if (url.includes("/thumb/")) {
      return url.replace(/\/\d+px-/, `/${targetWidth}px-`);
    }
    const match = url.match(/\/wikipedia\/commons\/([a-f0-9]\/[a-f0-9]{2}\/([^/?#]+))/i);
    if (match) {
      const fullPath = match[1];
      const filename = match[2];
      const extSuffix = filename.toLowerCase().endsWith(".svg") ? ".png" : "";
      return `https://upload.wikimedia.org/wikipedia/commons/thumb/${fullPath}/${targetWidth}px-${filename}${extSuffix}`;
    }
  }

  return url;
}

/** Fetch once on our server: Commons can reject a provider's remote URL fetch. */
export async function fetchCommonsImage(url: string, signal?: AbortSignal) {
  if (url.length > 2048 || !isLibraryImageUrl(url)) throw new CommonsImageError("Invalid image", 400);
  const response = await fetch(url, {
    redirect: "error", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]),
    headers: { "User-Agent": "Chalkie/2.0 (https://github.com/kushagarwal2910-lang/chalkie)" },
  });
  const type = (response.headers.get("content-type") || "").split(";")[0].trim();
  if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(type) || !response.body) {
    await response.body?.cancel();
    throw new CommonsImageError("Image unavailable", 502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 6 * 1024 * 1024) { await reader.cancel(); throw new CommonsImageError("Image too large", 413); }
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), type };
}
