import type { AvatarVoiceStyle } from "./voice-selection";

export type SpeechEngine = "device" | "local" | "remote";
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
  try {
    const value = localStorage.getItem("chalkie:speech-engine");
    if (value === "device") return "device";
    if (value === "remote") return "remote";
    return "local";
  } catch {
    return "local";
  }
}
export function readLocalVoice(avatar: AvatarVoiceStyle) {
  try { const saved = localStorage.getItem(`chalkie:local-voice:${avatar}`); if (LOCAL_VOICES.some(voice => voice.id === saved)) return saved!; } catch { /* optional storage */ }
  return DEFAULT_LOCAL_VOICE[avatar];
}

function isHindiOrHinglish(language?: string | { language?: string; mode?: string } | null, text?: string): boolean {
  if (typeof language === "string") {
    if (/^hi/i.test(language)) return true;
  } else if (language && typeof language === "object" && typeof language.language === "string") {
    if (/^hi/i.test(language.language)) return true;
  }
  if (text && /[\u0900-\u097F]/.test(text)) return true;
  return false;
}

function replaceSquareRoots(str: string, isHindi: boolean): string {
  let s = str;
  const sqrtPrefix = isHindi ? "वर्गमूल " : "the square root of ";
  let match: RegExpExecArray | null;
  const regex = /(?:\\?sqrt\s*|√\s*)([({[])/i;
  let safety = 0;
  while ((match = regex.exec(s)) !== null && safety++ < 40) {
    const openChar = match[1];
    const closeChar = openChar === "{" ? "}" : openChar === "[" ? "]" : ")";
    const startIdx = match.index;
    const argStart = startIdx + match[0].length;
    let depth = 1;
    let endIdx = -1;
    for (let i = argStart; i < s.length; i++) {
      if (s[i] === openChar) depth++;
      else if (s[i] === closeChar) {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx === -1) {
      s = s.slice(0, startIdx) + sqrtPrefix + s.slice(argStart);
      break;
    }
    const inner = s.slice(argStart, endIdx);
    s = s.slice(0, startIdx) + `${sqrtPrefix}${inner}` + s.slice(endIdx + 1);
  }
  // Single-token roots e.g. √x or √2
  s = s.replace(/√([a-zA-Z0-9]+)/g, `${sqrtPrefix}$1`);
  s = s.replace(/\bsqrt\s+([a-zA-Z0-9]+)/gi, `${sqrtPrefix}$1`);
  return s;
}

export function convertMathToSpokenText(text: string, language?: string | { language?: string; mode?: string } | null): string {
  if (!text) return "";
  let s = text;
  const hindi = isHindiOrHinglish(language, text);

  // 1. Strip LaTeX delimiters: $$...$$ and $...$
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, " $1 ");
  s = s.replace(/\$([^\$\n]+)\$/g, " $1 ");

  // 2. LaTeX fractions: \frac{a}{b} or \dfrac{a}{b} -> (a divided by b)
  s = s.replace(/\\(?:d?frac)\{([^{}]+)\}\{([^{}]+)\}/g, "($1 divided by $2)");

  // 3. Square roots (handles plain-text sqrt(...), \sqrt{...}, and √...)
  s = replaceSquareRoots(s, hindi);

  // 4. Common LaTeX commands
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]+)\}/g, "$1");
  s = s.replace(/\\(?:left|right)/g, "");

  // 5. Greek letters and common mathematical constants
  s = s.replace(/\\alpha\b|α/g, "alpha");
  s = s.replace(/\\beta\b|β/g, "beta");
  s = s.replace(/\\gamma\b|γ/g, "gamma");
  s = s.replace(/\\delta\b|δ/g, "delta");
  s = s.replace(/\\Delta\b|Δ/g, "delta");
  s = s.replace(/\\theta\b|θ/g, "theta");
  s = s.replace(/\\lambda\b|λ/g, "lambda");
  s = s.replace(/\\mu\b|μ/g, "mu");
  s = s.replace(/\\pi\b|π/g, "pi");
  s = s.replace(/\\rho\b|ρ/g, "rho");
  s = s.replace(/\\sigma\b|σ/g, "sigma");
  s = s.replace(/\\tau\b|τ/g, "tau");
  s = s.replace(/\\omega\b|ω/g, "omega");
  s = s.replace(/\\Omega\b|Ω/g, "ohms");
  s = s.replace(/\\phi\b|φ/g, "phi");
  s = s.replace(/\\psi\b|ψ/g, "psi");
  s = s.replace(/\\eta\b|η/g, "eta");

  // 6. Mathematical operators & relations
  s = s.replace(/\\times\b|×/g, " times ");
  s = s.replace(/\\cdot\b|·/g, " times ");
  s = s.replace(/\\pm\b|±/g, " plus or minus ");
  s = s.replace(/\\approx\b|≈/g, " is approximately ");
  s = s.replace(/\\neq\b|≠/g, " is not equal to ");
  s = s.replace(/\\leq\b|≤/g, " is less than or equal to ");
  s = s.replace(/\\geq\b|≥/g, " is greater than or equal to ");
  s = s.replace(/\\infty\b|∞/g, "infinity");
  s = s.replace(/\\int\b|∫/g, "the integral of ");
  s = s.replace(/\\sum\b|∑/g, "the sum of ");
  s = s.replace(/\\prod\b|∏/g, "the product of ");
  s = s.replace(/\\propto\b|∝/g, " is proportional to ");
  s = s.replace(/\\nabla\b|∇/g, "del");
  s = s.replace(/\\partial\b|∂/g, "partial");

  // 7. Caret powers & exponents:
  s = s.replace(/([a-zA-Z0-9)\]])\s*\^\{?2\}?(?![0-9])/g, "$1 squared");
  s = s.replace(/([a-zA-Z0-9)\]])\s*\^\{?3\}?(?![0-9])/g, "$1 cubed");
  s = s.replace(/([a-zA-Z0-9)\]])\s*\^\{?(-?\d+)\}?/g, "$1 to the power of $2");
  s = s.replace(/([a-zA-Z0-9)\]])\s*\^\{?([a-zA-Z]+)\}?/g, "$1 to the power of $2");
  s = s.replace(/\^/g, " to the power of ");

  // Unicode superscripts
  s = s.replace(/([a-zA-Z0-9)\]])²/g, "$1 squared");
  s = s.replace(/([a-zA-Z0-9)\]])³/g, "$1 cubed");
  s = s.replace(/([a-zA-Z0-9)\]])⁴/g, "$1 to the fourth");
  s = s.replace(/([a-zA-Z0-9)\]])ⁿ/g, "$1 to the n");
  s = s.replace(/([a-zA-Z0-9)\]])⁻¹/g, "$1 inverse");

  // Unicode subscripts:
  s = s.replace(/([a-zA-Z])₀/g, "$1 zero");
  s = s.replace(/([a-zA-Z])₁/g, "$1 one");
  s = s.replace(/([a-zA-Z])₂/g, "$1 two");
  s = s.replace(/([a-zA-Z])₃/g, "$1 three");

  // 8. Chained mathematical multiplication BEFORE markdown stripping!
  // Loop until all chained products like 2*G*M or r*c are converted to "times"
  let prev = "";
  let iter = 0;
  while (prev !== s && iter++ < 15) {
    prev = s;
    s = s.replace(/([0-9a-zA-Z)\]])\s*\*\s*([0-9a-zA-Z(\[])/g, "$1 times $2");
  }

  // 9. Mathematical subtraction with spacing: e.g. "1 - 2" -> "1 minus 2"
  s = s.replace(/([0-9a-zA-Z)\]])\s+[-−]\s+([0-9a-zA-Z(\[])/g, "$1 minus $2");

  // Physical units with slashes (converted BEFORE general '/' -> 'divided by')
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bkm\s*\/\s*s\b/gi, (_, n) => (n ? `${n} ` : "") + "kilometers per second");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bm\s*\/\s*(?:s\^2|s²)\b/gi, (_, n) => (n ? `${n} ` : "") + "meters per second squared");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bm\s*\/\s*s\b/gi, (_, n) => (n ? `${n} ` : "") + "meters per second");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bkm\s*\/\s*h\b/gi, (_, n) => (n ? `${n} ` : "") + "kilometers per hour");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bJ\s*\/\s*kg\b/gi, (_, n) => (n ? `${n} ` : "") + "joules per kilogram");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bN\s*\/\s*m\b/gi, (_, n) => (n ? `${n} ` : "") + "newtons per meter");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bN\s*\/\s*kg\b/gi, (_, n) => (n ? `${n} ` : "") + "newtons per kilogram");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\brad\s*\/\s*s\b/gi, (_, n) => (n ? `${n} ` : "") + "radians per second");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bkg\s*\/\s*(?:m\^3|m³)\b/gi, (_, n) => (n ? `${n} ` : "") + "kilograms per cubic meter");
  s = s.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bW\s*\/\s*(?:m\^2|m²)\b/gi, (_, n) => (n ? `${n} ` : "") + "watts per square meter");

  // 10. Division between formula terms
  s = s.replace(/([a-zA-Z0-9)\]])\s*\/\s*([a-zA-Z0-9(\[])/g, "$1 divided by $2");

  // Any remaining stray LaTeX backslashes or curly braces
  s = s.replace(/\\[a-zA-Z]+/g, "");
  s = s.replace(/[\\{}]/g, "");

  return s;
}

export function sanitizeNarrationForSpeech(text: string, language?: string | { language?: string; mode?: string } | null): string {
  if (!text) return "";
  const hindi = isHindiOrHinglish(language, text);
  let clean = convertMathToSpokenText(text, language);

  // Strip leading bullet marks e.g. "* Item", "- Item", "• Item"
  clean = clean.replace(/^[\s*•\-–—]+\s*/gm, "");
  clean = clean.replace(/(\n)[\s*•\-–—]+\s*/g, "$1 ");

  // Strip citations e.g. [1], [2], [1-3]
  clean = clean.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "");

  // Strip "Beat / Step / Stage / Phase / Part" meta-labels
  clean = clean.replace(/\b(?:Beat|Step|Stage|Phase|Part)\s+(?:one|two|three|four|five|six|\d+)\s*[:,.\-—]?\s*/gi, "");
  clean = clean.replace(/\bkilometer\s+divided\s+by\s+s\b/gi, hindi ? "किलोमीटर प्रति सेकंड" : "kilometers per second");
  clean = clean.replace(/\bkilometers?\s+divided\s+by\s+(?:seconds?|s)\b/gi, hindi ? "किलोमीटर प्रति सेकंड" : "kilometers per second");

  // 1. Strip Markdown formatting characters: **, *, __, _, `, and stray *, #, ~, _
  clean = clean.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  clean = clean.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  clean = clean.replace(/`([^`]+)`/g, "$1");
  clean = clean.replace(/[*#~_`^]/g, "");

  // 2. Remove parenthetical or bracketed node IDs e.g. (n1), [n2], (node-1)
  clean = clean.replace(/\s*\([a-zA-Z0-9_-]*(?:node|step|n)\d+[a-zA-Z0-9_-]*\)/gi, "");
  clean = clean.replace(/\s*\[[a-zA-Z0-9_-]*(?:node|step|n)\d+[a-zA-Z0-9_-]*\]/gi, "");

  // Clean up internal node IDs spoken with nouns:
  clean = clean.replace(/\b(?:node[-_]?)?n\d+\s+(बॉक्स|चित्र|आरेख|ग्राफ|कार्ड|चरण|फ़्लोचार्ट|box|card|diagram|image|step|chart|figure)\b/gi, "$1");
  clean = clean.replace(/\b(बॉक्स|चित्र|आरेख|ग्राफ|कार्ड|चरण|फ़्लोचार्ट|box|card|diagram|image|step|chart|figure)\s+(?:node[-_]?)?n\d+\b/gi, "$1");
  clean = clean.replace(/\b(?:node[-_]?)?n\d+\s*का\s*(आरेख|ग्राफ|चित्र|बॉक्स|कार्ड)\b/gi, "$1");
  clean = clean.replace(/\b(?:node[-_]?)?n\d+\s*की\s*(तस्वीर|इमेज)\b/gi, "$1");
  clean = clean.replace(/\b(?:node[-_]?)?n\d+\s*के\s*(अनुसार|बारे\s*में)\b/gi, "इसके $1");
  clean = clean.replace(/\b(?:node[-_]?)?n[1-9]\d*\b/gi, "");
  clean = clean.replace(/\bnode[-_]\d+\b/gi, "");
  clean = clean.replace(/\bstep[-_]\d+\b/gi, "");

  // 3. Replace numeric ranges e.g. 35-46 or 35–46
  clean = clean.replace(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/g, hindi ? "$1 से $2" : "$1 to $2");

  // 4. Replace vs / vs. abbreviation
  clean = clean.replace(/\bvs\.?\b/gi, hindi ? "वर्सेस" : "versus");

  // Physical units with slashes (converted BEFORE general '/' -> 'divided by')
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bkm\s*\/\s*s\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "किलोमीटर प्रति सेकंड" : "kilometers per second"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bm\s*\/\s*(?:s\^2|s²)\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "मीटर प्रति सेकंड स्क्वायर" : "meters per second squared"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bm\s*\/\s*s\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "मीटर प्रति सेकंड" : "meters per second"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bkm\s*\/\s*h\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "किलोमीटर प्रति घंटा" : "kilometers per hour"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bJ\s*\/\s*kg\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "जूल प्रति किलोग्राम" : "joules per kilogram"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bN\s*\/\s*m\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "न्यूटन प्रति मीटर" : "newtons per meter"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bN\s*\/\s*kg\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "न्यूटन प्रति किलोग्राम" : "newtons per kilogram"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\brad\s*\/\s*s\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "रेडियन प्रति सेकंड" : "radians per second"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bkg\s*\/\s*(?:m\^3|m³)\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "किलोग्राम प्रति क्यूबिक मीटर" : "kilograms per cubic meter"));
  clean = clean.replace(/(?:(\d+(?:\.\d+)?)\s*)?\bW\s*\/\s*(?:m\^2|m²)\b/gi, (_, n) => (n ? `${n} ` : "") + (hindi ? "वाट प्रति वर्ग मीटर" : "watts per square meter"));

  // 5. Replace / between formula variables (e.g. U / D or U/D or St U / D) with " divided by "
  clean = clean.replace(/\bSt\s+U\b/g, "S t U");
  clean = clean.replace(/([a-zA-Z0-9])\s*\/\s*([a-zA-Z0-9])/g, "$1 divided by $2");

  // 6. Fix the regex bug that expands "sec" inside words like "cross-section"
  clean = clean.replace(/(?<![-a-zA-Z0-9])\bsec\.(?=\s|$)/gi, "seconds ");
  clean = clean.replace(/(?<=\d\s*)\bsec\b(?![-a-zA-Z0-9])/gi, "seconds");
  clean = clean.replace(/(?<![-a-zA-Z0-9])\bsec\b(?![-a-zA-Z0-9])/gi, "seconds");

  // 7. Phonetic normalization for common scientific acronyms/terms & prevention of raw sqrt reading
  clean = clean.replace(/\bcGMP\b/g, "cyclic G M P");
  clean = clean.replace(/\bATP\b/g, "A T P");
  clean = clean.replace(/\bopsins\b/gi, "op-sins");
  clean = clean.replace(/\bopsin\b/gi, "op-sin");
  clean = clean.replace(/\bcAMP\b/g, "cyclic A M P");

  // Guaranteed prevention of raw 'sqrt' in speech
  clean = clean.replace(/\bsqrt\b/gi, hindi ? "वर्गमूल" : "square root");
  clean = clean.replace(/\bएस\s*क्यू\s*आर\s*टी\b/gi, "वर्गमूल");
  clean = clean.replace(/\bस्क्वार\s*एटी\b/gi, "वर्गमूल");

  return clean.replace(/\s+([,.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
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
    if (data.type === "warmup-complete") return;
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

export function warmupLocalSpeech(voice = "af_heart") {
  if (typeof window === "undefined" || !("Worker" in window)) return;
  try {
    getWorker().postMessage({ id: -1, text: "", voice, speed: 1.0, warmup: true });
  } catch {
    // optional background pre-warming
  }
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
