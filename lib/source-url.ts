import { fetchPublicSource, validateSourceUrl } from "./safe-source-fetch.ts";
import { SOURCE_LIMITS, sourceMaterialSchema, type SourceMaterial } from "./source-materials.ts";

export function decodeSourceEntities(text: string) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? original;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  });
}

export function readableSourceHtml(html: string) {
  const title = decodeSourceEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, " ") ?? "Web source").trim().slice(0, 180);
  const clean = html.replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const main = clean.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] ?? clean;
  const text = decodeSourceEntities(main.replace(/<\/(?:p|div|h[1-6]|li|section|tr)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim().slice(0, SOURCE_LIMITS.textCharacters);
  return { title, text };
}

export function youtubeVideoId(url: URL) {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return null;
  const candidate = host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1];
  return candidate && /^[\w-]{11}$/.test(candidate) ? candidate : null;
}

function playerJson(html: string): { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string; languageCode?: string }> } }; videoDetails?: { title?: string } } | null {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/g.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  if (html[start] !== "{") return null;
  let depth = 0, quoted = false, escaped = false;
  for (let cursor = start; cursor < html.length; cursor += 1) {
    const char = html[cursor];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) { try { return JSON.parse(html.slice(start, cursor + 1)); } catch { return null; } }
  }
  return null;
}

export async function importUrlMaterial(input: string, signal?: AbortSignal): Promise<SourceMaterial> {
  const url = validateSourceUrl(input);
  const videoId = youtubeVideoId(url);
  const page = await fetchPublicSource(videoId ? `https://www.youtube.com/watch?v=${videoId}` : url.href, signal);
  if (videoId) {
    const player = playerJson(page.text);
    const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = tracks.find(value => value.languageCode === "en") ?? tracks[0];
    if (!track?.baseUrl) throw new Error("YouTube did not expose a public transcript for this video. Open Show transcript in YouTube, then paste it in Text / transcript.");
    const captionUrl = new URL(track.baseUrl);
    if (captionUrl.hostname !== "www.youtube.com" || captionUrl.pathname !== "/api/timedtext") throw new Error("This video's transcript must be pasted manually.");
    captionUrl.searchParams.set("fmt", "json3");
    const captions = await fetchPublicSource(captionUrl.href, signal);
    let text = "";
    try {
      const body = JSON.parse(captions.text) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
      text = (body.events ?? []).flatMap(event => event.segs?.map(segment => segment.utf8 ?? "") ?? []).join(" ").replace(/\s+/g, " ").trim();
    } catch { text = readableSourceHtml(captions.text).text; }
    if (text.length < 20) throw new Error("YouTube did not return a readable transcript. Paste the video's transcript in Text / transcript.");
    return sourceMaterialSchema.parse({ id: crypto.randomUUID(), kind: "youtube", title: player?.videoDetails?.title || "YouTube transcript", url: `https://www.youtube.com/watch?v=${videoId}`, text: text.slice(0, SOURCE_LIMITS.textCharacters), images: [] });
  }
  const content = /html/.test(page.contentType) ? readableSourceHtml(page.text) : { title: url.hostname, text: page.text.trim().slice(0, SOURCE_LIMITS.textCharacters) };
  if (content.text.length < 80) throw new Error("This page has too little readable text or requires JavaScript/sign-in. Paste a relevant excerpt instead.");
  return sourceMaterialSchema.parse({ id: crypto.randomUUID(), kind: "url", ...content, url: page.url, images: [] });
}
