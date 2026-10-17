import { normalizeLessonLanguage, type LessonLanguageSettings } from "./lesson-language.ts";

export type RemoteSpeechProvider = "sarvam" | "elevenlabs";
export type RemoteSpeechPreference = "auto" | RemoteSpeechProvider;
export interface SpeechWordTiming { text: string; charIndex: number; charLength: number; start: number; end: number }
export interface SpeechProviderAvailability { configured: boolean; model: string; languages: string[]; wordTimestamps: boolean }
export interface SpeechAvailability { providers: Record<RemoteSpeechProvider, SpeechProviderAvailability> }
export interface RemoteSpeechResult {
  audio: Blob;
  alignment: SpeechWordTiming[];
  timingSource: "provider" | "none";
  provider: RemoteSpeechProvider;
  model: string;
}

export const SARVAM_LANGUAGE_CODES: Record<string, string> = {
  en: "en-IN", "en-US": "en-IN", "en-IN": "en-IN", hi: "hi-IN", "hi-IN": "hi-IN", te: "te-IN", "te-IN": "te-IN",
  ta: "ta-IN", "ta-IN": "ta-IN", bn: "bn-IN", "bn-IN": "bn-IN", mr: "mr-IN", "mr-IN": "mr-IN",
  gu: "gu-IN", "gu-IN": "gu-IN", kn: "kn-IN", "kn-IN": "kn-IN", ml: "ml-IN", "ml-IN": "ml-IN",
  pa: "pa-IN", "pa-IN": "pa-IN", or: "od-IN", "or-IN": "od-IN", "od-IN": "od-IN",
};
export const ELEVENLABS_LANGUAGE_CODES = ["en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl", "sv", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru", "hu", "no", "vi"];

export function selectRemoteSpeechProvider(settings: LessonLanguageSettings, availability: SpeechAvailability, preference: RemoteSpeechPreference = "auto"): RemoteSpeechProvider | null {
  const normalized = normalizeLessonLanguage(settings);
  const base = normalized.language.split("-")[0];
  const isIndianOrEnglish = base in SARVAM_LANGUAGE_CODES || normalized.language in SARVAM_LANGUAGE_CODES || normalized.language.endsWith("-IN") || base === "en";
  const order: RemoteSpeechProvider[] = preference === "auto" ? (isIndianOrEnglish ? ["sarvam", "elevenlabs"] : ["elevenlabs", "sarvam"]) : [preference];
  return order.find(provider => availability.providers[provider]?.configured && (availability.providers[provider].languages.includes(base) || availability.providers[provider].languages.includes(normalized.language))) ?? null;
}

export function readRemoteSpeechPreference(): RemoteSpeechPreference {
  try { const value = localStorage.getItem("chalkie:remote-speech-provider"); return value === "sarvam" || value === "elevenlabs" ? value : "sarvam"; }
  catch { return "sarvam"; }
}

/** Convert original-text character timings to UTF-16 word ranges for speech cues. */
export function characterAlignmentToWords(raw: unknown, originalText: string, language: string): SpeechWordTiming[] {
  if (!raw || typeof raw !== "object") return [];
  const alignment = raw as { characters?: unknown; character_start_times_seconds?: unknown; character_end_times_seconds?: unknown };
  const characters = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)
    || characters.length !== starts.length || characters.length !== ends.length
    || characters.some(character => typeof character !== "string") || characters.join("") !== originalText) return [];
  const byCharacter: { start: number; end: number }[] = [];
  let previousStart = 0;
  for (let i = 0; i < characters.length; i++) {
    const start = starts[i]; const end = ends[i];
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < previousStart || end < start || end > 1800) return [];
    previousStart = start;
    for (let j = 0; j < characters[i].length; j++) byCharacter.push({ start, end });
  }
  const segments = new Intl.Segmenter(language, { granularity: "word" }).segment(originalText);
  return [...segments].filter(segment => segment.isWordLike).map(segment => ({
    text: segment.segment, charIndex: segment.index, charLength: segment.segment.length,
    start: byCharacter[segment.index].start, end: byCharacter[segment.index + segment.segment.length - 1].end,
  }));
}

/** No English phonetic substitutions: multilingual content and cue indices stay intact. */
export async function generateRemoteSpeech(text: string, settings: LessonLanguageSettings, speed: number, signal?: AbortSignal, preference: RemoteSpeechPreference = readRemoteSpeechPreference(), avatar?: string): Promise<RemoteSpeechResult> {
  signal?.throwIfAborted();
  const response = await fetch("/api/speech", {
    method: "POST", headers: { "Content-Type": "application/json" }, ...(signal ? { signal } : {}),
    body: JSON.stringify({ text, settings: normalizeLessonLanguage(settings), speed, provider: preference, avatar }),
  });
  const result = await response.json();
  signal?.throwIfAborted();
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "Natural voice is unavailable. Select a matching device voice in Teacher & voice.");
  if (typeof result.audioBase64 !== "string" || result.audioBase64.length > 24_000_000 || !["audio/mpeg", "audio/wav"].includes(result.mimeType)
    || !["sarvam", "elevenlabs"].includes(result.provider) || !Array.isArray(result.alignment)) throw new Error("The voice provider returned invalid audio.");
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(result.audioBase64), character => character.charCodeAt(0)); }
  catch { throw new Error("The voice provider returned invalid audio."); }
  if (!bytes.length) throw new Error("The voice provider returned empty audio.");
  return { audio: new Blob([bytes], { type: result.mimeType }), alignment: result.alignment, timingSource: result.timingSource === "provider" ? "provider" : "none", provider: result.provider, model: String(result.model) };
}
