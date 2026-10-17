import { LANGUAGE_OPTIONS, normalizeLessonLanguage } from "@/lib/lesson-language";
import { SARVAM_LANGUAGE_CODES } from "@/lib/remote-speech";
import { sanitizeNarrationForSpeech } from "@/lib/local-speech";
import { groqFetch } from "@/lib/groq-pool";
import { TEXT_MODEL } from "@/lib/models";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };

const SARVAM_TRANSLATE_CODES: Record<string, string> = {
  "hi-IN": "hi-IN", hi: "hi-IN",
  "te-IN": "te-IN", te: "te-IN",
  "ta-IN": "ta-IN", ta: "ta-IN",
  "bn-IN": "bn-IN", bn: "bn-IN",
  "mr-IN": "mr-IN", mr: "mr-IN",
  "gu-IN": "gu-IN", gu: "gu-IN",
  "kn-IN": "kn-IN", kn: "kn-IN",
  "ml-IN": "ml-IN", ml: "ml-IN",
  "pa-IN": "pa-IN", pa: "pa-IN",
  "or-IN": "od-IN", "od-IN": "od-IN", or: "od-IN",
};

async function translateWithSarvam(
  text: string,
  targetCode: string,
  mode: "native" | "code-switch",
  avatar?: string,
  signal?: AbortSignal
): Promise<string | null> {
  const apiKey = process.env.SARVAM_API_KEY?.trim();
  if (!apiKey) return null;

  const target = SARVAM_TRANSLATE_CODES[targetCode] || SARVAM_TRANSLATE_CODES[targetCode.split("-")[0]];
  if (!target) return null;

  try {
    const response = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      signal,
      body: JSON.stringify({
        input: text,
        source_language_code: "en-IN",
        target_language_code: target,
        speaker_gender: avatar?.toLowerCase() === "mira" ? "Female" : "Male",
        mode: mode === "native" ? "formal" : "code-mixed",
        model: "mayura:v1",
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data.translated_text === "string" && data.translated_text.trim()) {
      return sanitizeNarrationForSpeech(data.translated_text, targetCode);
    }
  } catch {
    // Gracefully fallback to Groq
  }
  return null;
}

async function translateWithGroq(
  text: string,
  targetCode: string,
  mode: "native" | "code-switch",
  signal?: AbortSignal
): Promise<string> {
  const normalized = normalizeLessonLanguage({ language: targetCode, mode });
  const option = LANGUAGE_OPTIONS.find(o => o.code === normalized.language)
    || LANGUAGE_OPTIONS.find(o => o.code.split("-")[0] === normalized.language.split("-")[0])
    || { label: targetCode, nativeName: targetCode, mixedName: `${targetCode} + English` };

  const systemPrompt = [
    `You are an expert bilingual classroom educator. Translate the following educational lesson narration from English into ${option.label} (${option.nativeName}).`,
    mode === "code-switch"
      ? `CLASSROOM CODE-SWITCH (${("mixedName" in option && option.mixedName) || option.label + " + English"}): Speak conversational ${option.label} mixed naturally with English scientific terms, mathematical variables, and whiteboard card titles. Write regional words in their native script.`
      : `NATIVE MODE: Translate into natural, fluent ${option.label} in native script while preserving mathematical and scientific clarity.`,
    "RULES:",
    "- NEVER use markdown formatting symbols (** or *), bullet points (* or -), or internal machine IDs (n1, n2, node-1).",
    "- Express mathematical formulas and variables in natural spoken words.",
    "- NEVER transliterate or pronounce math symbols like 'sqrt' letter-by-letter (e.g. NEVER output 'एस क्यू आर टी' or 'स्क्वार एटी' or 'S-Q-R-T'). For Hindi/Hinglish use 'वर्गमूल' or 'square root'.",
    "- For multiplication, write 'times' or 'गुना', NEVER asterisks (*) or raw code syntax.",
    "- Preserve the rich, detailed teacher tone with clear, step-by-step explanations.",
    "- Output ONLY the final spoken narration text with no introductory phrases, quotes, or markdown.",
  ].join("\n");

  const response = await groqFetch(
    "/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 0.2,
        max_completion_tokens: 2500,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
      }),
    },
    { signal }
  );

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content?.trim() || text;
  return sanitizeNarrationForSpeech(raw, targetCode);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, targetLanguage, mode = "code-switch", avatar } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return Response.json({ translatedText: "", provider: "none" }, { headers: noStore });
    }

    if (!targetLanguage || typeof targetLanguage !== "string" || targetLanguage.startsWith("en-US")) {
      return Response.json({ translatedText: sanitizeNarrationForSpeech(text), provider: "passthrough" }, { headers: noStore });
    }

    const timeout = AbortSignal.timeout(30_000);
    const signal = AbortSignal.any([request.signal, timeout]);

    // 1. If Indian language, try Sarvam translation first
    const sarvamResult = await translateWithSarvam(text, targetLanguage, mode, avatar, signal);
    if (sarvamResult) {
      return Response.json({ translatedText: sarvamResult, provider: "sarvam" }, { headers: noStore });
    }

    // 2. Fallback or non-Indian languages -> Groq Llama 3.3 70B
    const groqResult = await translateWithGroq(text, targetLanguage, mode, signal);
    return Response.json({ translatedText: groqResult, provider: "groq" }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Translation failed";
    return Response.json({ error: message }, { status: 500, headers: noStore });
  }
}
