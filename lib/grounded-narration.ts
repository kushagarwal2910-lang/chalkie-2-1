import { z } from "zod";
import type { LessonPlan } from "./lesson-schema";
import { TEXT_MODEL } from "./models";
import { groqFetch, GroqHttpError, type GroqCallOptions } from "./groq-pool";
import { ProviderResponseError } from "./provider-response";
import { isStructuredOutputFailure } from "./plan-retry";
import { readableNarration } from "./narration-labels";

/** Final narration sees the selected image, not an imagined future reference. */
export async function groundNarrationInImages(lesson: LessonPlan, question: string, evidence: string, options: GroqCallOptions, existing?: LessonPlan) {
  const targets = new Set(lesson.segments.flatMap(segment => segment.targetIds.map(t => t.split("#")[0])));
  const objects = [...(existing?.objects ?? []), ...lesson.objects];
  const references = objects.filter(object => targets.has(object.id) && (object.image || object.imageRequest));
  if (!references.length) return;
  const count = lesson.segments.length;
  const schema = z.object({ narrations: z.array(z.string().trim().min(1).max(2000)).length(count) });
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await groqFetch("/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: TEXT_MODEL, reasoning_effort: "low", temperature: 0.1, max_completion_tokens: Math.min(4000, 1400 + count * 450 + attempt * 400),
          response_format: { type: "json_schema", json_schema: { name: "grounded_narrations", strict: true, schema: {
            type: "object", additionalProperties: false, required: ["narrations"], properties: { narrations: { type: "array", minItems: count, maxItems: count, items: { type: "string" } } },
          } } },
          messages: [
            { role: "system", content: `Write a master educator's spoken offline classroom lesson from the evidence and inspected images. Return exactly ${count} narrations in the original order.
PEDAGOGICAL STANDARD:
- Teach like an extraordinary master educator in an offline classroom: assume the learner starts with zero prior knowledge (treat them like an eager, curious 10-year-old child), and systematically elevate them all the way to a mature, rigorous, comprehensive understanding.
- Deep, thorough explanations: write 3 to 6 rich, substantive sentences per step (around 350 to 900 characters per step). Never give rushed, superficial summaries or shallow 1-2 sentence brush-offs. Provide clear foundational intuition, define essential terms, and explain the exact physical/biological/logical mechanisms, causes, and effects.
- For a follow-up, answer the new inquiry with the same classroom depth and thoroughness.
- Open directly with the core answer or insight, then unfold the mechanics. Never announce a picture or discuss image sourcing or licensing; credits are shown separately.
- Naturally mention the verified visual regions and flowchart concepts by their exact names as you teach them, so the student and the live laser pointer track along with 110% real-time accuracy.
- Never describe canvas mechanics, boxes, ellipses, colors or nodes; do not repeatedly say "look at".
- Ground facts strictly in supplied evidence. Claim a part is visible or highlighted ONLY if it is in verifiedRegions. Never infer an unlisted part is shown. With no verifiedRegions, explain the evidence-backed concept without pretending its internal parts are visible.
- Preserve the intended teaching progression.` },
            { role: "user", content: JSON.stringify({ question, teachingMode: lesson.teachingMode, followup: Boolean(existing), evidence, images: references.map(object => ({ label: object.label, available: Boolean(object.image), inspection: object.image?.description, verifiedRegions: [...(object.image?.regions.map(region => region.label) ?? []), ...(object.annotations?.map(ann => ann.regionLabel) ?? [])] })), steps: lesson.segments.map(segment => ({ title: segment.title, targets: segment.targetIds.map(id => objects.find(object => object.id === id)?.label) })) }) },
          ],
        }),
      }, options);
    } catch (error) {
      if (error instanceof GroqHttpError && isStructuredOutputFailure(error.status, error.body)) continue;
      throw error;
    }
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    try {
      const parsed = JSON.parse(body.choices?.[0]?.message?.content || "{}");
      const narrations = schema.safeParse(parsed).success ? parsed.narrations as string[] : Array.isArray(parsed?.narrations) ? (parsed.narrations as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
      if (narrations.length >= count) {
        lesson.segments.forEach((segment, index) => {
          segment.narration = readableNarration(narrations[index], objects);
          segment.durationMs = Math.max(2500, segment.narration.length * 75);
        });
        return;
      }
    } catch { options.signal?.throwIfAborted(); }
  }
  // If this is a follow-up or narration is already available, keep the teacher's narration.
  if (existing || lesson.segments.every(s => s.narration?.trim())) return;
  throw new ProviderResponseError("Image-grounded narration was incomplete.");
}
