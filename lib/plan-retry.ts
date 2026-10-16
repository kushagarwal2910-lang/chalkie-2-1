/** Groq may reject malformed structured output before returning a completion. */
export function isStructuredOutputFailure(status: number, body: string): boolean {
  if (status !== 400) return false;
  try { return JSON.parse(body)?.error?.code === "json_validate_failed"; } catch { return false; }
}
