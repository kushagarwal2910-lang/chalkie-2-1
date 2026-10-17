export interface LessonLanguageSettings {
  mode: "native" | "code-switch";
  /** BCP-47 language tag, selected from LANGUAGE_OPTIONS. */
  language: string;
}

export const LANGUAGE_OPTIONS = [
  { code: "en-US", label: "English", nativeName: "English" },
  { code: "hi-IN", label: "Hindi", nativeName: "हिन्दी", mixedName: "Hinglish" },
  { code: "te-IN", label: "Telugu", nativeName: "తెలుగు", mixedName: "Teluglish" },
  { code: "ta-IN", label: "Tamil", nativeName: "தமிழ்", mixedName: "Tanglish" },
  { code: "bn-IN", label: "Bengali", nativeName: "বাংলা" },
  { code: "mr-IN", label: "Marathi", nativeName: "मराठी" },
  { code: "gu-IN", label: "Gujarati", nativeName: "ગુજરાતી" },
  { code: "kn-IN", label: "Kannada", nativeName: "ಕನ್ನಡ" },
  { code: "ml-IN", label: "Malayalam", nativeName: "മലയാളം" },
  { code: "pa-IN", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { code: "or-IN", label: "Odia", nativeName: "ଓଡ଼ିଆ" },
  { code: "es-ES", label: "Spanish", nativeName: "Español" },
  { code: "fr-FR", label: "French", nativeName: "Français" },
  { code: "de-DE", label: "German", nativeName: "Deutsch" },
  { code: "pt-BR", label: "Portuguese", nativeName: "Português" },
  { code: "it-IT", label: "Italian", nativeName: "Italiano" },
  { code: "ar-SA", label: "Arabic", nativeName: "العربية" },
  { code: "zh-CN", label: "Chinese", nativeName: "中文" },
  { code: "ja-JP", label: "Japanese", nativeName: "日本語" },
  { code: "ko-KR", label: "Korean", nativeName: "한국어" },
  { code: "ru-RU", label: "Russian", nativeName: "Русский" },
  { code: "id-ID", label: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "vi-VN", label: "Vietnamese", nativeName: "Tiếng Việt" },
] as const;

export const defaultLessonLanguage: LessonLanguageSettings = { mode: "native", language: "en-US" };
export const LESSON_LANGUAGE_STORAGE_KEY = "chalkie:lesson-language";

export function normalizeLessonLanguage(value: unknown): LessonLanguageSettings {
  const input = value && typeof value === "object" ? value as Partial<LessonLanguageSettings> : {};
  const requested = typeof input.language === "string" ? input.language.toLowerCase() : "";
  const language = LANGUAGE_OPTIONS.find(option => option.code.toLowerCase() === requested
    || option.label.toLowerCase() === requested || option.code.split("-")[0] === requested)?.code ?? "en-US";
  return { mode: input.mode === "code-switch" && language !== "en-US" ? "code-switch" : "native", language };
}

export function readLessonLanguage(): LessonLanguageSettings {
  try { return normalizeLessonLanguage(JSON.parse(localStorage.getItem(LESSON_LANGUAGE_STORAGE_KEY) || "null")); }
  catch { return { ...defaultLessonLanguage }; }
}

export function saveLessonLanguage(settings: LessonLanguageSettings) {
  try { localStorage.setItem(LESSON_LANGUAGE_STORAGE_KEY, JSON.stringify(normalizeLessonLanguage(settings))); }
  catch { /* Lessons still work when optional browser storage is unavailable. */ }
}

export function isEnglishLessonLanguage(settings?: LessonLanguageSettings | null) {
  return !settings || normalizeLessonLanguage(settings).language.startsWith("en");
}

export function getLessonLanguagePrompt(settings?: LessonLanguageSettings | null): string {
  const normalized = normalizeLessonLanguage(settings);
  const option = LANGUAGE_OPTIONS.find(item => item.code === normalized.language)!;
  const boardLanguage = normalized.mode === "code-switch" ? "English" : option.label;
  return [
    `LANGUAGE CONTRACT: Board language is ${boardLanguage}. Spoken language is ${option.label} (${option.code}).`,
    normalized.mode === "code-switch"
      ? `CLASSROOM CODE-SWITCH: Write ALL visible card titles, labels, graph axes, scientific terms, image callouts and summaries in clean English. Speak conversational ${option.label} mixed naturally with English scientific terms. Write regional words in their native script for reliable speech, keep English scientific names exactly as they appear on the board, and introduce those names aloud before explaining them.`
      : `NATIVE MODE: Write board labels, captions, summaries and narration in ${option.label} using its native script. Preserve conventional mathematical symbols, chemical formulas, source quotations and proper names where translation would change meaning.`,
    "Keep labels short; wrap rather than shrink text. Never translate stable object IDs, region IDs, source IDs, data keys or JSON schema field names. Preserve numeric data and units.",
    "Every speech cue must quote an exact phrase from the spoken narration in its actual language and point to an existing object/region. In code-switch mode the spoken English scientific term provides the anchor to the English board label. Use short, complete teaching phrases so highlighting follows the explanation.",
  ].join("\n");
}

/** A missing regional voice must remain missing; an English voice is not a fallback. */
export function getMatchingDeviceVoice(voices: SpeechSynthesisVoice[], settings: LessonLanguageSettings, preferredUri?: string | null): SpeechSynthesisVoice | null {
  const language = normalizeLessonLanguage(settings).language.toLowerCase();
  const base = language.split("-")[0];
  const matching = voices.filter(voice => voice.lang.toLowerCase().replaceAll("_", "-").split("-")[0] === base);
  return matching.find(voice => voice.voiceURI === preferredUri || voice.name === preferredUri)
    ?? matching.find(voice => voice.lang.toLowerCase() === language && /natural|neural|online/i.test(voice.name))
    ?? matching.find(voice => /natural|neural|online/i.test(voice.name))
    ?? matching.find(voice => voice.lang.toLowerCase() === language)
    ?? matching[0] ?? null;
}

export function getLanguageSample(settings: LessonLanguageSettings): string {
  const { language, mode } = normalizeLessonLanguage(settings);
  const native: Record<string, string> = {
    "en-US": "Let's explore this together. Follow the highlighted part of the board as I explain it.",
    "hi-IN": "आइए इसे साथ में समझते हैं। बोर्ड पर जिस हिस्से को दिखाया गया है, उस पर ध्यान दीजिए।",
    "te-IN": "దీన్ని కలిసి అర్థం చేసుకుందాం. బోర్డుపై చూపించిన భాగాన్ని గమనించండి.",
    "ta-IN": "இதை ஒன்றாகப் புரிந்துகொள்வோம். பலகையில் காட்டப்பட்டுள்ள பகுதியைக் கவனியுங்கள்.",
    "bn-IN": "আসুন একসঙ্গে বুঝে নিই। বোর্ডে দেখানো অংশটি লক্ষ্য করুন।",
    "mr-IN": "चला हे एकत्र समजून घेऊया. फळ्यावर दाखवलेल्या भागाकडे लक्ष द्या.",
    "gu-IN": "ચાલો આને સાથે સમજીએ. બોર્ડ પર બતાવેલા ભાગ પર ધ્યાન આપો.",
    "kn-IN": "ಇದನ್ನು ಒಟ್ಟಿಗೆ ಅರ್ಥಮಾಡಿಕೊಳ್ಳೋಣ. ಬೋರ್ಡ್ ಮೇಲೆ ತೋರಿಸಿದ ಭಾಗವನ್ನು ಗಮನಿಸಿ.",
    "ml-IN": "നമുക്ക് ഇത് ഒരുമിച്ച് മനസ്സിലാക്കാം. ബോർഡിൽ കാണിച്ചിരിക്കുന്ന ഭാഗം ശ്രദ്ധിക്കുക.",
    "pa-IN": "ਆਓ ਇਸ ਨੂੰ ਇਕੱਠੇ ਸਮਝੀਏ। ਬੋਰਡ ਉੱਤੇ ਦਿਖਾਏ ਹਿੱਸੇ ਵੱਲ ਧਿਆਨ ਦਿਓ।",
    "or-IN": "ଆସନ୍ତୁ ଏହାକୁ ଏକାଠି ବୁଝିବା। ବୋର୍ଡରେ ଦେଖାଯାଇଥିବା ଅଂଶକୁ ଧ୍ୟାନ ଦିଅନ୍ତୁ।",
    "es-ES": "Vamos a entenderlo juntos. Observa la parte resaltada de la pizarra mientras la explico.",
    "fr-FR": "Comprenons cela ensemble. Suivez la partie du tableau que je mets en évidence.",
    "de-DE": "Schauen wir uns das gemeinsam an. Achte auf den markierten Bereich der Tafel.",
    "pt-BR": "Vamos entender isso juntos. Observe a parte destacada do quadro enquanto eu explico.",
    "it-IT": "Capiamolo insieme. Segui la parte evidenziata della lavagna mentre la spiego.",
    "ar-SA": "لنفهم هذا معًا. انتبه إلى الجزء المحدد على اللوحة أثناء الشرح.",
    "zh-CN": "让我们一起理解它。讲解时，请注意白板上突出显示的部分。",
    "ja-JP": "一緒に理解していきましょう。説明する間、ボードで強調した部分に注目してください。",
    "ko-KR": "함께 이해해 봅시다. 설명하는 동안 보드에서 강조된 부분을 봐 주세요.",
    "ru-RU": "Давайте разберёмся вместе. Следите за выделенной частью доски, пока я объясняю.",
    "id-ID": "Mari kita pahami bersama. Perhatikan bagian papan yang disorot saat saya menjelaskan.",
    "vi-VN": "Hãy cùng tìm hiểu nhé. Chú ý phần được đánh dấu trên bảng khi tôi giải thích.",
  };
  if (mode === "code-switch") {
    if (language === "hi-IN") return "इस graph में horizontal axis पर time है। अब highlighted point देखिए, यहाँ value बढ़ रही है।";
    if (language === "te-IN") return "ఈ graph లో horizontal axis మీద time ఉంది. ఇప్పుడు highlighted point చూడండి, ఇక్కడ value పెరుగుతోంది.";
    if (language === "ta-IN") return "இந்த graph இல் horizontal axis இல் time உள்ளது. இப்போது highlighted point பாருங்கள், இங்கே value அதிகரிக்கிறது.";
  }
  return native[language] ?? native["en-US"];
}
