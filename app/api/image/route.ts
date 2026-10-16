import { CommonsImageError, fetchCommonsImage } from "@/lib/commons-fetch";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") || "";
  try {
    const { bytes, type } = await fetchCommonsImage(url, request.signal);
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return new Response(error instanceof CommonsImageError ? error.message : "Image unavailable", { status: error instanceof CommonsImageError ? error.status : 502 }); }
}

