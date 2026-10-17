import { convertMathToSpokenText } from "./local-speech.ts";

/** Keep JSON identifiers and Markdown symbols out of speech and subtitles without changing the lesson's facts. */
export function readableNarration(text: string, nodes: readonly { id: string; label: string }[]): string {
  if (!text) return "";
  let result = convertMathToSpokenText(text);

  // Strip leading bullet marks e.g. "* Item", "- Item", "• Item"
  result = result.replace(/^[\s*•\-–—]+\s*/gm, "");
  result = result.replace(/(\n)[\s*•\-–—]+\s*/g, "$1 ");

  // Strip citations e.g. [1], [2], [1-3]
  result = result.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "");

  // Strip "Beat 1 / Beat 2 / Beat 3 / Beat 4 / Beat one / Step 1" meta-labels
  result = result.replace(/\bBeat\s+(?:one|two|three|four|\d+)\s*[:,.\-—]?\s*/gi, "");
  result = result.replace(/\b(?:Step|Phase|Part)\s+\d+\s*[:,.\-—]\s*/gi, "");

  // 1. Strip Markdown formatting symbols: **, *, __, _, `, #
  result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  result = result.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/[*#~_`^]/g, "");

  // 2. Remove parenthetical or bracketed node IDs e.g. (n1), (n2), [n3], (node-1), (step-1)
  result = result.replace(/\s*\([a-zA-Z0-9_-]*(?:node|step|n)\d+[a-zA-Z0-9_-]*\)/gi, "");
  result = result.replace(/\s*\[[a-zA-Z0-9_-]*(?:node|step|n)\d+[a-zA-Z0-9_-]*\]/gi, "");

  // 3. Clean up phrases where internal node IDs are spoken with nouns in Hindi, Hinglish, or English:
  // e.g. "n3 बॉक्स में", "n2 चित्र में", "n5 बॉक्स में लिखा है", "n1 का आरेख", "n6 का ग्राफ"
  // e.g. "n3 box", "n2 image", "n1 diagram", "n6 graph", "card n3"
  result = result.replace(/\b(?:node[-_]?)?n\d+\s+(बॉक्स|चित्र|आरेख|ग्राफ|कार्ड|चरण|फ़्लोचार्ट|box|card|diagram|image|step|chart|figure)\b/gi, "$1");
  result = result.replace(/\b(बॉक्स|चित्र|आरेख|ग्राफ|कार्ड|चरण|फ़्लोचार्ट|box|card|diagram|image|step|chart|figure)\s+(?:node[-_]?)?n\d+\b/gi, "$1");
  result = result.replace(/\b(?:node[-_]?)?n\d+\s*का\s*(आरेख|ग्राफ|चित्र|बॉक्स|कार्ड)\b/gi, "$1");
  result = result.replace(/\b(?:node[-_]?)?n\d+\s*की\s*(तस्वीर|इमेज)\b/gi, "$1");
  result = result.replace(/\b(?:node[-_]?)?n\d+\s*के\s*(अनुसार|बारे\s*में)\b/gi, "इसके $1");

  // 4. Remove isolated machine IDs (n1, n2, n3, n4, n5, n6, node-1, etc.)
  result = result.replace(/\b(?:node[-_]?)?n[1-9]\d*\b/gi, "");
  result = result.replace(/\bnode[-_]\d+\b/gi, "");
  result = result.replace(/\bstep[-_]\d+\b/gi, "");

  // 5. Replace any remaining machine IDs from declared nodes with their labels
  for (const { id, label } of nodes) {
    if (!id || !/[-_]/.test(id)) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\s*\\((?:node\\s+)?${escaped}\\)`, "gi"), "");
    result = result.replace(new RegExp(`\\b(?:node\\s+)?${escaped}(?:\\s+node)?\\b`, "gi"), () => label);
  }

  return result.replace(/\s+([,.!?])/g, "$1").replace(/ {2,}/g, " ").trim();
}
