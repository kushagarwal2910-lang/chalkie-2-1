import crypto from "node:crypto";
import type { ResearchSource } from "@/lib/lesson-schema";
import type { GroqCallOptions } from "@/lib/groq-pool";
import { resolveProviderCredentials } from "./provider-credentials.ts";
import { ResearchError, requireResearchEvidence } from "./research-evidence.ts";
import { relevantExcerpt, researchQuery, sourceAuthority, usableEvidenceUrl } from "./research-quality.ts";
import { isUserSourceUrl, sourceEvidenceText, sourceMaterialsSchema, sourceMaterialUrl, type SourceResearchOptions } from "./source-materials.ts";

type TavilyResult = { title?: string; url?: string; content?: string; raw_content?: string; score?: number };
type ResearchChunk = { id: string; sourceId: string; title: string; url: string; text: string; lexical: number; semantic: number; score: number; userProvided?: boolean };
type ResearchIndex = { question: string; sources: ResearchSource[]; chunks: ResearchChunk[]; indexedAt: number };

declare global {
  var chalkieResearchIndexes: Map<string, ResearchIndex> | undefined;
}

const researchIndexes = globalThis.chalkieResearchIndexes ?? new Map<string, ResearchIndex>();
globalThis.chalkieResearchIndexes = researchIndexes;

const stopWords = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "is", "are", "how", "what", "why"]);

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{M}\p{N}]{2,}/gu)?.filter((token) => !stopWords.has(token)) ?? [];
}

function chunkText(text: string, maxChars = 1800, limit = 12): string[] {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, limit * (maxChars - 250));
  if (!clean) return [];
  const chunks: string[] = [];
  for (let cursor = 0; cursor < clean.length; cursor += maxChars - 250) {
    chunks.push(clean.slice(cursor, cursor + maxChars));
    if (chunks.length >= limit) break;
  }
  return chunks;
}

function lexicalScore(query: string, text: string): number {
  const queryTokens = tokens(query);
  const documentTokens = tokens(text);
  if (!queryTokens.length || !documentTokens.length) return 0;
  const frequencies = new Map<string, number>();
  for (const token of documentTokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  const score = queryTokens.reduce((total, token) => total + Math.log1p(frequencies.get(token) ?? 0), 0);
  return Math.min(1, score / Math.max(2, queryTokens.length * 0.8));
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, left = 0, right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]; left += a[index] ** 2; right += b[index] ** 2;
  }
  return dot / (Math.sqrt(left) * Math.sqrt(right) || 1);
}

async function embeddings(input: string[], signal?: AbortSignal): Promise<number[][] | null> {
  signal?.throwIfAborted();
  const baseUrl = process.env.EMBEDDING_BASE_URL;
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.map((item) => item.embedding) ?? null;
  } catch {
    signal?.throwIfAborted();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function indexKey(sessionId: string) {
  return `chalkie:index:${crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`;
}

async function rankChunks(question: string, chunks: ResearchChunk[], groqOptions: GroqCallOptions = {}): Promise<ResearchChunk[]> {
  groqOptions.signal?.throwIfAborted();
  const authority = (chunk: ResearchChunk) => chunk.userProvided ? 1 : sourceAuthority(chunk.url);
  const rescored = chunks.filter(chunk => chunk.userProvided || isUserSourceUrl(chunk.url) || usableEvidenceUrl(chunk.url)).map((chunk) => {
    const text = relevantExcerpt(researchQuery(question), chunk.text);
    return { ...chunk, text, lexical: lexicalScore(researchQuery(question), text), semantic: 0, score: 0 };
  });
  const priority = (chunk: ResearchChunk) => authority(chunk) * 0.2 + (chunk.userProvided ? 0.35 : 0);
  const candidatePool = rescored.sort((a, b) => (b.lexical + priority(b)) - (a.lexical + priority(a))).slice(0, 30);
  const vectors = await embeddings([question, ...candidatePool.map((chunk) => chunk.text)], groqOptions.signal);
  if (vectors?.length === candidatePool.length + 1) {
    const queryVector = vectors[0];
    candidatePool.forEach((chunk, index) => { chunk.semantic = Math.max(0, cosine(queryVector, vectors[index + 1])); });
  }
  candidatePool.forEach((chunk) => { chunk.score = (vectors ? (chunk.semantic * 0.62 + chunk.lexical * 0.38) : chunk.lexical) + priority(chunk); });
  // Indexing must NOT burn the user's Groq teaching quota. The hybrid lexical/semantic
  // ranking provides high-quality retrieval without consuming Groq tokens.
  const perSource = new Map<string, number>();
  return candidatePool.sort((a, b) => b.score - a.score).filter(chunk => {
    const count = perSource.get(chunk.sourceId) ?? 0;
    if (count >= (chunk.userProvided ? 4 : 2)) return false;
    perSource.set(chunk.sourceId, count + 1); return true;
  }).slice(0, 6);
}

function contextFromChunks(chunks: ResearchChunk[]) {
  return chunks.map((chunk, index) => `[${index + 1}] ${chunk.title}${chunk.userProvided ? " (user-provided evidence; prioritize this material)" : ""}\nURL: ${chunk.url}\n${chunk.text}`).join("\n\n");
}

function userEvidence(options: SourceResearchOptions) {
  const materials = sourceMaterialsSchema.parse(options.sourceMaterials ?? []);
  const sources: ResearchSource[] = [];
  const chunks: ResearchChunk[] = [];
  for (const material of materials) {
    const text = sourceEvidenceText(material);
    if (text.length < 20) continue;
    const source = { id: `user-${crypto.createHash("sha256").update(material.id).digest("hex").slice(0, 32)}`, title: material.title, url: sourceMaterialUrl(material), publisher: `Your ${material.kind === "youtube" ? "YouTube transcript" : material.kind.toUpperCase()} source`, summary: text.replace(/\s+/g, " ").slice(0, 500), score: 1.0 };
    sources.push(source);
    chunkText(text, 1800, 65).forEach((part, index) => chunks.push({ id: `${source.id}-${index + 1}`, sourceId: source.id, title: source.title, url: source.url, text: part, lexical: 0, semantic: 0, score: 1, userProvided: true }));
  }
  return { sources, chunks };
}

async function saveIndex(sessionId: string, index: ResearchIndex) {
  // Bound the process-local cache; clients resend their own session materials.
  for (const [key, value] of researchIndexes) if (Date.now() - value.indexedAt > 6 * 60 * 60 * 1000) researchIndexes.delete(key);
  if (researchIndexes.size >= 100) researchIndexes.delete(researchIndexes.keys().next().value!);
  researchIndexes.set(indexKey(sessionId), index);
}

async function loadIndex(sessionId: string): Promise<ResearchIndex | null> {
  const key = indexKey(sessionId);
  return researchIndexes.get(key) ?? null;
}

export async function retrieveSessionContext(question: string, sessionId: string, fallbackSources: ResearchSource[] = [], groqOptions: GroqCallOptions = {}, options?: SourceResearchOptions): Promise<{ sources: ResearchSource[]; context: string; indexed: boolean }> {
  groqOptions.signal?.throwIfAborted();
  const stored = await loadIndex(sessionId);
  const fallbackChunks: ResearchChunk[] = fallbackSources.map((source, index) => ({
    id: `fallback-${index + 1}`,
    sourceId: source.id,
    title: source.title,
    url: source.url,
    text: source.summary,
    lexical: 0,
    semantic: 0,
    score: 0,
    userProvided: source.id.startsWith("user-") || isUserSourceUrl(source.url),
  }));
  let chunks = stored?.chunks.length ? stored.chunks : fallbackChunks;
  let sources = stored?.sources ?? fallbackSources;
  if (options) {
    const replacingMaterials = options.sourceMaterials !== undefined;
    const supplied = replacingMaterials ? userEvidence(options) : { sources: [], chunks: [] };
    chunks = [...supplied.chunks, ...chunks.filter(chunk => chunk.userProvided ? !replacingMaterials : options.includeWebSearch !== false)];
    sources = [...supplied.sources, ...sources.filter(source => source.id.startsWith("user-") || isUserSourceUrl(source.url) ? !replacingMaterials : options.includeWebSearch !== false)].slice(0, 20);
    await saveIndex(sessionId, { question, sources, chunks, indexedAt: Date.now() });
  }
  if (!chunks.length) return { sources, context: "", indexed: false };
  const ranked = await rankChunks(question, chunks, groqOptions);
  return {
    sources,
    context: contextFromChunks(ranked),
    indexed: Boolean(stored) || Boolean(options?.sourceMaterials?.length),
  };
}

export async function researchQuestion(question: string, sessionId: string, groqOptions: GroqCallOptions = {}, options: SourceResearchOptions = {}): Promise<{ sources: ResearchSource[]; context: string }> {
  groqOptions.signal?.throwIfAborted();
  const supplied = userEvidence(options);
  if (options.includeWebSearch === false) {
    if (!supplied.chunks.length && options.sourceMaterials?.some(material => material.images.length)) {
      throw new ResearchError("NO_RESEARCH_EVIDENCE", "No readable source evidence could be extracted from the uploaded diagrams. Add clearer pages or paste the visible text, then retry; your board has been kept.");
    }
    const ranked = await rankChunks(question, supplied.chunks, groqOptions);
    const context = contextFromChunks(ranked);
    requireResearchEvidence(context, supplied.sources);
    await saveIndex(sessionId, { question, ...supplied, indexedAt: Date.now() });
    return { sources: supplied.sources, context };
  }
  const tavilyKey = (await resolveProviderCredentials()).tavilyKey;
  if (!tavilyKey) throw new ResearchError("RESEARCH_REQUIRED", "Add a Tavily key for web search, or add your own sources and turn off Include Web Search.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Research request timed out", "TimeoutError")), 35000);
  let results: TavilyResult[] = [];
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: groqOptions.signal ? AbortSignal.any([groqOptions.signal, controller.signal]) : controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: tavilyKey, query: researchQuery(question), max_results: 20, search_depth: "advanced", include_raw_content: "markdown", include_answer: false }),
    });
    if (!response.ok) throw new ResearchError("RESEARCH_UNAVAILABLE", "Tavily research failed. Check the key or its quota, then retry. No unsourced lesson was generated.");
    results = ((await response.json()) as { results?: TavilyResult[] }).results ?? [];
  } catch (error) {
    groqOptions.signal?.throwIfAborted();
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("RESEARCH_UNAVAILABLE", "Research could not be retrieved. Please retry; no unsourced lesson was generated.");
  } finally {
    clearTimeout(timer);
  }

  const seen = new Set<string>();
  const unique = results.filter((result) => {
    if (!result.url || !(result.raw_content || result.content)?.trim()) return false;
    if (!usableEvidenceUrl(result.url)) return false;
    const normalized = result.url.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).sort((a, b) => sourceAuthority(b.url!) - sourceAuthority(a.url!)).slice(0, 20 - supplied.sources.length);

  const sources: ResearchSource[] = unique.map((result, index) => ({
    id: `source-${index + 1}`,
    title: (result.title || `Source ${index + 1}`).slice(0, 180),
    url: result.url!,
    publisher: new URL(result.url!).hostname.replace(/^www\./, "").slice(0, 100),
    summary: (result.content || result.raw_content || "Relevant source").replace(/\s+/g, " ").slice(0, 500),
    score: Math.max(0, Math.min(1, result.score ?? 0.5)),
  }));

  const chunks: ResearchChunk[] = [];
  unique.forEach((result, sourceIndex) => {
    chunkText(result.raw_content || result.content || "").forEach((text, chunkIndex) => {
      chunks.push({ id: `chunk-${sourceIndex + 1}-${chunkIndex + 1}`, sourceId: `source-${sourceIndex + 1}`, title: sources[sourceIndex]?.title ?? "Source", url: result.url!, text, lexical: lexicalScore(question, text), semantic: 0, score: 0 });
    });
  });

  // Persist the fetched material before any optional embeddings or LLM work.
  // This keeps the session RAG base available even if Groq is rate-limited.
  const storedChunks = [...supplied.chunks, ...chunks.slice(0, 120)];
  const combinedSources = [...supplied.sources, ...sources];
  await saveIndex(sessionId, { question, sources: combinedSources, chunks: storedChunks, indexedAt: Date.now() });
  const ranked = await rankChunks(question, storedChunks, groqOptions);
  const context = contextFromChunks(ranked);
  requireResearchEvidence(context, combinedSources);
  return { sources: combinedSources, context };
}
