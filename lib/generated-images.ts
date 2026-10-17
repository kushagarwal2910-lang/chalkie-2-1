import { createHash } from "node:crypto";
import type { ImageAsset } from "./lesson-schema.ts";

export function imageGenerationAvailable() { return Boolean(process.env.FAL_KEY || process.env.LOCAL_IMAGE_ENDPOINT); }

async function readGenerationJson(response: Response): Promise<{ images?: { url?: string }[] }> {
  const limit = 8_100_000;
  if (!response.body || Number(response.headers.get("content-length") ?? 0) > limit) {
    await response.body?.cancel();
    throw new Error("Illustration provider response exceeds the image limit");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Illustration provider response exceeds the image limit"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

export async function generateIllustration(query: string, intent: "canonical" | "story" | "analogy", signal?: AbortSignal): Promise<ImageAsset | null> {
  signal?.throwIfAborted();
  if (!imageGenerationAvailable()) return null;
  const model = process.env.CHALKIE_IMAGE_MODEL === "flux-schnell" ? "fal-ai/flux/schnell" : "fal-ai/z-image/turbo";
  // A local endpoint is operator-configured, never supplied by a browser request.
  const endpoint = process.env.LOCAL_IMAGE_ENDPOINT || `https://fal.run/${model}`;
  const prompt = `Educational illustrative reconstruction: ${query}. ${intent === "canonical" ? "Conceptual illustration, not an authoritative scientific diagram." : intent === "story" ? "A conceptual reconstruction of the described scenario, never a documentary photograph." : "A clear physical analogy that makes the mechanism easy to understand."} Simple composition, high contrast, no text, no labels, no invented numerical measurements.`;
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", ...(process.env.FAL_KEY && !process.env.LOCAL_IMAGE_ENDPOINT ? { Authorization: `Key ${process.env.FAL_KEY}` } : {}) },
    body: JSON.stringify({ prompt, image_size: "landscape_4_3", num_inference_steps: model.includes("schnell") ? 4 : 8, num_images: 1, sync_mode: true, enable_safety_checker: true, output_format: "jpeg" }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]), redirect: "error",
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Illustration provider unavailable (${response.status})`); }
  const body = await readGenerationJson(response);
  const asset = body.images?.[0];
  // sync_mode returns inline pixels. Do not turn the image proxy into an arbitrary URL fetcher.
  if (typeof asset?.url !== "string" || asset.url.length > 8_000_000 || !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(asset.url)) throw new Error("Illustration provider did not return supported inline image data");
  const { imageSize } = await import("image-size");
  const size = imageSize(Buffer.from(asset.url.split(",")[1], "base64"));
  const mimeType = asset.url.slice(11, asset.url.indexOf(";"));
  if ((size.type === "jpg" ? "jpeg" : size.type) !== mimeType || !size.width || !size.height || size.width < 150 || size.height < 150 || size.width > 4096 || size.height > 4096) throw new Error("Invalid illustration dimensions or image type");
  const id = `generated-${createHash("sha256").update(asset.url).digest("hex").slice(0,24)}`;
  return { id, title: `AI illustration: ${query}`.slice(0,300), url: asset.url, sourceUrl: process.env.LOCAL_IMAGE_ENDPOINT ? "about:blank#local-image-model" : "https://fal.ai/models/" + model, author: process.env.LOCAL_IMAGE_ENDPOINT ? "Local image model" : model, license: "AI-generated illustration · not evidence", licenseUrl: process.env.LOCAL_IMAGE_ENDPOINT ? "about:blank#local-image-model-terms" : "https://fal.ai/terms", width: size.width, height: size.height, regions: [], provenance: "generated", description: "AI-generated conceptual illustration. It is not documentary or scientific evidence." };
}
