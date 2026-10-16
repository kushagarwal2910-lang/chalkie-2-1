const nonEvidenceHosts = ["pinterest.com", "facebook.com", "instagram.com", "tiktok.com", "shutterstock.com", "istockphoto.com", "gettyimages.com", "alamy.com", "brainly.in", "brainly.com", "scribd.com"];
const matches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function usableEvidenceUrl(value: string) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !nonEvidenceHosts.some(host => matches(url.hostname, host)); } catch { return false; }
}
export function sourceAuthority(value: string) {
  try {
    const host = new URL(value).hostname;
    return /\.(gov|edu)$/.test(host) || /\.(ac|gov)\.[a-z]{2}$/.test(host)
      || ["si.edu", "amnh.org", "calacademy.org", "britannica.com", "nasa.gov", "khanacademy.org", "openstax.org", "royalsociety.org", "nature.com"].some(domain => matches(host, domain)) ? 1 : 0;
  } catch { return 0; }
}

/** Separate the subject being researched from requests about board presentation. */
export function researchQuery(question: string) {
  const sentences = question.split(/(?<=[.!?])\s+/);
  const query = sentences.filter(sentence => !/^(include|show|draw|add|use|point out|highlight)\b.*\b(image|diagram|picture|photo|illustration|flowchart|visible parts)\b/i.test(sentence)).join(" ").trim();
  return query.length >= 3 ? query : question;
}

/** Rank the excerpt we actually send, not a long passage whose tail is discarded. */
export function relevantExcerpt(question: string, text: string, maxChars = 700) {
  const terms = [...new Set(question.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter(term => !["the", "and", "how", "what", "why", "with", "this", "that", "explain", "include"].includes(term));
  if (text.length <= maxChars) return text;
  let best = text.slice(0, maxChars), bestScore = -1;
  for (let start = 0; start < text.length; start += 200) {
    const end = Math.min(text.length, start + maxChars);
    const window = text.slice(start, end);
    const score = terms.reduce((sum, term) => sum + (window.toLowerCase().includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      // Avoid changing meaning by cutting words at either boundary.
      best = window.replace(start ? /^\S*\s*/ : /^$/, "").replace(end < text.length ? /\s*\S*$/ : /$/, "");
    }
  }
  return best;
}
