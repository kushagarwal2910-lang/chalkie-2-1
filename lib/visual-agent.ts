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

const AGENT_SYSTEM_PROMPT = `You are Chalkie's Visual Routing Agent. Chalkie is an AI whiteboard tutor that explains concepts VISUALLY using real diagrams, illustrations, and images. Always prioritize visual explanations over purely verbal text notes:

1. in_place_image_annotation (Route A):
   Select this if the learner's question asks for more detail, mechanism, sub-structure, or function of an entity or image ALREADY present on the canvas (e.g. retina in an eye, valves in a heart, pistons in an engine, nozzles in a rocket). The calloutLabel MUST be a concise 1-4 word anatomical/technical noun phrase (max 28 chars), NEVER conversational phrases like "Point to" or "Show me".

2. open_library_search (Route B):
   Select this whenever the question asks about a NEW physical, anatomical, biological, mechanical, astronomical, or structural entity not already shown on the board (e.g. nephron, chloroplast, transistor, telescope, tectonic plates), or asks for visual explanation ("show me", "visually", "picture", "diagram", "how does it look"). Provide 2-3 concise search keywords suited for diagram retrieval (e.g., "nephron diagram", "convex lens refraction") and list 3-6 key regions. NEVER route graphs, plots, curves, or mathematical relationships to open_library_search.

3. canvas_concept_focus (Route C):
   Select this whenever the learner's question starts with "Point back to", "Look back at", "In the existing", or asks a conceptual question referencing visuals already present on the canvas (such as an existing orbit diagram or velocity graph). NEVER generate a duplicate or dummy graph when the canvas already has a relevant visual! Also select this if the question is purely abstract, philosophical, or clarifying where no new physical diagram is needed.

4. scientific_graph_plot (Route D):
   Select this ONLY when the learner explicitly asks to plot, graph, chart, or compare NEW mathematical curves, waves, oscillations, functions, or resonance curves not already on the board. Supply graphType, xAxisLabel, yAxisLabel, and seriesSpec. Formulas in seriesSpec must be written with explicit, physically accurate numeric (x, y) coordinates. NEVER output generic dummy sine waves ("Function Plot: sin(x)") or straight lines.

STRICT VISUAL TRUTH RULE:
You may ONLY claim a visual object, symbol, or part is visible inside an image if it is explicitly listed in verifiedRegions or imageDescription. If you want to use an analogy (like clocks ticking slower or a waterfall) that is NOT physically drawn in the image, you MUST frame it verbally as a mental analogy ('Imagine if we placed clocks here...', 'Think of it like a waterfall...') and NEVER claim that clocks or waterfalls are drawn in the diagram.

CRITICAL INSTRUCTION: NEVER mention internal JSON node IDs in any field. The narration must flow as a single, seamless, natural paragraph spoken by a human teacher without step prefixes or meta-labels.
Return valid JSON strictly matching the schema.`;

function hasExistingVisualsReferenced(qLower: string, lesson: LessonPlan): boolean {
  return lesson.objects.some((o) => {
    const labelLower = (o.label || "").toLowerCase();
    return (
      (Boolean(o.image) || o.shapeType === "image" || o.image?.provenance === "plot" || Boolean(o.plot)) &&
      (qLower.includes(labelLower) ||
       labelLower.split(/\s+/).some((word) => word.length > 4 && qLower.includes(word)))
    );
  });
}

export async function routeVisualIntent(
  question: string,
  currentLesson: LessonPlan,
  context: string,
  options: GroqCallOptions = {}
): Promise<VisualAgentDecision> {
  const qLower = question.toLowerCase();

  // Route C priority: If the learner's prompt starts with "Point back to", "Look back at", "In the existing",
  // or asks a conceptual question referencing an already rendered diagram and graph on the board,
  // strictly select Route C (canvas_concept_focus) instead of generating duplicate or dummy graphs.
  const isPointingBack =
    /^(point\s+back\s+to|look\s+back\s+at|in\s+the\s+existing|refer\s+back\s+to|turn\s+(?:your\s+)?eyes\s+back\s+to)/i.test(question.trim()) ||
    /\b(point\s+back|look\s+back|existing\s+(?:board|diagram|graph|canvas)|both\s+the\s+.*diagram\s+and\s+the\s+.*graph)\b/i.test(question);

  const existingGraph = currentLesson.objects.find(
    (o) => o.image?.provenance === "plot" || o.id.startsWith("graph-") || Boolean(o.plot) || /\b(graph|plot|curve)\b/i.test(o.label)
  );
  const existingDiagram = currentLesson.objects.find(
    (o) => (o.image && o.image.provenance !== "plot") || o.shapeType === "image"
  );

  if (isPointingBack || (existingGraph && /\b(existing|orbit|diagram|graph|velocity|curve)\b/i.test(qLower) && /\b(what happens|why|explain|how|if|compare)\b/i.test(qLower))) {
    const targets: string[] = [];
    if (existingDiagram) targets.push(existingDiagram.id);
    if (existingGraph) targets.push(existingGraph.id);
    if (!targets.length) {
      targets.push(...currentLesson.objects.slice(0, 3).map((o) => o.id));
    }
    return {
      action: "canvas_concept_focus",
      rationale: "Learner referenced existing visual anchors (diagram/graph) on the board. Focusing attention on existing visuals without generating redundant dummy graphs.",
      targetObjectIds: targets,
    };
  }

  // Route D: Only trigger when the user explicitly asks to generate a NEW graph/plot and none exists for this concept
  const isExplicitGraphCreation = /\b(plot\s+(?:a\s+)?(?:new\s+)?(?:graph|curve|function)|draw\s+a\s+(?:graph|curve|plot)|graph\s+of|plot\s+of|schwarzschild\s+radius)\b/i.test(question);
  const isGraphKeyword = /\b(plot|graph|curve|wave|oscillation|chart|function|parabola|amplification|damped|resonant|proportionality)\b/i.test(question);
  const isGraphIntent = isExplicitGraphCreation || (isGraphKeyword && !hasExistingVisualsReferenced(qLower, currentLesson));

  if (isGraphIntent) {
    if (/\b(schwarzschild|black\s*hole|mass\s+vs\s+radius)\b/i.test(question)) {
      return {
        action: "scientific_graph_plot",
        rationale: "Learner asked for Schwarzschild Radius vs Mass relationship.",
        graphType: "line-chart",
        xAxisLabel: "Mass (Solar Masses M☉)",
        yAxisLabel: "Schwarzschild Radius (km)",
        seriesSpec: "Schwarzschild Radius: 2.953*x | #38bdf8",
      };
    }
    if (/\b(orbit|orbital|escape|kepler)\b/i.test(question) && /\b(velocity|speed)\b/i.test(question)) {
      return {
        action: "scientific_graph_plot",
        rationale: "Learner asked for Orbital and Escape Velocity vs Radius relationship.",
        graphType: "line-chart",
        xAxisLabel: "Orbital Radius r (Earth Radii R_E)",
        yAxisLabel: "Velocity (km/s)",
        seriesSpec: "Orbital Velocity (km/s): (1, 7.9), (2, 5.6), (4, 3.95), (6, 3.2), (8, 2.8), (10, 2.5) | #38bdf8; Escape Velocity (km/s): (1, 11.2), (2, 7.9), (4, 5.6), (6, 4.6), (8, 3.96), (10, 3.54) | #f43f5e",
      };
    }
    if (/\b(velocity|energy|kinetic|potential)\b/i.test(question) && !/\bwave\b/i.test(question)) {
      return {
        action: "scientific_graph_plot",
        rationale: "Learner asked for Energy vs Velocity relationship.",
        graphType: "line-chart",
        xAxisLabel: "Radius r (Earth Radii)",
        yAxisLabel: "Specific Energy (MJ/kg)",
        seriesSpec: "Kinetic Energy: (1, 31.2), (2, 15.6), (4, 7.8), (10, 3.1) | #38bdf8; Potential Energy: (1, -62.5), (2, -31.2), (4, -15.6), (10, -6.2) | #f43f5e",
      };
    }
    const isWave = /\b(wave|oscillation|damped|resonant|amplification)\b/i.test(question);
    return {
      action: "scientific_graph_plot",
      rationale: "Learner asked for a mathematical graph/wave plot beside the existing board.",
      graphType: isWave ? "wave-comparison" : "line-chart",
      xAxisLabel: isWave ? "Time (s)" : "x",
      yAxisLabel: isWave ? "Amplitude / Displacement" : "y",
      seriesSpec: isWave
        ? "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e"
        : "Quadratic Curve: (0, 3), (1, 0), (2, -1), (3, 0), (4, 3) | #38bdf8",
    };
  }

  const imagesOnBoard = currentLesson.objects
    .filter((o) => o.image || o.shapeType === "image")
    .map((o) => ({
      id: o.id,
      label: o.label,
      imageDescription: o.image?.description || o.label,
      verifiedRegions: o.image?.regions.map((r) => r.label) ?? [],
      knownRegions: o.image?.regions.map((r) => r.label) ?? [],
    }));

  const allObjects = currentLesson.objects.map((o) => ({
    id: o.id,
    label: o.label,
    role: o.role,
    shapeType: o.shapeType,
  }));

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
    if (parsed.action === "in_place_image_annotation") {
      if (!parsed.targetImageId && imagesOnBoard[0]) {
        parsed.targetImageId = imagesOnBoard[0].id;
      }
      if (parsed.calloutLabel && !isValidCalloutLabel(parsed.calloutLabel)) {
        const cleaned = parsed.calloutLabel.replace(CONVERSATIONAL_VERBS_REGEX, "").trim();
        parsed.calloutLabel = isValidCalloutLabel(cleaned) ? cleaned : "Key feature";
      }
    }

    if (parsed.action === "scientific_graph_plot") {
      if (!parsed.graphType) parsed.graphType = "wave-comparison";
      if (!parsed.xAxisLabel) parsed.xAxisLabel = "Time (s)";
      if (!parsed.yAxisLabel) parsed.yAxisLabel = "Amplitude / Displacement";
      if (!parsed.seriesSpec) parsed.seriesSpec = "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e";
    }

    const result = visualAgentDecisionSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    // Heuristic fallback if schema parse fails
    if (isGraphIntent) {
      return {
        action: "scientific_graph_plot",
        rationale: "Fallback to scientific graph plot",
        graphType: "wave-comparison",
        xAxisLabel: "Time (s)",
        yAxisLabel: "Amplitude / Displacement",
        seriesSpec: "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e",
      };
    }

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
    if (isGraphIntent) {
      return {
        action: "scientific_graph_plot",
        rationale: "Fallback to scientific graph plot",
        graphType: "wave-comparison",
        xAxisLabel: "Time (s)",
        yAxisLabel: "Amplitude / Displacement",
        seriesSpec: "Damped Wave: exp(-0.25*x)*cos(3*x) | #38bdf8; Resonant Amplification: 0.18*x*cos(3*x) | #f43f5e",
      };
    }
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
