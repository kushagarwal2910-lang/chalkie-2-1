import { z } from "zod";

/**
 * Pydantic-style Zod Schemas for Chalkie Visual Agent (CVA).
 * Defines strict runtime validation, field-level constraints, discriminated unions,
 * and JSON Schema conversion for Groq structured outputs.
 */

export const imageAnnotationColors = ["amber", "violet", "cyan", "yellow", "emerald"] as const;
export type ImageAnnotationColor = typeof imageAnnotationColors[number];

export const imageDrawStyles = ["shade", "contour", "callout_arrow", "full_annotation"] as const;
export type ImageDrawStyle = typeof imageDrawStyles[number];

export const normalizedRegionBoxSchema = z.object({
  x: z.number().finite().min(0).max(1).describe("Normalized X top-left origin (0.0 to 1.0)"),
  y: z.number().finite().min(0).max(1).describe("Normalized Y top-left origin (0.0 to 1.0)"),
  width: z.number().finite().min(0).max(1).describe("Normalized width (0.0 to 1.0)"),
  height: z.number().finite().min(0).max(1).describe("Normalized height (0.0 to 1.0)"),
});
export type NormalizedRegionBox = z.infer<typeof normalizedRegionBoxSchema>;

export const imageAnnotationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,56}$/).describe("Unique annotation slug"),
  targetImageId: z.string().describe("ID of the parent VisualObject holding the image"),
  regionLabel: z.string().min(1).max(80).describe("Anatomical or mechanical feature name"),
  normalized: normalizedRegionBoxSchema,
  color: z.enum(imageAnnotationColors).default("amber").describe("Chalk color used for tinting and outline"),
  drawStyle: z.enum(imageDrawStyles).default("full_annotation").describe("Excalidraw drawing technique"),
  calloutText: z.string().max(80).optional().describe("Short handwritten callout note beside the region"),
  stepIndex: z.number().optional().describe("Associated pedagogical narration step index"),
});
export type ImageAnnotation = z.infer<typeof imageAnnotationSchema>;

export const CONVERSATIONAL_VERBS_REGEX = /^(point(\s+to)?|now\s+draw|draw|show(\s+me)?|explain|where\s+is|look\s+at)\b/i;

export function isValidCalloutLabel(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 28) return false;
  if (CONVERSATIONAL_VERBS_REGEX.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 1 || wordCount > 4) return false;
  return true;
}

// Route A: In-place annotation on existing canvas image
export const inPlaceAnnotationPlanSchema = z.object({
  action: z.literal("in_place_image_annotation"),
  rationale: z.string().max(300).describe("Why this existing image answers the question"),
  targetImageId: z.string().max(60).describe("ID of the VisualObject containing the image on the canvas"),
  targetFeatureQuery: z.string().min(1).max(120).describe("Specific sub-component, valve, layer, or mechanism to locate"),
  shadingColor: z.enum(imageAnnotationColors).default("amber").describe("Chalk color used to tint and highlight"),
  drawStyle: z.enum(imageDrawStyles).default("full_annotation").describe("Excalidraw drawing primitive to render"),
  calloutLabel: z.string()
    .max(28)
    .refine(isValidCalloutLabel, {
      message: "Callout label must be a 1-to-4 word anatomical/technical noun phrase (max 28 chars) and must not start with conversational verbs",
    })
    .describe("Handwritten chalk callout note displayed beside the region (1-4 words, max 28 chars)"),
});
export type InPlaceAnnotationPlan = z.infer<typeof inPlaceAnnotationPlanSchema>;

// Route B: Search open library and append new image
export const openLibrarySearchPlanSchema = z.object({
  action: z.literal("open_library_search"),
  rationale: z.string().max(300).describe("Why a new image is needed to explain the topic"),
  imageQuery: z.string().min(3).max(120).describe("2-4 search keywords for Commons/Openverse (e.g. 'human nephron diagram')"),
  regionsToLocate: z.array(z.string().min(1).max(80)).min(1).max(8).describe("Anatomical or mechanical parts to locate"),
  teachingMode: z.enum(["reference", "sequence", "comparison", "worked-example", "concept"]).default("reference"),
});
export type OpenLibrarySearchPlan = z.infer<typeof openLibrarySearchPlanSchema>;

// Route C: Reusing existing board concept or laser focus
export const canvasConceptFocusPlanSchema = z.object({
  action: z.literal("canvas_concept_focus"),
  rationale: z.string().max(300).describe("Why existing board cards explain the doubt without new visuals"),
  targetObjectIds: z.array(z.string().max(60)).min(1).max(6).describe("IDs of existing objects to highlight"),
});
export type CanvasConceptFocusPlan = z.infer<typeof canvasConceptFocusPlanSchema>;

// Route D: Plot scientific graph/wave beside existing board
export const scientificGraphPlotPlanSchema = z.object({
  action: z.literal("scientific_graph_plot"),
  rationale: z.string().max(300).describe("Why a scientific graph or mathematical plot is required"),
  graphType: z.enum(["function-plot", "wave-comparison", "bar-chart", "line-chart", "curve", "scatter"]).default("line-chart"),
  xAxisLabel: z.string().max(80).default("x"),
  yAxisLabel: z.string().max(80).default("y"),
  seriesSpec: z.string().max(500).default(""),
});
export type ScientificGraphPlotPlan = z.infer<typeof scientificGraphPlotPlanSchema>;

// Unified Discriminated Union for Agent Decision
export const visualAgentDecisionSchema = z.discriminatedUnion("action", [
  inPlaceAnnotationPlanSchema,
  openLibrarySearchPlanSchema,
  canvasConceptFocusPlanSchema,
  scientificGraphPlotPlanSchema,
]);
export type VisualAgentDecision = z.infer<typeof visualAgentDecisionSchema>;

// Dense VLM Inspection Schema for qwen/qwen3.8-27b
export const denseRegionSchema = z.object({
  label: z.string().describe("Name of the located feature"),
  x: z.number().min(0).max(1).describe("Normalized X (0.0 to 1.0)"),
  y: z.number().min(0).max(1).describe("Normalized Y (0.0 to 1.0)"),
  width: z.number().min(0).max(1).describe("Normalized width (0.0 to 1.0)"),
  height: z.number().min(0).max(1).describe("Normalized height (0.0 to 1.0)"),
  confidence: z.number().min(0).max(1).describe("Detection confidence (0.0 to 1.0)"),
});
export type DenseRegion = z.infer<typeof denseRegionSchema>;

export const denseVLMInspectionSchema = z.object({
  suitable: z.boolean(),
  description: z.string().max(600),
  regions: z.array(denseRegionSchema).max(8),
});
export type DenseVLMInspection = z.infer<typeof denseVLMInspectionSchema>;

/** JSON Schema for Groq structured output with strict: true */
export const visualAgentDecisionJsonSchema = {
  name: "chalkie_visual_agent_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "action", "rationale", "targetImageId", "targetFeatureQuery",
      "shadingColor", "drawStyle", "calloutLabel", "imageQuery",
      "regionsToLocate", "teachingMode", "targetObjectIds",
      "graphType", "xAxisLabel", "yAxisLabel", "seriesSpec"
    ],
    properties: {
      action: {
        type: "string",
        enum: ["in_place_image_annotation", "open_library_search", "canvas_concept_focus", "scientific_graph_plot"],
        description: "The autonomous route selected by the visual agent",
      },
      rationale: { type: "string", description: "Pedagogical justification for this route" },
      targetImageId: { type: "string", description: "Target image ID for in_place_image_annotation (empty string if other route)" },
      targetFeatureQuery: { type: "string", description: "Feature/sub-component query for in_place_image_annotation (empty string if other route)" },
      shadingColor: { type: "string", enum: imageAnnotationColors, description: "Chalk shading color" },
      drawStyle: { type: "string", enum: imageDrawStyles, description: "Visual drawing primitive style" },
      calloutLabel: { type: "string", description: "Callout text badge (empty string if none)" },
      imageQuery: { type: "string", description: "Search query for open_library_search (empty string if other route)" },
      regionsToLocate: { type: "array", items: { type: "string" }, description: "Regions to locate for open_library_search" },
      teachingMode: { type: "string", enum: ["reference", "sequence", "comparison", "worked-example", "concept"] },
      targetObjectIds: { type: "array", items: { type: "string" }, description: "Target object IDs for canvas_concept_focus" },
      graphType: { type: "string", description: "Type of graph (e.g. wave-comparison, function-plot, bar-chart, line-chart; empty if other route)" },
      xAxisLabel: { type: "string", description: "Label for horizontal X axis (empty string if other route)" },
      yAxisLabel: { type: "string", description: "Label for vertical Y axis (empty string if other route)" },
      seriesSpec: { type: "string", description: "Mathematical DSL or preset for curves (empty string if other route)" },
    },
  },
};
