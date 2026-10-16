import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLessonWithGroq } from "@/lib/groq";
import { getGroqQuotaSnapshot, GroqFreeLimitError, type GroqCallOptions } from "@/lib/groq-pool";
import { resolveProviderCredentials } from "@/lib/provider-credentials";
import { providerEventStream } from "@/lib/provider-response";
import { researchQuestion } from "@/lib/research";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  sessionId: z.string().trim().min(1).max(120).optional(),
  preferredGroqKeyId: z.string().trim().max(32).optional(),
  useWeb: z.literal(true).default(true),
});

export async function POST(request: NextRequest) {
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid lesson request", code: "INVALID_REQUEST", message: "Enter a question between 3 and 1000 characters.", retryable: false }, { status: 400 }); }

  return providerEventStream(request, async (send, signal) => {
    send("status", { stage: "understanding", message: "Understanding the question" });
    const quota = await getGroqQuotaSnapshot(input.sessionId, input.preferredGroqKeyId);
    send("provider_status", quota);
    if (quota.allUnavailable) throw new GroqFreeLimitError(quota);
    const credentials = await resolveProviderCredentials();
    signal.throwIfAborted();
    if (!credentials.groqKeys.length) {
      throw new GroqFreeLimitError({ source: credentials.source, allUnavailable: true, degradationReason: "no_keys", keys: [] });
    }
    const groqOptions: GroqCallOptions = {
      sessionId: input.sessionId,
      preferredKeyId: input.preferredGroqKeyId,
      signal,
      timeoutMs: 180_000,
      onStatus: (status) => send("provider_status", status),
    };
    send("status", { stage: "research", message: "Searching and deduplicating up to 20 sources" });
    const { sources, context } = await researchQuestion(input.question, input.sessionId ?? crypto.randomUUID(), groqOptions);
    send("sources", { sources, indexed: true });
    send("status", { stage: "ranking", message: `Indexed ${sources.length} sources · ranking relevant passages` });
    send("status", { stage: "visualizing", message: "Designing a visual explanation" });
    const lesson = await createLessonWithGroq(input.question, context, sources, groqOptions);
    send("lesson", { lesson: { ...lesson, sources }, mode: "live" });
  });
}
