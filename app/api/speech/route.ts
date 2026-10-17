import { LANGUAGE_OPTIONS, normalizeLessonLanguage } from "../../../lib/lesson-language.ts";
import { characterAlignmentToWords, ELEVENLABS_LANGUAGE_CODES, SARVAM_LANGUAGE_CODES, selectRemoteSpeechProvider, type RemoteSpeechPreference, type SpeechAvailability } from "../../../lib/remote-speech.ts";
import { sanitizeNarrationForSpeech } from "../../../lib/local-speech.ts";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };

const SARVAM_AVATAR_SPEAKERS: Record<string, string> = {
  mira: "priya",
  arjun: "aditya",
  chalk: "shubh",
};

function availability(): SpeechAvailability {
  return { providers: {
    sarvam: { configured: Boolean(process.env.SARVAM_API_KEY?.trim()), model: "bulbul:v3", languages: Object.keys(SARVAM_LANGUAGE_CODES), wordTimestamps: false },
    elevenlabs: { configured: Boolean(process.env.ELEVENLABS_API_KEY?.trim() && process.env.ELEVENLABS_VOICE_ID?.trim()), model: "eleven_flash_v2_5", languages: ELEVENLABS_LANGUAGE_CODES, wordTimestamps: true },
  } };
}

export async function GET() {
  return Response.json(availability(), { headers: noStore });
}

function failure(message: string, status: number, code: string) {
  return Response.json({ message, code }, { status, headers: noStore });
}

async function readLimitedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Empty request");
  const reader = request.body.getReader();
  let text = ""; let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 24_000) { await reader.cancel(); throw new Error("Request too large"); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

function isAuthorizedOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const reqUrl = new URL(request.url);
    const hostHeader = (request.headers.get("host") || reqUrl.host).toLowerCase();
    const originHost = originUrl.host.toLowerCase();
    if (originHost === hostHeader) return true;
    const isLocal = (h: string) =>
      h.startsWith("localhost") ||
      h.startsWith("127.0.0.1") ||
      h.startsWith("[::1]") ||
      h.startsWith("0.0.0.0");
    if (isLocal(originHost) && isLocal(hostHeader)) return true;
    if (originUrl.origin === reqUrl.origin) return true;
  } catch {
    return false;
  }
  return false;
}

export async function POST(request: Request) {
  if (!isAuthorizedOrigin(request)) return failure("Speech requests must come from this app.", 403, "INVALID_ORIGIN");
  let input: { text?: unknown; settings?: { mode?: unknown; language?: unknown }; speed?: unknown; provider?: unknown; avatar?: unknown; speaker?: unknown };
  try {
    const parsed = await readLimitedJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
    input = parsed;
  } catch { return failure("Send a valid speech request smaller than 24 KB.", 400, "INVALID_REQUEST"); }
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 2500
    || !input.settings || !LANGUAGE_OPTIONS.some(option => option.code === input.settings?.language)
    || !["native", "code-switch"].includes(String(input.settings.mode))
    || typeof input.speed !== "number" || !Number.isFinite(input.speed) || input.speed < 0.7 || input.speed > 1.2
    || !["auto", "sarvam", "elevenlabs"].includes(String(input.provider ?? "auto"))) {
    return failure("Choose a supported language and speaking pace, and keep each narration segment below 2,500 characters.", 400, "INVALID_REQUEST");
  }
  const settings = normalizeLessonLanguage(input.settings);
  const textToSpeak = sanitizeNarrationForSpeech(input.text, settings);
  if (!textToSpeak.trim()) return failure("Send valid text to speak.", 400, "INVALID_REQUEST");

  const available = availability();
  const provider = selectRemoteSpeechProvider(settings, available, (input.provider ?? "auto") as RemoteSpeechPreference);
  if (!provider) return failure("No natural voice provider is configured for this language. Choose a matching device voice (no account needed) in Teacher & voice, or continue with captions.", 503, "VOICE_UNAVAILABLE");
  const language = settings.language.split("-")[0];
  const timeout = AbortSignal.timeout(25_000);
  const signal = AbortSignal.any([request.signal, timeout]);
function splitTextIntoSentenceChunks(text: string, maxChunkLength = 420): string[] {
  const clean = text.trim();
  if (clean.length <= maxChunkLength) return [clean];

  // Match sentences ending in ।, ., ?, !, ;, or newline
  const sentenceRegex = /[^।\.?!;\n]+[।\.?!;\n]+(?:\s+|$)|[^।\.?!;\n]+$/g;
  const matches = clean.match(sentenceRegex) || [clean];

  const chunks: string[] = [];
  let currentChunk = "";

  for (const part of matches) {
    const s = part.trim();
    if (!s) continue;
    if (s.length > maxChunkLength) {
      // Sub-split by comma, colon, or whitespace if a single sentence is very long
      const words = s.split(/\s+/);
      for (const word of words) {
        if (!currentChunk) {
          currentChunk = word;
        } else if ((currentChunk + " " + word).length <= maxChunkLength) {
          currentChunk += " " + word;
        } else {
          chunks.push(currentChunk);
          currentChunk = word;
        }
      }
    } else {
      if (!currentChunk) {
        currentChunk = s;
      } else if ((currentChunk + " " + s).length <= maxChunkLength) {
        currentChunk += " " + s;
      } else {
        chunks.push(currentChunk);
        currentChunk = s;
      }
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks.length ? chunks : [clean.slice(0, maxChunkLength)];
}

  const model = available.providers[provider].model;
  try {
    if (provider === "sarvam") {
      const avatarKey = typeof input.avatar === "string" ? input.avatar.toLowerCase() : "";
      const speaker = process.env.SARVAM_SPEAKER?.trim() || (typeof input.speaker === "string" && input.speaker.trim()) || SARVAM_AVATAR_SPEAKERS[avatarKey] || "shubh";
      const sarvamLang = SARVAM_LANGUAGE_CODES[settings.language] || SARVAM_LANGUAGE_CODES[language] || "en-IN";
      const chunks = splitTextIntoSentenceChunks(textToSpeak, 420);

      const fetchChunk = async (chunk: string): Promise<Buffer> => {
        const callSarvam = () => fetch("https://api.sarvam.ai/text-to-speech", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-subscription-key": process.env.SARVAM_API_KEY!.trim(),
          },
          signal,
          body: JSON.stringify({
            text: chunk,
            language_code: sarvamLang,
            model,
            speaker,
            pace: input.speed,
            output_audio_codec: "mp3",
            speech_sample_rate: 22050,
          }),
        });

        let res = await callSarvam();
        if (!res.ok && (res.status === 504 || res.status === 429 || res.status >= 500)) {
          await new Promise(r => setTimeout(r, 600));
          if (!signal.aborted) res = await callSarvam();
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`Sarvam chunk failed with status ${res.status}: ${errBody}`);
        }

        const data = await res.json() as { audios?: string[] };
        const b64 = data.audios?.[0];
        if (!b64) throw new Error("Sarvam returned empty audio chunk");
        return Buffer.from(b64, "base64");
      };

      const buffers = await Promise.all(chunks.map(c => fetchChunk(c)));
      const concatenated = Buffer.concat(buffers);
      const audioBase64 = concatenated.toString("base64");

      return Response.json({
        audioBase64,
        mimeType: "audio/mpeg",
        alignment: [],
        timingSource: "none",
        provider,
        model,
      }, { headers: noStore });
    }

    const voice = encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!.trim());
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY!.trim() },
      signal,
      body: JSON.stringify({ text: textToSpeak, language_code: language, model_id: model, voice_settings: { speed: input.speed } }),
    });

    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) return failure("The natural voice service is busy or has reached its quota. Try later or use a matching device voice.", 429, "VOICE_RATE_LIMIT");
      if (response.status === 401 || response.status === 403) return failure("The natural voice provider credentials need attention. A matching device voice works without an account.", 503, "VOICE_CONFIGURATION");
      return failure("The natural voice provider could not produce this narration. Try a matching device voice.", 502, "VOICE_PROVIDER_ERROR");
    }
    const result = await response.json();
    signal.throwIfAborted();
    const audioBase64 = result.audio_base64;
    if (typeof audioBase64 !== "string" || !audioBase64.length || audioBase64.length > 24_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(audioBase64)) return failure("The natural voice provider returned invalid audio.", 502, "INVALID_PROVIDER_AUDIO");
    const alignment = characterAlignmentToWords(result.alignment, input.text, settings.language);
    return Response.json({ audioBase64, mimeType: "audio/mpeg", alignment, timingSource: alignment.length ? "provider" : "none", provider, model }, { headers: noStore });
  } catch {
    if (request.signal.aborted) return failure("Speech was cancelled.", 499, "CANCELLED");
    if (timeout.aborted) return failure("The natural voice provider took too long. Try again or use a matching device voice.", 504, "VOICE_TIMEOUT");
    return failure("The natural voice service could not be reached. Try a matching device voice.", 502, "VOICE_NETWORK_ERROR");
  }
}
