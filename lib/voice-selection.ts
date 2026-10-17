/**
 * Manages Web Speech API voice discovery, ranking, and preferences.
 * Prioritizes modern studio-grade Natural/Neural voices over legacy robotic synths.
 */

export interface VoiceOption {
  name: string;
  lang: string;
  uri: string;
  isNatural: boolean;
  label: string;
}

// Preferred high-clarity voice name substrings
const NATURAL_PATTERN = /natural|neural|online \(natural\)|studio|premium/i;
const PREFERRED_NAMES = [
  "jenny",
  "guy",
  "aria",
  "google us english",
  "google uk english female",
  "google uk english male",
  "samantha",
  "daniel",
  "karen",
  "moira",
  "alex",
  "ava",
  "oliver",
  "serena",
];

// Robotic legacy desktop synthesizers to avoid if natural voices are present
const ROBOTIC_LEGACY_PATTERN = /desktop|david|zira|mark|hazel|george|susan/i;

/**
 * Rates voice quality (higher score = better clarity & naturalness)
 */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  let score = 0;
  const nameLower = voice.name.toLowerCase();
  const langLower = voice.lang.toLowerCase();

  // English priority for primary instruction
  if (langLower.startsWith("en-us")) score += 40;
  else if (langLower.startsWith("en")) score += 30;
  else score -= 50;

  // Modern Neural / Natural voices are ranked highest
  if (NATURAL_PATTERN.test(nameLower)) {
    score += 100;
  }

  // Highly rated individual voices
  for (let i = 0; i < PREFERRED_NAMES.length; i++) {
    if (nameLower.includes(PREFERRED_NAMES[i])) {
      score += 50 - i * 2;
      break;
    }
  }

  // Heavily penalize old legacy Windows desktop voices (e.g. Microsoft David Desktop)
  if (ROBOTIC_LEGACY_PATTERN.test(nameLower) && !NATURAL_PATTERN.test(nameLower)) {
    score -= 80;
  }

  return score;
}

/**
 * Returns ranked list of English voices available in the browser.
 */
export function getRankedVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const sorted = [...englishVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  return sorted.length ? sorted : voices;
}

/**
 * Automatically selects the best available natural voice based on user preference or high-clarity ranking.
 */
export function getBestAvailableVoice(
  voices: SpeechSynthesisVoice[],
  preferredUri?: string | null,
  avatar?: AvatarVoiceStyle,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  // 1. If user previously chose a specific voice URI, try to match it
  if (preferredUri) {
    const matched = voices.find((v) => v.voiceURI === preferredUri || v.name === preferredUri);
    if (matched) return matched;
  }

  // 2. Otherwise pick the highest-ranked natural voice
  const ranked = getRankedVoices(voices);
  if (avatar && avatar !== "chalk") {
    const desired = avatar === "mira" ? FEMININE_VOICES : MASCULINE_VOICES;
    const opposite = avatar === "mira" ? MASCULINE_VOICES : FEMININE_VOICES;
    // Web Speech exposes no gender metadata. Match known voices before quality;
    // an unknown voice is preferable to a known mismatched default.
    return ranked.find(v => desired.test(v.name)) ?? ranked.find(v => !opposite.test(v.name)) ?? ranked[0] ?? null;
  }
  return ranked[0] || null;
}

const FEMININE_VOICES = /\b(jenny|aria|zira|hazel|susan|samantha|karen|moira|ava|serena|sara|sonia|libby|neerja|female)\b/i;
const MASCULINE_VOICES = /\b(guy|david|mark|george|daniel|alex|oliver|ryan|eric|christopher|gavin|ravi|male)\b/i;
export type AvatarVoiceStyle = "mira" | "arjun" | "chalk";
export interface AvatarVoicePreferences { uri: string | null; rate: number; pitch: number }
export const AVATAR_VOICE_DEFAULTS: Record<AvatarVoiceStyle, AvatarVoicePreferences> = {
  mira: { uri: null, rate: 1.0, pitch: 1.0 },
  arjun: { uri: null, rate: 1.0, pitch: 1.0 },
  chalk: { uri: null, rate: 1.0, pitch: 1.0 },
};
export function voicePreferenceKey(avatar: AvatarVoiceStyle) { return `chalkie:voice:${avatar}`; }
export function readAvatarVoicePreferences(avatar: AvatarVoiceStyle, storage: Pick<Storage, "getItem">): AvatarVoicePreferences {
  const defaults = AVATAR_VOICE_DEFAULTS[avatar];
  try {
    const raw = JSON.parse(storage.getItem(voicePreferenceKey(avatar)) || "{}");
    return {
      uri: typeof raw.uri === "string" && raw.uri.length ? raw.uri : null,
      rate: typeof raw.rate === "number" && Number.isFinite(raw.rate) && raw.rate >= 0.7 && raw.rate <= 1.3 ? raw.rate : defaults.rate,
      pitch: typeof raw.pitch === "number" && Number.isFinite(raw.pitch) && raw.pitch >= 0.85 && raw.pitch <= 1.2 ? raw.pitch : defaults.pitch,
    };
  } catch { return { ...defaults }; }
}

/**
 * Formats a clean human-friendly voice name for the UI selector
 */
export function formatVoiceLabel(voice: SpeechSynthesisVoice): string {
  let clean = voice.name;
  clean = clean.replace(/Microsoft\s+/g, "");
  clean = clean.replace(/Online\s+\(Natural\)\s+-\s+English\s+\([^)]+\)/gi, "(Natural)");
  clean = clean.replace(/Desktop\s+-\s+English\s+\([^)]+\)/gi, "(Classic)");
  clean = clean.replace(/-\s+English\s+\([^)]+\)/gi, "");
  clean = clean.replace(/\s+/g, " ").trim();
  return clean;
}

export const SPEECH_RATE_KEY = "chalkie:speech-speed";
export const PREFERRED_VOICE_KEY = "chalkie:preferred-voice";

export const DEFAULT_SPEECH_RATE = 0.92; // Optimal clarity & natural cadence
export const DEFAULT_SPEECH_PITCH = 1.0; // Natural resonant pitch
