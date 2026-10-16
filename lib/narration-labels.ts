/** Keep JSON identifiers out of speech without changing the lesson's facts. */
export function readableNarration(text: string, nodes: readonly { id: string; label: string }[]): string {
  let result = text;
  for (const { id, label } of nodes) {
    // Plain words and chemical names can also be IDs; only rewrite machine IDs.
    if (!/[-_]/.test(id)) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\s*\\((?:node\\s+)?${escaped}\\)`, "gi"), "");
    result = result.replace(new RegExp(`\\b(?:node\\s+)?${escaped}(?:\\s+node)?\\b`, "gi"), () => label);
  }
  return result.replace(/\s+([,.!?])/g, "$1").replace(/ {2,}/g, " ").trim();
}
