import type { AvatarVoiceStyle } from "./voice-selection";

export type SpeechEngine = "device" | "local";
export const LOCAL_VOICES = [
  { id: "af_heart", label: "Heart · feminine · American", avatar: "mira" },
  { id: "af_bella", label: "Bella · feminine · American", avatar: "mira" },
  { id: "bf_emma", label: "Emma · feminine · British", avatar: "mira" },
  { id: "am_michael", label: "Michael · masculine · American", avatar: "arjun" },
  { id: "bm_george", label: "George · masculine · British", avatar: "arjun" },
  { id: "am_puck", label: "Puck · masculine · American", avatar: "chalk" },
] as const;
export const DEFAULT_LOCAL_VOICE = { mira: "af_heart", arjun: "am_michael", chalk: "am_puck" } as const;
export function readSpeechEngine(): SpeechEngine {
  try { return localStorage.getItem("chalkie:speech-engine") === "local" ? "local" : "device"; } catch { return "device"; }
}
export function readLocalVoice(avatar: AvatarVoiceStyle) {
  try { const saved = localStorage.getItem(`chalkie:local-voice:${avatar}`); if (LOCAL_VOICES.some(voice => voice.id === saved)) return saved!; } catch { /* optional storage */ }
  return DEFAULT_LOCAL_VOICE[avatar];
}

export function sanitizeNarrationForSpeech(text: string): string {
  if (!text) return "";
  let clean = text;

  // 1. Strip Markdown formatting characters: *, _, `, and stray *, #, ~
  clean = clean.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  clean = clean.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  clean = clean.replace(/`([^`]+)`/g, "$1");
  clean = clean.replace(/[*#~]/g, "");

  // 2. Fix the regex bug that expands "sec" inside words like "cross-section"
  // Ensure unit/abbreviation expansion regex uses strict word boundaries and never mutates hyphenated or compound words
  clean = clean.replace(/(?<![-a-zA-Z0-9])\bsec\.(?=\s|$)/gi, "seconds ");
  clean = clean.replace(/(?<=\d\s*)\bsec\b(?![-a-zA-Z0-9])/gi, "seconds");
  clean = clean.replace(/(?<![-a-zA-Z0-9])\bsec\b(?![-a-zA-Z0-9])/gi, "seconds");

  // 3. Phonetic normalization for common scientific acronyms/terms
  clean = clean.replace(/\bcGMP\b/g, "cyclic G M P");
  clean = clean.replace(/\bATP\b/g, "A T P");
  clean = clean.replace(/\bopsins\b/gi, "op-sins");
  clean = clean.replace(/\bopsin\b/gi, "op-sin");
  clean = clean.replace(/\bcAMP\b/g, "cyclic A M P");

  return clean;
}

type Job = { resolve: (audio: Blob) => void; reject: (error: Error) => void; progress?: (message: string) => void; cleanup: () => void };
let worker: Worker | null = null;
let sequence = 0;
const jobs = new Map<number, Job>();
const recordings = new Map<string, Blob>();
let cacheBytes = 0;
function resetWorker(error: Error) {
  worker?.terminate(); worker = null;
  for (const job of jobs.values()) { job.cleanup(); job.reject(error); }
  jobs.clear();
}
function getWorker() {
  if (worker) return worker;
  worker = new Worker("/local-speech-worker.js", { type: "module", name: "chalkie-local-voice" });
  worker.onerror = () => resetWorker(new Error("Local voice could not load. Try Device voice in Teacher & voice."));
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    if (!job) return;
    if (data.type === "progress") { job.progress?.(data.message); return; }
    jobs.delete(data.id); job.cleanup();
    if (data.type === "error" && process.env.NODE_ENV === "development") console.warn("Local voice:", data.diagnostic);
    if (data.type === "complete" && data.audio instanceof Blob) job.resolve(data.audio);
    else job.reject(new Error(data.message || "Local speech failed."));
  };
  return worker;
}

export async function generateLocalSpeech(text: string, voice: string, speed: number, signal: AbortSignal, progress?: (message: string) => void): Promise<Blob> {
  signal.throwIfAborted();
  const sanitizedText = sanitizeNarrationForSpeech(text);
  if (!sanitizedText.trim() || sanitizedText.length > 4000 || !LOCAL_VOICES.some(item => item.id === voice) || !Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error("Invalid local voice request.");
  const key = JSON.stringify([sanitizedText, voice, speed]);
  const cached = recordings.get(key);
  if (cached) return cached;
  const audio = await new Promise<Blob>((resolve, reject) => {
    const id = ++sequence;
    const abort = () => resetWorker(new DOMException("Speech cancelled", "AbortError"));
    const timer = setTimeout(() => resetWorker(new Error("Local voice is taking too long on this device. Try Device voice in Teacher & voice.")), 180_000);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    jobs.set(id, { resolve, reject, progress, cleanup });
    signal.addEventListener("abort", abort, { once: true });
    try { getWorker().postMessage({ id, text: sanitizedText, voice, speed }); } catch { resetWorker(new Error("This browser cannot run local speech. Choose Device voice.")); }
  });
  signal.throwIfAborted();
  while (recordings.size && (recordings.size >= 12 || cacheBytes + audio.size > 12 * 1024 * 1024)) {
    const first = recordings.keys().next().value!;
    cacheBytes -= recordings.get(first)!.size; recordings.delete(first);
  }
  if (audio.size <= 12 * 1024 * 1024) { recordings.set(key, audio); cacheBytes += audio.size; }
  return audio;
}
