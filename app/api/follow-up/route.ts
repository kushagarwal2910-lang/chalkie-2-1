import type { NextRequest } from "next/server";
import { z } from "zod";
import { createFollowUpWithGroq } from "@/lib/groq";
import { getGroqQuotaSnapshot, GroqFreeLimitError, type GroqCallOptions } from "@/lib/groq-pool";
import { providerEventStream } from "@/lib/provider-response";
import { lessonPlanSchema } from "@/lib/lesson-schema";
import { retrieveSessionContext } from "@/lib/research";
import { ResearchError } from "@/lib/research-evidence";
import { sourceMaterialsSchema } from "@/lib/source-materials";
import { lessonLanguageSchema } from "@/lib/lesson-schema";
import { defaultLessonLanguage } from "@/lib/lesson-language";
import { extractSourceVisionEvidence } from "@/lib/source-vision";
import { localGraphEvidence } from "@/lib/plot-lesson";

export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  sessionId: z.string().trim().min(1).max(120),
  preferredGroqKeyId: z.string().trim().max(32).optional(),
  currentLesson: lessonPlanSchema,
  sourceMaterials: sourceMaterialsSchema.optional(),
  useWeb: z.boolean().optional(),
  language: lessonLanguageSchema.optional(),
});

export async function POST(request: NextRequest) {
  let input: z.infer<typeof requestSchema>;
  try { input = requestSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid follow-up request", code: "INVALID_REQUEST", message: "The follow-up request or current lesson is invalid.", retryable: false }, { status: 400 }); }

  return providerEventStream(request, async (send, signal) => {
    const quota = await getGroqQuotaSnapshot(input.sessionId, input.preferredGroqKeyId);
    send("provider_status", quota);
    if (quota.allUnavailable) throw new GroqFreeLimitError(quota);
    const groqOptions: GroqCallOptions = {
      sessionId: input.sessionId,
      preferredKeyId: input.preferredGroqKeyId,
      signal,
      timeoutMs: 180_000,
      onStatus: (status) => send("provider_status", status),
    };
    send("status", { stage: "understanding", message: "Understanding your doubt" });
    send("status", { stage: "retrieving", message: "Retrieving from this lesson's research index" });
    const sourceMaterials = input.sourceMaterials ? await extractSourceVisionEvidence(input.sourceMaterials, groqOptions) : undefined;
    if (sourceMaterials) send("source_materials", { materials: sourceMaterials.map(({ id, text }) => ({ id, text })) });
    const research = await retrieveSessionContext(input.question, input.sessionId, input.currentLesson.sources, groqOptions, sourceMaterials !== undefined || input.useWeb !== undefined ? { sourceMaterials, includeWebSearch: input.useWeb } : undefined);
    const graphEvidence = localGraphEvidence(input.currentLesson);
    if (graphEvidence.context) {
      research.context = [research.context, graphEvidence.context].filter(Boolean).join("\n\n");
      research.sources = [...graphEvidence.sources, ...research.sources.filter(source => !graphEvidence.sources.some(graph => graph.id === source.id))].slice(0, 20);
    }
    if (!research.context.trim()) {
      throw new ResearchError("NO_RESEARCH_EVIDENCE", "This lesson has no saved research. Start a new topic to retrieve evidence; follow-ups do not run new web searches.");
    }
    send("status", { stage: "checking_canvas", message: research.indexed ? "Checking the indexed evidence against the current canvas" : "Checking saved source evidence against the current canvas" });
    const plan = await createFollowUpWithGroq(input.question, research.context, research.sources, input.currentLesson, groqOptions, { language: defaultLessonLanguage, sourceMaterials });
    send("decision", { coverage: plan.coverage, targetIds: plan.targetIds, title: plan.title });
    if (plan.coverage === "append") {
      send("status", { stage: "sketching", message: "Preparing a connected visual beside the lesson" });
      for (const [index, object] of plan.objects.entries()) {
        send("sketch", { index, total: plan.objects.length, id: object.id, label: object.label });
      }
    } else {
      send("status", { stage: "pointing", message: "The answer is already on the board—lining up the laser" });
    }
    send("followup", { plan });
  });
}
