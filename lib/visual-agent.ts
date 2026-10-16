import { groqFetch, type GroqCallOptions } from "./groq-pool.ts";
import { TEXT_MODEL } from "./models.ts";
import type { LessonPlan } from "./lesson-schema.ts";
import {
  visualAgentDecisionSchema,
  visualAgentDecisionJsonSchema,
  type VisualAgentDecision,
  isValidCalloutLabel,
} from "./visual-agent-schema.ts";

const AGENT_SYSTEM_PROMPT = `You are Chalkie's Visual Routing Agent. Chalkie is an AI whiteboard tutor that explains concepts VISUALLY using real diagrams, illustrations, and images. Always prioritize visual explanations over purely verbal text notes:

1. in_place_image_annotation (Route A):
   Select this if the learner's question asks for more detail, mechanism, sub-structure, or function of an entity or image ALREADY present on the canvas (e.g. retina in an eye, valves in a heart, pistons in an engine, nozzles in a rocket). The calloutLabel MUST be a concise 1-4 word anatomical/technical noun phrase (max 28 chars), NEVER conversational phrases like "Point to" or "Show me".

2. open_library_search (Route B):
   Select this whenever the question asks about a NEW physical, anatomical, biological, mechanical, astronomical, or structural entity not already shown on the board (e.g. nephron, chloroplast, transistor, telescope, tectonic plates), or asks for visual explanation ("show me", "visually", "picture", "diagram", "how does it look"). Provide 2-3 concise search keywords suited for diagram retrieval (e.g., "nephron diagram", "convex lens refraction") and list 3-6 key regions.

3. canvas_concept_focus (Route C):
   Select this ONLY if the question is purely abstract, philosophical, or mathematical where no physical diagram or anatomical/mechanical illustration exists, or when the requested regions are ALREADY grounded and annotated on the canvas.

Return valid JSON strictly matching the schema.`;

export async function routeVisualIntent(
  question: string,
  currentLesson: LessonPlan,
  context: string,
  options: GroqCallOptions = {}
): Promise<VisualAgentDecision> {
  const imagesOnBoard = currentLesson.objects
    .filter((o) => o.image || o.shapeType === "image")
    .map((o) => ({
      id: o.id,
      label: o.label,
      imageDescription: o.image?.description || o.label,
      knownRegions: o.image?.regions.map((r) => r.label) ?? [],
    }));

  const allObjects = currentLesson.objects.map((o) => ({
    id: o.id,
    label: o.label,
    role: o.role,
    shapeType: o.shapeType,
  }));

  const qLower = question.toLowerCase();

  // Check if the queried anatomical/mechanical regions are ALREADY present in targetImage.image.regions
  // or already annotated on the board (e.g. "Point to the cornea and lens again — which one bends light more?")
  const groundedRegionTargets: string[] = [];
  for (const img of imagesOnBoard) {
    const obj = currentLesson.objects.find((o) => o.id === img.id);
    if (!obj) continue;
    for (const r of (obj.image?.regions ?? [])) {
      const rLower = r.label.toLowerCase();
      if (rLower && qLower.includes(rLower)) {
        groundedRegionTargets.push(`${img.id}#${r.label}`);
      }
    }
    for (const ann of (obj.annotations ?? [])) {
      const aLower = ann.regionLabel.toLowerCase();
      if (aLower && qLower.includes(aLower)) {
        groundedRegionTargets.push(`${img.id}#${ann.regionLabel}`);
      }
    }
  }

  // If the queried regions are ALREADY grounded on the existing image, strictly force Route C (canvas_concept_focus)
  // targeting existing region anchors (e.g. imageId#cornea, imageId#lens) and emit ZERO new margin annotations.
  if (groundedRegionTargets.length > 0) {
    return {
      action: "canvas_concept_focus",
      rationale: "Queried regions are already grounded on the existing board image. Focusing laser on existing anchors without adding new margin annotations.",
      targetObjectIds: [...new Set(groundedRegionTargets)].slice(0, 4),
    };
  }

  const userPayload = {
    question,
    evidenceExcerpt: context.slice(0, 1000),
    boardImages: imagesOnBoard,
    boardObjects: allObjects,
  };

  try {
    const response = await groqFetch("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 0.1,
        max_completion_tokens: 500,
        response_format: { type: "json_schema", json_schema: visualAgentDecisionJsonSchema },
        messages: [
          { role: "system", content: AGENT_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    }, options);

    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = body.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(rawContent);

    // Normalize empty strings for discriminated union
    if (parsed.action === "in_place_image_annotation" && !parsed.targetImageId && imagesOnBoard[0]) {
      parsed.targetImageId = imagesOnBoard[0].id;
    }

    const result = visualAgentDecisionSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    // Heuristic fallback if schema parse fails
    if (imagesOnBoard.length > 0) {
      const matchedImage = imagesOnBoard.find(
        (img) => img.label.toLowerCase().includes(qLower) || img.knownRegions.some((r) => qLower.includes(r.toLowerCase()))
      );
      if (matchedImage) {
        const matchingRegion = matchedImage.knownRegions.find(r => qLower.includes(r.toLowerCase()));
        const cleanNoun = matchingRegion || matchedImage.label.replace(/diagram|illustration|photo|image|cross-section/gi, "").trim();
        const fallbackLabel = isValidCalloutLabel(cleanNoun) ? cleanNoun : (isValidCalloutLabel(matchedImage.knownRegions[0]) ? matchedImage.knownRegions[0] : "Key feature");
        return {
          action: "in_place_image_annotation",
          rationale: "Defaulted to in-place annotation for image on board",
          targetImageId: matchedImage.id,
          targetFeatureQuery: matchingRegion || cleanNoun || matchedImage.label,
          shadingColor: "amber",
          drawStyle: "callout_arrow",
          calloutLabel: fallbackLabel,
        };
      }
    }

    return {
      action: "open_library_search",
      rationale: "Search for visual reference matching question",
      imageQuery: question.slice(0, 80),
      regionsToLocate: [],
      teachingMode: "reference",
    };
  } catch {
    options.signal?.throwIfAborted();
    // Safe fallback: match existing image if relevant, else search library
    if (imagesOnBoard.length > 0) {
      const matchedImage = imagesOnBoard.find(
        (img) => img.label.toLowerCase().includes(qLower) || img.knownRegions.some((r) => qLower.includes(r.toLowerCase()))
      );
      if (matchedImage) {
        const matchingRegion = matchedImage.knownRegions.find(r => qLower.includes(r.toLowerCase()));
        const cleanNoun = matchingRegion || matchedImage.label.replace(/diagram|illustration|photo|image|cross-section/gi, "").trim();
        const fallbackLabel = isValidCalloutLabel(cleanNoun) ? cleanNoun : (isValidCalloutLabel(matchedImage.knownRegions[0]) ? matchedImage.knownRegions[0] : "Key feature");
        return {
          action: "in_place_image_annotation",
          rationale: "Fallback to existing image annotation",
          targetImageId: matchedImage.id,
          targetFeatureQuery: matchingRegion || cleanNoun || matchedImage.label,
          shadingColor: "amber",
          drawStyle: "callout_arrow",
          calloutLabel: fallbackLabel,
        };
      }
    }
    return {
      action: "open_library_search",
      rationale: "Fallback to open library search",
      imageQuery: question.slice(0, 80),
      regionsToLocate: [],
      teachingMode: "reference",
    };
  }
}
