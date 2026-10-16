export class ResearchError extends Error {
  readonly code: "RESEARCH_REQUIRED" | "RESEARCH_UNAVAILABLE" | "NO_RESEARCH_EVIDENCE";
  constructor(code: ResearchError["code"], message: string) { super(message); this.code = code; }
}

/** Live generation must not silently fall back to the model's general knowledge. */
export function requireResearchEvidence(context: string, sources: readonly { summary: string }[]) {
  if (!context.trim() || !sources.some(source => source.summary.trim())) {
    throw new ResearchError("NO_RESEARCH_EVIDENCE", "No usable research was found. Try a more specific question; your board has been kept.");
  }
}
