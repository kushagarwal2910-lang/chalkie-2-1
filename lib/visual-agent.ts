import { groqFetch, type GroqCallOptions } from "./groq-pool.ts";
import { TEXT_MODEL } from "./models.ts";
import type { LessonPlan } from "./lesson-schema.ts";
import {
  visualAgentDecisionSchema,
  visualAgentDecisionJsonSchema,
  type VisualAgentDecision,
  isValidCalloutLabel,
  CONVERSATIONAL_VERBS_REGEX,
} from "./visual-agent-schema.ts";

export interface CompactCanvasDigest {
  existingCards: Array<{ id: string; label: string }>;
  existingImages: Array<{
    id: string;
    title: string;
    description?: string;
    groundedRegions: string[];
  }>;
}

/**
 * Ultra-Compact Canvas State Digest (~150-250 Tokens).
 * Summarizes current canvas in minimal tokens for LLM routing and sensing.
 */
export function buildCompactCanvasDigest(lesson: LessonPlan): CompactCanvasDigest {
  const existingCards = lesson.objects
    .filter((o) => o.shapeType !== "image" && !o.image)
    .map((o) => ({ id: o.id, label: o.label }));
  const existingImages = lesson.objects
    .filter((o) => o.shapeType === "image" || Boolean(o.image))
    .map((o) => ({
      id: o.id,
      title: o.label,
      description: o.image?.description || o.label,
      groundedRegions: o.image?.regions.map((r) => r.label) ?? [],
    }));
  return { existingCards, existingImages };
}

const AGENT_SYSTEM_PROMPT = `You are Chalkie's Visual Routing Agent. Chalkie is an AI whiteboard tutor that explains concepts VISUALLY using real diagrams, illustrations, and images. Always prioritize visual explanations over purely verbal text notes:

1. in_place_image_annotation (Route A):
   Select this if the learner's question asks for more detail, mechanism, sub-structure, or function of an entity or image ALREADY present on the canvas. The calloutLabel MUST be a concise 1-4 word technical noun phrase (max 28 chars), NEVER conversational phrases like "Point to" or "Show me".

2. open_library_search (Route B):
   Select this whenever the question asks about a NEW physical, anatomical, biological, mechanical, astronomical, or structural entity not already shown on the board, or asks for visual explanation ("show me", "visually", "picture", "diagram", "how does it look"). Provide 2-3 concise search keywords suited for diagram retrieval and list 3-6 key regions. NEVER route graphs, plots, curves, or purely conceptual/process topics to open_library_search.

3. canvas_concept_focus (Route C):
   Select this whenever the learner's question starts with "Point back to", "Look back at", "In the existing", or asks a conceptual question referencing visuals already present on the canvas. NEVER generate a duplicate or dummy graph when the canvas already has a relevant visual! Also select this if the question is purely abstract, philosophical, or clarifying where no new physical diagram is needed.

4. scientific_graph_plot (Route D):
   Select this ONLY when:
   a) The learner explicitly asks to plot, graph, chart, or compare mathematical curves, functions, or charts, OR
   b) The core concept is inherently a mathematical function, quantitative trade-off, rate curve, or statistical trend (e.g., calculus derivatives, supply & demand curves, activation functions, radioactive decay, stress-strain curves).
   DO NOT select this for anatomical, biological, historical, legal, software architecture, grammatical, philosophical, or qualitative process topics where graphs do not belong!
   Supply graphType ('curve' | 'line-chart' | 'bar-chart' | 'scatter'), xAxisLabel, yAxisLabel, and seriesSpec. Formulas in seriesSpec must use explicit numeric data points. NEVER output generic dummy sine waves or straight lines.

STRICT VISUAL TRUTH RULE:
You may ONLY claim a visual object, symbol, or part is visible inside an image if it is explicitly listed in verifiedRegions or imageDescription. If you want to use an analogy that is NOT physically drawn in the image, you MUST frame it verbally as a mental analogy ('Imagine if we placed...', 'Think of it like...') and NEVER claim that analogies are drawn in the diagram.

CRITICAL INSTRUCTION: NEVER mention internal JSON node IDs in any field. The narration must flow as a single, seamless, natural paragraph spoken by a human teacher without step prefixes or meta-labels.
Return valid JSON strictly matching the schema.`;

/**
 * Autonomous 3-Case Follow-Up Sensing Logic.
 * Evaluates the user's question against buildCompactCanvasDigest(currentLesson):
 * - CASE 1: Info & Regions Are ALREADY on the Canvas (Route C: canvas_concept_focus)
 * - CASE 2: The Structure Is Pictured Inside an Existing Canvas Image, But Not Grounded Yet (Route A: in_place_image_annotation)
 * - CASE 3: Info Is NOT on the Canvas Yet (Route B: open_library_search or Route D: scientific_graph_plot)
 */
export async function planVisualAgentFollowUp(
  question: string,
  currentLesson: LessonPlan,
  context: string = "",
  options: GroqCallOptions = {}
): Promise<VisualAgentDecision> {
  const digest = buildCompactCanvasDigest(currentLesson);
  const qLower = question.toLowerCase();

  // Explicit pointing back / reference to existing board
  const isPointingBack =
    /^(point\s+back\s+to|look\s+back\s+at|in\s+the\s+existing|refer\s+back\s+to|turn\s+(?:your\s+)?eyes\s+back\s+to)/i.test(question.trim()) ||
    /\b(point\s+back|look\s+back|existing\s+(?:board|diagram|graph|canvas)|both\s+the\s+.*diagram\s+and\s+the\s+.*graph)\b/i.test(question);

  if (isPointingBack) {
    const targets = digest.existingImages.map((img) => img.id).concat(digest.existingCards.map((c) => c.id)).slice(0, 3);
    return {
      action: "canvas_concept_focus",
      rationale: "Learner referenced existing visual anchors on the board. Focusing attention without generating redundant visuals.",
      targetObjectIds: targets.length > 0 ? targets : currentLesson.objects.slice(0, 3).map((o) => o.id),
    };
  }

  // Check matching grounded regions on existing images
  const matchedGroundedRegions: Array<{ imageId: string; region: string }> = [];
  for (const img of digest.existingImages) {
    for (const r of img.groundedRegions) {
      if (r && qLower.includes(r.toLowerCase())) {
        matchedGroundedRegions.push({ imageId: img.id, region: r });
      }
    }
  }

  // Check if user is asking to find/locate a specific ungrounded sub-part on an existing image
  const isLocateQuestion = /\b(where\s+is|where\s+are|locate|point\s+to|show\s+the|find\s+the)\b/i.test(qLower);

  // CASE 1: If question references already grounded regions and is NOT asking to locate an ungrounded part
  if (matchedGroundedRegions.length > 0 && !isLocateQuestion) {
    return {
      action: "canvas_concept_focus",
      rationale: "Queried structures are already grounded on the existing canvas image. Focusing camera and laser pointer without extra image search.",
      targetObjectIds: [...new Set(matchedGroundedRegions.map((m) => `${m.imageId}#${m.region}`))].slice(0, 4),
    };
  }

  // CASE 2: Structure is part of an existing diagram on board, but NOT yet in groundedRegions
  for (const img of digest.existingImages) {
    const imgTitleLower = img.title.toLowerCase();
    const cleanImgDomain = imgTitleLower.replace(/\b(diagram|illustration|photo|image|cross[- ]?section|human)\b/gi, "").trim();
    const explicitlyMentionsDiagram =
      /\b(this|the|existing)\s+([a-z\s]+)?(diagram|illustration|picture|image|drawing)\b/i.test(qLower) ||
      (cleanImgDomain.length >= 3 && qLower.includes(cleanImgDomain));

    if (explicitlyMentionsDiagram) {
      const candidateFeature = qLower
        .replace(/\b(where\s+is|where\s+are|locate|show|point\s+to|what\s+is|on\s+this|on\s+the|diagram|illustration|image|heart|eye|here|please)\b/gi, "")
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .trim();

      const notYetGrounded = !img.groundedRegions.some(
        (r) => r.toLowerCase() === candidateFeature || candidateFeature.includes(r.toLowerCase())
      );

      if (candidateFeature.length >= 3 && notYetGrounded) {
        const nounWords = candidateFeature.split(/\s+/).slice(0, 3).join(" ");
        const callout = nounWords.charAt(0).toUpperCase() + nounWords.slice(1);
        const validCallout = isValidCalloutLabel(callout) ? callout : "Key feature";
        return {
          action: "in_place_image_annotation",
          rationale: `Feature "${candidateFeature}" is part of existing "${img.title}" diagram but not yet grounded. Precision annotating existing image.`,
          targetImageId: img.id,
          targetFeatureQuery: candidateFeature,
          shadingColor: "amber",
          drawStyle: "callout_arrow",
          calloutLabel: validCallout,
        };
      }
    }
  }

  // CASE 3: Explicit New Visual Request (Graph Plot vs Diagram)
  const isExplicitGraphCreation = /\b(plot\s+(?:a\s+)?(?:new\s+)?(?:graph|curve|chart|function)|draw\s+a\s+(?:graph|curve|chart|plot)|graph\s+of|plot\s+of|chart\s+of)\b/i.test(question);
  const isQuantitativeTrend = /\b(mathematical\s+function|derivative|integral|decay\s+curve|supply\s+and\s+demand|stress\s*strain|titration\s+curve|reaction\s+rate\s+curve|time\s+complexity\s+curve)\b/i.test(question);
  if (isExplicitGraphCreation || isQuantitativeTrend) {
    return {
      action: "scientific_graph_plot",
      rationale: "Learner requested a scientific graph or quantitative curve plot.",
      graphType: "line-chart",
      xAxisLabel: "x",
      yAxisLabel: "y",
      seriesSpec: "",
    };
  }

  const isExplicitNewDiagram = /\b(show\s+me\s+a\s+diagram|show\s+a\s+diagram|picture\s+of|diagram\s+of|illustration\s+of|draw\s+a\s+diagram)\b/i.test(question);
  if (isExplicitNewDiagram) {
    const cleanImageQuery = question
      .replace(/\b(show\s+me\s+a\s+diagram\s+of|show\s+me\s+a\s+picture\s+of|diagram\s+of|picture\s+of|illustration\s+of|please)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      action: "open_library_search",
      rationale: `Learner requested a new visual reference for "${cleanImageQuery}" which is not on the board.`,
      imageQuery: (cleanImageQuery || question).slice(0, 80),
      regionsToLocate: [],
      teachingMode: "reference",
    };
  }

  // If question matches existing card concepts, prefer canvas_concept_focus
  const cardMatch = digest.existingCards.find((c) => qLower.includes(c.label.toLowerCase().slice(0, 20)));
  if (cardMatch) {
    return {
      action: "canvas_concept_focus",
      rationale: "Learner referenced concepts already shown on existing board cards.",
      targetObjectIds: [cardMatch.id],
    };
  }

  // Full LLM routing via Groq structured outputs with compact digest payload
  const userPayload = {
    question,
    evidenceExcerpt: context.slice(0, 800),
    canvasDigest: digest,
  };

  try {
    const response = await groqFetch("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 0.1,
        max_completion_tokens: 450,
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

    if (parsed.action === "in_place_image_annotation") {
      if (!parsed.targetImageId && digest.existingImages[0]) {
        parsed.targetImageId = digest.existingImages[0].id;
      }
      if (parsed.calloutLabel && !isValidCalloutLabel(parsed.calloutLabel)) {
        const cleaned = parsed.calloutLabel.replace(CONVERSATIONAL_VERBS_REGEX, "").trim();
        parsed.calloutLabel = isValidCalloutLabel(cleaned) ? cleaned : "Key feature";
      }
    }

    if (parsed.action === "scientific_graph_plot") {
      if (!parsed.graphType) parsed.graphType = "line-chart";
      if (!parsed.xAxisLabel) parsed.xAxisLabel = "x";
      if (!parsed.yAxisLabel) parsed.yAxisLabel = "y";
      if (!parsed.seriesSpec) parsed.seriesSpec = "";
    }

    const result = visualAgentDecisionSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    // Fallbacks
    if (digest.existingImages.length > 0) {
      const matchedImage = digest.existingImages.find(
        (img) => img.title.toLowerCase().includes(qLower) || img.groundedRegions.some((r) => qLower.includes(r.toLowerCase()))
      );
      if (matchedImage) {
        return {
          action: "canvas_concept_focus",
          rationale: "Fallback to existing image concept focus",
          targetObjectIds: [matchedImage.id],
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
    if (digest.existingImages.length > 0) {
      return {
        action: "canvas_concept_focus",
        rationale: "Fallback to existing canvas concept focus",
        targetObjectIds: [digest.existingImages[0].id],
      };
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

/** Legacy alias for backwards compatibility */
export const routeVisualIntent = planVisualAgentFollowUp;
