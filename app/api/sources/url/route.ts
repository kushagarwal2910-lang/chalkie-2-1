import { z } from "zod";
import { importUrlMaterial } from "@/lib/source-url";

export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z.object({ url: z.string().trim().url().max(2000) });

export async function POST(request: Request) {
  // Same-origin browser calls only. This endpoint must not become an open proxy.
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Import sources from the Chalkie app." }, { status: 403 });
  }
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new Error("The URL request is too large.");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Add a source URL.");
    const buffers: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new Error("The URL request is too large."); }
      buffers.push(value);
    }
    const input = inputSchema.parse(JSON.parse(Buffer.concat(buffers).toString("utf8")));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    const material = await importUrlMaterial(input.url, signal);
    return Response.json({ material }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Enter a valid public URL." : error instanceof Error ? error.message : "This source could not be imported." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
