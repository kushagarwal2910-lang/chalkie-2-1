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
  const thumbnailUrl = item.thumbnail || url;
  return { id: `openverse-${item.id}`, title: clean(item.title, 300), url, thumbnailUrl, sourceUrl: item.foreign_landing_url,
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

export function scoreImageCandidate(a: ImageAsset, query = ""): number {
  let score = 0;
  const title = (a.title || "").toLowerCase();
  const desc = (a.description || "").toLowerCase();
  const combined = `${title} ${desc}`;
  const url = (a.url || "").toLowerCase();
  const sourceUrl = (a.sourceUrl || "").toLowerCase();

  // 1. +35 pts: File extension is .svg or .png (clean vector/diagram formats)
  if (/\.(svg|png)(\?|$)/i.test(url) || /\.(svg|png)(\?|$)/i.test(sourceUrl) || /\.(svg|png)$/i.test(title)) {
    score += 35;
  }

  // 2. +30 pts: Title, categories, or snippet contain educational keywords
  const educationalKeywordRegex = /\b(diagram|schematic|cross[- ]?section|anatomy|structure|mechanism|process|cycle|labeled|labelled|english|vector|illustration|chart|pathway)\b/i;
  if (educationalKeywordRegex.test(combined)) {
    score += 30;
  }

  // 3. +20 pts: Query token overlap ratio >= 0.6 in title or description
  if (query.trim()) {
    const cleanQ = query.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ");
    const words = cleanQ.split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|with|diagram|showing|about|how|why)$/i.test(w));
    if (words.length > 0) {
      const matchCount = words.filter(w => combined.includes(w)).length;
      if (matchCount / words.length >= 0.6) {
        score += 20;
      }
    }
  }

  // 4. -60 pts (Hard Penalty / Filter Out): Title or categories contain non-educational noise
  const noiseRegex = /\b(statue|monument|building|exterior|portrait|grave|stamp|coin|logo|icon|flag|map of|book cover|page \d+|scanned|signature|autograph|trophy|museum exterior)\b/i;
  if (noiseRegex.test(combined)) {
    score -= 60;
  }

  // 5. -40 pts: Non-Latin/foreign-only title markers when English is requested
  const foreignMarkerRegex = /(?:[-_](?:ru|zh|ar|ja|ko|de|fr|es|pl)\b|\bin\s+(?:russian|chinese|arabic|japanese|korean|german|french|spanish|polish)\b)/i;
  if (foreignMarkerRegex.test(title)) {
    score -= 40;
  }

  return score;
}

export const candidateScore = scoreImageCandidate;

async function fetchProviderQuery(provider: ImageProvider, query: string, signal?: AbortSignal): Promise<ImageAsset[]> {
  if (provider === "commons") {
    const params = new URLSearchParams({
      action: "query", format: "json", generator: "search",
      gsrsearch: `${query} -watermark`, gsrnamespace: "6", gsrlimit: "8",
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata|sha1", iiurlwidth: "1280"
    });
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`, signal) as { query?: { pages?: Record<string, CommonsPage & { index?: number }> } };
    return Object.values(data.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(commonsAsset)
      .filter((a): a is ImageAsset => !!a && a.width >= 250 && a.height >= 150)
      .filter(a => !/\bin .+ language\b/i.test(a.title) || /\benglish\b/i.test(a.title));
  }
  const params = new URLSearchParams({ q: query, license: "cc0,pdm,by,by-sa", mature: "false", page_size: "8" });
  const data = await getJson(`https://api.openverse.org/v1/images/?${params}`, signal) as { results?: OpenverseImage[] };
  return (data.results ?? []).map(openverseAsset).filter((a): a is ImageAsset => !!a);
}

/** Standalone image search with dual-query expansion and deterministic educational relevance ranking. */
export async function searchImageProvider(provider: ImageProvider, query: string, signal?: AbortSignal): Promise<ImageAsset[]> {
  const cleanQuery = query
    .replace(/\b(diagram|schematic|cross[- ]?section|labeled|labelled|illustration)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || query;

  const query1 = `${cleanQuery} diagram OR schematic OR cross-section OR labeled`;
  const query2 = cleanQuery;

  // Dual-Query Search Expansion (Zero LLM Tokens) via Promise.allSettled
  const results = await Promise.allSettled([
    fetchProviderQuery(provider, query1, signal),
    fetchProviderQuery(provider, query2, signal),
  ]);

  const candidates: ImageAsset[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  for (const res of results) {
    if (res.status === "fulfilled") {
      for (const asset of res.value) {
        const canonicalUrl = asset.url.split("?")[0].toLowerCase();
        const canonicalTitle = asset.title.toLowerCase().trim();
        if (!seenUrls.has(canonicalUrl) && !seenTitles.has(canonicalTitle)) {
          seenUrls.add(canonicalUrl);
          seenTitles.add(canonicalTitle);
          candidates.push(asset);
        }
      }
    }
  }

  // Sort candidates by descending deterministic relevance score
  return candidates.sort((a, b) => scoreImageCandidate(b, query) - scoreImageCandidate(a, query));
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
