import { isLibraryImageUrl } from "./image-providers.ts";

export class CommonsImageError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
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
