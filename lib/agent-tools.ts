/**
 * lib/agent-tools.ts
 * Native TypeScript Agent Tool Registry for Chalkie 2.0.
 *
 * Implements a clean, zero-overhead, deterministic multi-tool agent architecture
 * backed by strict Zod schemas and groq-pool-core.
 *
 * Exposes 5 specialized tools:
 * 1. tool_retrieve_knowledge
 * 2. tool_source_and_ground_diagram
 * 3. tool_render_matplotlib_graph
 * 4. tool_build_formula_flowchart
 * 5. tool_align_grounded_narration
 */

import { z } from "zod";
import type { GroqCallOptions } from "./groq-pool.ts";
import type { LessonPlan, VisualObject, VisualConnection, ResearchSource, ImageAsset } from "./lesson-schema.ts";
import { researchQuestion } from "./research.ts";
import { type SourceMaterial } from "./source-materials.ts";
import { attachLessonImages } from "./image-library.ts";
import {
  generateScientificGraph,
  type ScientificPlotSpec,
  type ScientificGraphResult,
  type GraphRequestInput
} from "./graph-generator.ts";
import { formatCardMathForCanvas } from "./math-formatter.ts";
import { groundNarrationInImages } from "./grounded-narration.ts";
import { layoutTeachingScene } from "./teaching-layout.ts";
import { applyElkLayout } from "./elk-spatial-layout.ts";

// ============================================================================
// 1. Tool: tool_retrieve_knowledge
// ============================================================================

export const retrieveKnowledgeInputSchema = z.object({
  question: z.string().min(1).describe("The user's scientific, historical, or mechanical question"),
  sessionId: z.string().optional().describe("Optional session ID for caching research index"),
});
export type RetrieveKnowledgeInput = z.infer<typeof retrieveKnowledgeInputSchema>;

export interface RetrieveKnowledgeOutput {
  sources: ResearchSource[];
  context: string;
}

export async function executeRetrieveKnowledge(
  input: RetrieveKnowledgeInput,
  options: GroqCallOptions = {},
  sourceMaterials?: SourceMaterial[]
): Promise<RetrieveKnowledgeOutput> {
  const result = await researchQuestion(input.question, input.sessionId || "session-1", options, { sourceMaterials });
  return {
    sources: result.sources,
    context: result.context,
  };
}

// ============================================================================
// 2. Tool: tool_source_and_ground_diagram
// ============================================================================

export const sourceAndGroundDiagramInputSchema = z.object({
  imageQuery: z.string().min(2).max(120).describe("2-4 search keywords for Wikimedia Commons / Openverse diagrams"),
  regionsToLocate: z.array(z.string().min(1).max(80)).min(1).max(8).describe("Key visible anatomical or mechanical parts to ground"),
  visualIntent: z.enum(["canonical", "story", "analogy"]).default("canonical"),
});
export type SourceAndGroundDiagramInput = z.infer<typeof sourceAndGroundDiagramInputSchema>;

export async function executeSourceAndGroundDiagram(
  input: SourceAndGroundDiagramInput,
  options: GroqCallOptions = {}
): Promise<ImageAsset | null> {
  // Reject mathematical graphs, curves, or function plots
  const queryLower = input.imageQuery.toLowerCase();
  if (/\b(graph|plot|curve|wave|oscillation|function\s*plot|vs|versus)\b/i.test(queryLower)) {
    throw new Error(
      `Mathematical graphs, plots, and curves must be rendered through tool_render_matplotlib_graph, never retrieved from web image libraries.`
    );
  }

  const dummyPlan: any = {
    title: input.imageQuery,
    summary: input.imageQuery,
    nodes: [
      {
        id: "img-req",
        label: input.imageQuery,
        kind: "image",
        imageQuery: input.imageQuery,
        regions: input.regionsToLocate,
        visualIntent: input.visualIntent,
      },
    ],
    links: [],
    steps: [{ title: input.imageQuery, narration: input.imageQuery, targetIds: ["img-req"] }],
    coverage: "existing",
  };

  const dummyLesson: any = {
    version: 2,
    id: "tool-img",
    title: input.imageQuery,
    summary: input.imageQuery,
    teachingMode: "reference",
    objects: [
      {
        id: "img-req",
        label: input.imageQuery,
        shapeType: "image",
        x: 0,
        y: 0,
        width: 640,
        height: 440,
      },
    ],
    connections: [],
    segments: [{ id: "s1", title: input.imageQuery, narration: input.imageQuery, targetIds: ["img-req"] }],
  };

  const attached = await attachLessonImages(dummyLesson, dummyPlan, options);
  return attached.objects.find(o => o.id === "img-req")?.image ?? null;
}
export const searchAndGroundOpensourceImageInputSchema = sourceAndGroundDiagramInputSchema;
export type SearchAndGroundOpensourceImageInput = SourceAndGroundDiagramInput;
export const executeSearchAndGroundOpensourceImage = executeSourceAndGroundDiagram;
// ============================================================================
// 3. Tool: tool_render_matplotlib_graph
// ============================================================================

export const matplotlibToolInputSchema = z.object({
  title: z.string().min(1).max(160).describe("Descriptive title for the scientific plot"),
  subtitleFormula: z.string().optional().describe("Clean formula or mathematical relation rendered at top e.g. y = f(x)"),
  xAxisLabel: z.string().min(1).max(120).describe("Domain quantity with units if applicable e.g. Quantity Q (units), Time t (s), Input Size n"),
  yAxisLabel: z.string().min(1).max(120).describe("Domain quantity with units if applicable e.g. Price P ($), Rate V (μmol/min), Energy (J)"),
  xDomain: z.tuple([z.number(), z.number()]).describe("Range of x values [min, max]"),
  yDomain: z.tuple([z.number(), z.number()]).optional().describe("Optional range of y values [min, max]"),
  series: z.array(
    z.object({
      label: z.string().min(1).max(80).describe("High-signal descriptive domain name e.g. 'Demand', 'Supply', 'Reaction Rate' — NEVER 'Curve 1'"),
      color: z.string().optional().describe("Hex color e.g. #38bdf8 or #f43f5e"),
      formulaInX: z.string().optional().describe("Formula expression in x e.g. '100 - 0.9 * x'"),
      anchorPoints: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
          callout: z.string().optional(),
        })
      ).min(2).max(16).describe("Explicit calibrated (x, y) coordinates"),
    })
  ).min(1).max(5),
  referenceLines: z.array(
    z.object({
      axis: z.enum(["x", "y"]),
      value: z.number(),
      label: z.string(),
    })
  ).optional(),
});
export type MatplotlibToolInput = z.infer<typeof matplotlibToolInputSchema>;

export async function executeRenderMatplotlibGraph(
  input: MatplotlibToolInput
): Promise<ScientificGraphResult> {
  const parsed = matplotlibToolInputSchema.parse(input);
  return await generateScientificGraph(parsed as ScientificPlotSpec);
}

// ============================================================================
// 4. Tool: tool_build_formula_flowchart
// ============================================================================

export const formulaFlowchartCardSchema = z.object({
  id: z.string().optional(),
  headline: z.string().min(1).max(80).describe("Short headline e.g. 'Equilibrium Point', 'Base Case'"),
  formula: z.string().optional().describe("Mathematical equation or core rule in Unicode math"),
  takeawayBullets: z.array(z.string().max(90)).min(1).max(3).describe("1 to 3 punchy takeaways"),
});

export const formulaFlowchartInputSchema = z.object({
  title: z.string().optional(),
  cards: z.array(formulaFlowchartCardSchema).min(2).max(6).describe("2 to 6 sequential chalkboard cards"),
  links: z.array(
    z.object({
      fromIndex: z.number().int().min(0),
      toIndex: z.number().int().min(0),
      verb: z.string().min(1).max(60).describe("Causal verb badge e.g. 'balances', 'multiply by √2'"),
    })
  ).default([]),
});
export type FormulaFlowchartInput = z.infer<typeof formulaFlowchartInputSchema>;

export interface FormulaFlowchartOutput {
  objects: VisualObject[];
  connections: VisualConnection[];
}

export function executeBuildFormulaFlowchart(
  input: FormulaFlowchartInput,
  startIndex = 0
): FormulaFlowchartOutput {
  const parsed = formulaFlowchartInputSchema.parse(input);

  const objects: VisualObject[] = parsed.cards.map((card, idx) => {
    const cardId = card.id || `card-${startIndex + idx + 1}`;
    const lines: string[] = [];

    // Headline
    lines.push(card.headline);

    // Formatted formula
    if (card.formula) {
      lines.push(formatCardMathForCanvas(card.formula));
    }

    // Bullets
    for (const bullet of card.takeawayBullets) {
      const bulletPrefix = bullet.startsWith("•") || bullet.startsWith("-") ? "" : "• ";
      lines.push(formatCardMathForCanvas(`${bulletPrefix}${bullet}`));
    }

    const formattedLabel = lines.join("\n");

    return {
      id: cardId,
      label: formattedLabel,
      shapeType: "geo" as const,
      geo: "rectangle" as const,
      role: idx === 0 ? "subject" as const : "component" as const,
      labelPlacement: "inside" as const,
      color: "violet" as const,
      x: 0,
      y: 0,
      width: 380,
      height: Math.max(120, lines.length * 32 + 36),
      parts: [],
    };
  });

  const connections: VisualConnection[] = parsed.links.map((link, idx) => {
    const fromId = objects[link.fromIndex]?.id ?? objects[0]?.id;
    const toId = objects[link.toIndex]?.id ?? objects[Math.min(objects.length - 1, link.fromIndex + 1)]?.id;
    return {
      id: `flow-link-${startIndex + idx}`,
      from: fromId,
      to: toId,
      label: formatCardMathForCanvas(link.verb),
      color: "slate",
      route: "elbow",
      fromAnchor: "right",
      toAnchor: "left",
      arrowhead: "arrow",
      bend: 0,
    };
  });

  return { objects, connections };
}

// ============================================================================
// 5. Tool: tool_align_grounded_narration
// ============================================================================

export const alignGroundedNarrationInputSchema = z.object({
  question: z.string(),
  evidence: z.string(),
});
export type AlignGroundedNarrationInput = z.infer<typeof alignGroundedNarrationInputSchema>;

export async function executeAlignGroundedNarration(
  lesson: LessonPlan,
  input: AlignGroundedNarrationInput,
  options: GroqCallOptions = {},
  existing?: LessonPlan
): Promise<LessonPlan> {
  await groundNarrationInImages(lesson, input.question, input.evidence, options, existing);
  return lesson;
}

// ============================================================================
// Registry Map & Unified Execution Interface
// ============================================================================

export const AGENT_TOOLS = {
  tool_retrieve_knowledge: {
    name: "tool_retrieve_knowledge",
    description: "Fetches verified scientific domain passages and numerical constants/formulas from Tavily and user-uploaded sources.",
    schema: retrieveKnowledgeInputSchema,
    execute: executeRetrieveKnowledge,
  },
  tool_search_and_ground_opensource_image: {
    name: "tool_search_and_ground_opensource_image",
    description: "Searches Wikimedia Commons / Openverse with dual-query ranking and grounds regions using qwen/qwen3.8-27b thumbnail inspection.",
    schema: searchAndGroundOpensourceImageInputSchema,
    execute: executeSearchAndGroundOpensourceImage,
  },
  tool_source_and_ground_diagram: {
    name: "tool_source_and_ground_diagram",
    description: "Searches Wikimedia Commons / Openverse ONLY for real-world anatomy, hardware, astronomy, or physical structures (NEVER for mathematical graphs) and grounds up to 8 regions via VLM.",
    schema: sourceAndGroundDiagramInputSchema,
    execute: executeSourceAndGroundDiagram,
  },
  tool_render_matplotlib_graph: {
    name: "tool_render_matplotlib_graph",
    description: "Dedicated scientific plotting tool executed strictly via Python Matplotlib + NumPy. Takes explicit physical anchor points, LaTeX mathtext formula badges, and reference lines.",
    schema: matplotlibToolInputSchema,
    execute: executeRenderMatplotlibGraph,
  },
  tool_build_formula_flowchart: {
    name: "tool_build_formula_flowchart",
    description: "Constructs sequential formula and concept flowchart cards formatted with clean Unicode math symbols, connected by orthogonal causal arrows.",
    schema: formulaFlowchartInputSchema,
    execute: (input: FormulaFlowchartInput) => Promise.resolve(executeBuildFormulaFlowchart(input)),
  },
  tool_align_grounded_narration: {
    name: "tool_align_grounded_narration",
    description: "Generates synchronized spoken teacher narration and syllable-0 laser pointer cues mapped to rendered graph features, diagram regions, and formula cards.",
    schema: alignGroundedNarrationInputSchema,
    execute: (input: { lesson: LessonPlan } & AlignGroundedNarrationInput, options?: GroqCallOptions) =>
      executeAlignGroundedNarration(input.lesson, input, options),
  },
} as const;

export type AgentToolName = keyof typeof AGENT_TOOLS;

export async function executeAgentTool(
  toolName: AgentToolName,
  input: any,
  options?: GroqCallOptions
): Promise<any> {
  const tool = AGENT_TOOLS[toolName];
  if (!tool) {
    throw new Error(`Unknown agent tool: ${toolName}`);
  }
  return await (tool.execute as any)(input, options);
}
