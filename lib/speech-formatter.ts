import { sanitizeNarrationForSpeech } from "./local-speech.ts";

/**
 * Formats lesson narration text to optimize pronunciation, clarity,
 * and natural pause cadence for AI speech synthesis.
 */

// Common measurement units to expand for clear pronunciation
const UNIT_REPLACEMENTS: [RegExp, string][] = [
  // Speed, acceleration & distance
  [/\b(\d+(?:\.\d+)?)\s*km\s*\/\s*s\b/gi, "$1 kilometers per second"],
  [/\bkm\s*\/\s*s\b/gi, "kilometers per second"],
  [/\b(\d+(?:\.\d+)?)\s*m\s*\/\s*(?:s\^2|s²)\b/gi, "$1 meters per second squared"],
  [/\bm\s*\/\s*(?:s\^2|s²)\b/gi, "meters per second squared"],
  [/\b(\d+(?:\.\d+)?)\s*m\s*\/\s*s\b/gi, "$1 meters per second"],
  [/\bm\s*\/\s*s\b/gi, "meters per second"],
  [/\b(\d+(?:\.\d+)?)\s*km\s*\/\s*h\b/gi, "$1 kilometers per hour"],
  [/\bkm\s*\/\s*h\b/gi, "kilometers per hour"],
  [/\b(\d+(?:\.\d+)?)\s*mph\b/gi, "$1 miles per hour"],
  [/\b(\d+(?:\.\d+)?)\s*rad\s*\/\s*s\b/gi, "$1 radians per second"],
  [/\brad\s*\/\s*s\b/gi, "radians per second"],
  [/\b(\d+(?:\.\d+)?)\s*km\b/gi, "$1 kilometers"],
  [/\b(\d+(?:\.\d+)?)\s*m\b/gi, "$1 meters"],
  [/\b(\d+(?:\.\d+)?)\s*cm\b/gi, "$1 centimeters"],
  [/\b(\d+(?:\.\d+)?)\s*mm\b/gi, "$1 millimeters"],
  [/\b(\d+(?:\.\d+)?)\s*nm\b/gi, "$1 nanometers"],

  // Energy, force & mass
  [/\b(\d+(?:\.\d+)?)\s*J\s*\/\s*kg\b/gi, "$1 joules per kilogram"],
  [/\bJ\s*\/\s*kg\b/gi, "joules per kilogram"],
  [/\b(\d+(?:\.\d+)?)\s*N\s*\/\s*m\b/gi, "$1 newtons per meter"],
  [/\bN\s*\/\s*m\b/gi, "newtons per meter"],
  [/\b(\d+(?:\.\d+)?)\s*N\s*\/\s*kg\b/gi, "$1 newtons per kilogram"],
  [/\bN\s*\/\s*kg\b/gi, "newtons per kilogram"],
  [/\b(\d+(?:\.\d+)?)\s*kg\s*\/\s*(?:m\^3|m³)\b/gi, "$1 kilograms per cubic meter"],
  [/\bkg\s*\/\s*(?:m\^3|m³)\b/gi, "kilograms per cubic meter"],
  [/\b(\d+(?:\.\d+)?)\s*W\s*\/\s*(?:m\^2|m²)\b/gi, "$1 watts per square meter"],
  [/\bW\s*\/\s*(?:m\^2|m²)\b/gi, "watts per square meter"],
  [/\b(\d+(?:\.\d+)?)\s*kg\b/gi, "$1 kilograms"],

  // Weight & mass
  [/\b(\d+(?:\.\d+)?)\s*kg\b/gi, "$1 kilograms"],
  [/\b(\d+(?:\.\d+)?)\s*mg\b/gi, "$1 milligrams"],
  [/\b(\d+(?:\.\d+)?)\s*t\b/gi, "$1 tons"],

  // Electrical & power
  [/\b(\d+(?:\.\d+)?)\s*kV\b/gi, "$1 kilovolts"],
  [/\b(\d+(?:\.\d+)?)\s*mV\b/gi, "$1 millivolts"],
  [/\b(\d+(?:\.\d+)?)\s*V\b/gi, "$1 volts"],
  [/\b(\d+(?:\.\d+)?)\s*kW\b/gi, "$1 kilowatts"],
  [/\b(\d+(?:\.\d+)?)\s*MW\b/gi, "$1 megawatts"],
  [/\b(\d+(?:\.\d+)?)\s*GW\b/gi, "$1 gigawatts"],
  [/\b(\d+(?:\.\d+)?)\s*W\b/gi, "$1 watts"],
  [/\b(\d+(?:\.\d+)?)\s*mA\b/gi, "$1 milliamps"],
  [/\b(\d+(?:\.\d+)?)\s*A\b/gi, "$1 amps"],
  [/\b(\d+(?:\.\d+)?)\s*hp\b/gi, "$1 horsepower"],
  [/\b(\d+(?:\.\d+)?)\s*rpm\b/gi, "$1 revolutions per minute"],

  // Frequencies
  [/\b(\d+(?:\.\d+)?)\s*GHz\b/gi, "$1 gigahertz"],
  [/\b(\d+(?:\.\d+)?)\s*MHz\b/gi, "$1 megahertz"],
  [/\b(\d+(?:\.\d+)?)\s*kHz\b/gi, "$1 kilohertz"],
  [/\b(\d+(?:\.\d+)?)\s*Hz\b/gi, "$1 hertz"],

  // Temperature & percentages
  [/\b(\d+(?:\.\d+)?)\s*°C\b/gi, "$1 degrees Celsius"],
  [/\b(\d+(?:\.\d+)?)\s*°F\b/gi, "$1 degrees Fahrenheit"],
  [/\b(\d+(?:\.\d+)?)\s*%\b/gi, "$1 percent"],
];

// Common abbreviations to expand into clear spoken English
const ABBREVIATION_REPLACEMENTS: [RegExp, string][] = [
  [/\be\.g\.,?\s*/gi, "for example, "],
  [/\bi\.e\.,?\s*/gi, "that is, "],
  [/\bvs\.?\s*/gi, "versus "],
  [/\bapprox\.?\s*/gi, "approximately "],
  [/\betc\.?\s*/gi, "and so on. "],
  [/(?<![-a-zA-Z0-9])min\.(?=\s|$)/gi, "minutes "],
  [/(?<=\d\s*)min\b(?![-a-zA-Z0-9])/gi, "minutes"],
  [/(?<![-a-zA-Z0-9])\bmin\b(?![-a-zA-Z0-9])/gi, "minutes"],
  [/(?<![-a-zA-Z0-9])sec\.(?=\s|$)/gi, "seconds "],
  [/(?<=\d\s*)sec\b(?![-a-zA-Z0-9])/gi, "seconds"],
  [/(?<![-a-zA-Z0-9])\bsec\b(?![-a-zA-Z0-9])/gi, "seconds"],
  [/\bdept\.?\s*/gi, "department "],
  [/\bno\.\s*(\d+)/gi, "number $1"],
];

// Technical shorthand and symbols
const SYMBOL_REPLACEMENTS: [RegExp, string][] = [
  [/-->|->|→/g, ", which leads to, "],
  [/==>|=>|⇒/g, ", producing, "],
  [/<--|<-|←/g, ", derived from, "],
  [/\s*\+\s*/g, " plus "],
  [/\s*=\s*/g, " equals "],
  [/\s*&\s*/g, " and "],
  [/\b([a-zA-Z]{1,3})\s*\/\s*([a-zA-Z]{1,3})\b/g, "$1 divided by $2"],
  [/\b(and|or|true|false|input|output|yes|no|read|write|client|server)\/(and|or|true|false|input|output|yes|no|read|write|client|server)\b/gi, "$1 or $2"],
  [/([a-zA-Z0-9])\s*\/\s*([a-zA-Z0-9])/g, "$1 divided by $2"],
  // Mathematical and ML symbols
  [/x₁/g, "x 1"],
  [/x₂/g, "x 2"],
  [/x₃/g, "x 3"],
  [/h₁/g, "h 1"],
  [/h₂/g, "h 2"],
  [/h₃/g, "h 3"],
  [/h₄/g, "h 4"],
  [/ŷ/g, "y-hat"],
  [/W₁/g, "W 1"],
  [/W₂/g, "W 2"],
  [/ΔW|Δw/g, "delta W"],
  [/\bσ\b|σ/g, "sigma"],
  [/\bη\b|η/g, "eta"],
  [/½/g, "one-half"],
  [/∂L\s*\/\s*∂W/gi, "the gradient of loss with respect to W"],
];

/**
 * Formats a raw narration string with natural breath pauses,
 * expanded abbreviations, and phonetic spacing.
 */
export function formatNarrationForSpeech(text: string, language?: string | { language?: string; mode?: string } | null): string {
  if (!text) return "";

  let formatted = sanitizeNarrationForSpeech(text, language);

  // Strip "Beat / Step / Stage / Phase / Part" meta-labels
  formatted = formatted.replace(/\b(?:Beat|Step|Stage|Phase|Part)\s+(?:one|two|three|four|five|six|\d+)\s*[:,.\-—]?\s*/gi, "");
  formatted = formatted.replace(/\bkilometers?\s+divided\s+by\s+(?:seconds?|s)\b/gi, "kilometers per second");
  formatted = formatted.replace(/\bkilometer\s+divided\s+by\s+s\b/gi, "kilometers per second");

  // 1. Expand technical units
  for (const [pattern, replacement] of UNIT_REPLACEMENTS) {
    formatted = formatted.replace(pattern, replacement);
  }

  // 2. Expand common Latin and written abbreviations
  for (const [pattern, replacement] of ABBREVIATION_REPLACEMENTS) {
    formatted = formatted.replace(pattern, replacement);
  }

  // 3. Expand symbols
  for (const [pattern, replacement] of SYMBOL_REPLACEMENTS) {
    formatted = formatted.replace(pattern, replacement);
  }

  // 4. Space out hyphenated alphanumeric model/part numbers (e.g. WAG-12B -> WAG 12 B)
  // so TTS engines pronounce each code character clearly rather than trying to read it as a single mangled word.
  formatted = formatted.replace(/\b([A-Z]{2,})-([0-9]+)([A-Z]?)\b/g, "$1 $2 $3");

  // 5. Punctuation and Natural Cadence Pauses:
  // Colons and semicolons should introduce a distinct natural breath pause
  formatted = formatted.replace(/;\s*/g, ", ");
  formatted = formatted.replace(/:\s*/g, ", ");

  // Em dashes and double dashes -> clean comma pause
  formatted = formatted.replace(/\s*—\s*/g, ", ");
  formatted = formatted.replace(/\s*--\s*/g, ", ");

  // Clean up parentheticals so they flow like spoken side-notes
  formatted = formatted.replace(/\s*\(([^)]+)\)/g, ", $1, ");

  // Break up long clauses at key transition words with a slight comma pause if not already punctuated
  formatted = formatted.replace(/([^\s,;:.!?])\s+(which|whereas|causing|allowing|thereby)\s+/gi, "$1, $2 ");

  // Deduplicate redundant commas and clean up spacing
  formatted = formatted.replace(/\s+,/g, ",");
  formatted = formatted.replace(/,\s*,+/g, ", ");
  formatted = formatted.replace(/,\s*([.!?])/g, "$1");
  formatted = formatted.replace(/\s{2,}/g, " ").trim();

  // Final sanitation sweep for stray markdown or characters
  formatted = sanitizeNarrationForSpeech(formatted, language);

  // Ensure clean terminal punctuation so the voice doesn't clip the final syllable
  if (!/[.!?]$/.test(formatted)) {
    formatted += ".";
  }

  return formatted;
}
