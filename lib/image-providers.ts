import { commonsAsset, isCommonsImageUrl, type CommonsPage } from "./commons-images.ts";
import type { ImageAsset } from "./lesson-schema.ts";

export type ImageProvider = "commons" | "openverse";
const headers = { "User-Agent": "Chalkie/2.0 (https://github.com/kushagarwal2910-lang/chalkie)" };
const clean = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/<[^>]*>/g, "").slice(0, limit) : "";
const https = (value: unknown): value is string => { try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } };

/** Only known public image CDNs; never proxy arbitrary search-result URLs. */
export function isLibraryImageUrl(value: string): boolean {
  if (isCommonsImageUrl(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    return (/^(live|farm\d+)\.staticflickr\.com$/.test(url.hostname) && /\.(jpg|jpeg|png)$/i.test(url.pathname))
      || (url.hostname === "api.openverse.org" && /^\/v1\/images\/[a-f0-9-]{36}\/thumb\/$/.test(url.pathname));
  } catch { return false; }
}

export type OpenverseImage = { id: string; title: string; url: string; thumbnail: string; foreign_landing_url: string; creator: string | null; license: string; license_version: string; width: number | null; height: number | null; mature?: boolean };
export function openverseAsset(item: OpenverseImage): ImageAsset | null {
  if (item.mature || !["cc0", "pdm", "by", "by-sa"].includes(item.license) || /watermark/i.test(item.title) || !https(item.foreign_landing_url)) return null;
  const attribution = item.license === "by" || item.license === "by-sa";
  if (attribution && !/^[1-4]\.0$/.test(item.license_version)) return null;
  const url = isLibraryImageUrl(item.url) ? item.url : item.thumbnail;
  if (!isLibraryImageUrl(url)) return null;
  return { id: `openverse-${item.id}`, title: clean(item.title, 300), url, sourceUrl: item.foreign_landing_url,
    author: clean(item.creator, 500) || "See original source", license: attribution ? `CC ${item.license.toUpperCase()} ${item.license_version}` : item.license === "cc0" ? "CC0" : "Public domain",
    licenseUrl: attribution ? `https://creativecommons.org/licenses/${item.license}/${item.license_version}/` : `https://creativecommons.org/publicdomain/${item.license === "cc0" ? "zero" : "mark"}/1.0/`,
    // Correct dimensions are read from the downloaded bytes before vision/layout.
    width: item.width || 1, height: item.height || 1, regions: [] };
}

async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { headers, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]) });
  if (!response.ok) throw new Error("Image search temporarily unavailable");
  return response.json();
}

export function candidateScore(a: ImageAsset): number {
  let score = 0;
  const title = a.title.toLowerCase();
  // Prefer printed English text labels on the diagram
  if (/(?:\benglish\b|[-_]en[.\s_-])/.test(title)) score += 3;
  if (/\b(labeled|labelled|annotated|diagram|with labels)\b/.test(title)) score += 4;
  // Penalize numbered-only diagrams or blind numbered legends
  if (/\b(numbered|numbers|numbers only|unlabeled|unlabelled|blank)\b/.test(title)) score -= 6;
  return score;
}

/** Standalone image search: no Tavily key, research index, or LLM call. */
export async function searchImageProvider(provider: ImageProvider, query: string, signal?: AbortSignal): Promise<ImageAsset[]> {
  if (provider === "commons") {
    const params = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `${query} -watermark`, gsrnamespace: "6", gsrlimit: "6", prop: "imageinfo", iiprop: "url|size|mime|extmetadata|sha1", iiurlwidth: "960" });
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, signal) as { query?: { pages?: Record<string, CommonsPage & { index?: number }> } };
    return Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(commonsAsset).filter((a): a is ImageAsset => !!a && a.width >= 250 && a.height >= 150)
      .filter(a => !/\bin .+ language\b/i.test(a.title) || /\benglish\b/i.test(a.title))
      .sort((a, b) => candidateScore(b) - candidateScore(a));
  }
  const params = new URLSearchParams({ q: query, license: "cc0,pdm,by,by-sa", mature: "false", page_size: "8" });
  const data = await getJson(`https://api.openverse.org/v1/images/?${params}`, signal) as { results?: OpenverseImage[] };
  return (data.results ?? []).map(openverseAsset).filter((a): a is ImageAsset => !!a);
}

/** Ordered, bounded fallbacks keep the common case to one library request. */
export function imageSearchQueries(query: string) {
  const normalized = query.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  const broader = normalized.replace(/\b(cross[-\s]?section(?:al)?|labelled|labeled|annotated|detailed)\b/gi, " ").replace(/\s+/g, " ").trim();
  return [...new Set([normalized, ...(broader.length >= 3 ? [broader] : [])])];
}

export function progressiveFallbackQueries(query: string): string[] {
  const normalized = query.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  const clean = normalized
    .replace(/\b(a|an|the|of|in|how|does|work|works|showing|diagram|illustration|detailed|labelled|labeled|cross[-\s]?section(?:al)?)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(w => w.length > 2);
  const fallbacks: string[] = [];
  if (words.length >= 2) {
    fallbacks.push(`${words.slice(0, 2).join(" ")} diagram`);
    fallbacks.push(`${words.slice(-2).join(" ")} diagram`);
    fallbacks.push(words.slice(0, 2).join(" "));
    fallbacks.push(words.slice(-2).join(" "));
  } else if (words.length === 1) {
    fallbacks.push(`${words[0]} diagram`);
    fallbacks.push(words[0]);
  }
  return [...new Set(fallbacks.filter(f => f.length >= 3 && f.toLowerCase() !== normalized.toLowerCase()))];
}

export async function* imageCandidates(query: string, signal?: AbortSignal) {
  const baseQueries = imageSearchQueries(query);
  const fallbacks = progressiveFallbackQueries(query);
  const primaryQuery = baseQueries[0] || query;
  const order: Array<{ provider: ImageProvider; query: string; limit: number }> = [
    { provider: "commons", query: primaryQuery, limit: 4 },
    { provider: "openverse", query: primaryQuery, limit: 3 },
    ...baseQueries.slice(1).map(q => ({ provider: "commons" as const, query: q, limit: 3 })),
    ...fallbacks.map(q => ({ provider: "commons" as const, query: q, limit: 3 })),
    ...fallbacks.map(q => ({ provider: "openverse" as const, query: q, limit: 2 })),
  ];
  const seen = new Set<string>();
  let failed = 0;
  for (const request of order) {
    try {
      const candidates = await searchImageProvider(request.provider, request.query, signal);
      for (const candidate of candidates.filter(asset => !seen.has(asset.url)).slice(0, request.limit)) {
        seen.add(candidate.url); yield candidate;
      }
    } catch { signal?.throwIfAborted(); failed++; }
  }
  if (failed && !seen.size) throw new Error("Image search unavailable");
}
