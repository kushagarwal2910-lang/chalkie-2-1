import { TEACHER_PROMPT, schemaForTeaching, teachingPlanSchema, compileTeachingPlan, normalizeTeachingPlanForExisting } from './lesson-v2.ts';
import { attachLessonImages } from './image-library.ts';
import { applyElkLayout } from './elk-spatial-layout.ts';
import { groqFetch, GroqHttpError, type GroqCallOptions } from './groq-pool.ts';
import { ProviderResponseError } from './provider-response.ts';
import type { LessonPlan, FollowUpPlan, ResearchSource } from './lesson-schema.ts';
import { TEXT_MODEL } from './models.ts';
import { requireResearchEvidence } from './research-evidence.ts';
import { isStructuredOutputFailure } from './plan-retry.ts';
import { groundNarrationInImages } from './grounded-narration.ts';
import { layoutTeachingScene } from './teaching-layout.ts';
import { routeVisualIntent } from './visual-agent.ts';
import { denseGroundExistingImage } from './image-library.ts';
import { type ImageAnnotation, isValidCalloutLabel } from './visual-agent-schema.ts';
export { repairAndValidateLessonPlan } from './lesson-layout.ts';

import { attachPlot } from "./plot-lesson.ts";
import { generateScientificGraph } from "./graph-generator.ts";
import { normalizeLessonLanguage, getLessonLanguagePrompt, type LessonLanguageSettings } from "./lesson-language.ts";
import type { SourceMaterial } from "./source-materials.ts";
export type TeachingOptions = { language?: LessonLanguageSettings; sourceMaterials?: SourceMaterial[] };

export const GROQ_MODEL = TEXT_MODEL;

interface VisualDirective {
  action: "in_place_image_annotation" | "open_library_search" | "scientific_graph_plot" | "canvas_concept_focus";
  imageQuery?: string;
  regionsToLocate?: string[];
  targetImageId?: string;
  targetRegionIndex?: number;
  annotationLabel?: string;
  graphType?: "function-plot" | "wave-comparison" | "bar-chart" | "line-chart" | string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  seriesSpec?: string;
  instruction: string;
}

async function createPlan(
  question: string,
  context: string,
  sources: ResearchSource[],
  options: GroqCallOptions,
  existing?: LessonPlan,
  visualDirective?: VisualDirective,
  teaching: TeachingOptions = {}
) {
  requireResearchEvidence(context, sources);
  const inventory = existing?.objects.map(({ id, label, image }) => ({
    id,
    label,
    hasImage: Boolean(image),
    inspection: image?.description?.slice(0, 240),
    regions: image?.regions.map(r => r.label)
  }));
  let failure = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await groqFetch('/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.2,
          reasoning_effort: 'low',
          max_completion_tokens: attempt ? 4500 : 3600,
          response_format: { type: 'json_schema', json_schema: schemaForTeaching(Boolean(existing)) },
          messages: [
            { role: 'system', content: TEACHER_PROMPT + "\n" + getLessonLanguagePrompt(teaching.language) },
            {
              role: 'user',
              content: JSON.stringify({
                question,
                evidence: context,
                existing: inventory,
                previousSummary: existing?.summary,
                userFigures: teaching.sourceMaterials?.flatMap(m => m.images.map(i => ({title:i.title,source:m.title}))),
                visualDirective: visualDirective?.instruction,
                validationError: failure || undefined
              })
            }
          ],
        }),
      }, options);
    } catch (error) {
      if (!(error instanceof GroqHttpError) || !isStructuredOutputFailure(error.status, error.body)) throw error;
      let errorDetail = "";
      try {
        const parsedBody = JSON.parse(error.body);
        if (parsedBody?.error?.message) {
          errorDetail = ` Schema error: ${parsedBody.error.message}`;
        }
      } catch {}
      failure = `The previous JSON was invalid or incomplete.${errorDetail} Return a valid complete plan matching the schema, with rich, in-depth pedagogical narration.`;
      continue;
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    let plan;
    let lesson;
    try {
      const rawContent = body.choices?.[0]?.message?.content || '{}';
      plan = teachingPlanSchema.parse(JSON.parse(rawContent));

      // If Route B was requested, ensure coverage is append and an image node exists
      if (visualDirective?.action === "open_library_search" && visualDirective.imageQuery) {
        plan.coverage = "append";
        const hasImageNode = plan.nodes.some(n => n.kind === "image" && n.imageQuery);
        if (!hasImageNode) {
          const fallbackImageId = `follow-img-${Date.now().toString(36).slice(4)}`;
          plan.nodes.unshift({
            id: fallbackImageId,
            label: visualDirective.imageQuery,
            kind: "image",
            column: "full",
            imageQuery: visualDirective.imageQuery,
            regions: (visualDirective.regionsToLocate ?? []).slice(0, 8),
          });
          if (plan.steps.length > 0 && !plan.steps[0].targetIds.includes(fallbackImageId)) {
            plan.steps[0].targetIds.unshift(fallbackImageId);
          }
        }
      }

      // If Route D was requested, ensure coverage is append and a graph node exists
      if (visualDirective?.action === "scientific_graph_plot") {
        plan.coverage = "append";
        const graphNode = plan.nodes.find(n => n.kind === "graph" || n.kind === "plot" || (Boolean(n.seriesSpec) && (n.seriesSpec?.length ?? 0) > 0));
        if (graphNode) {
          graphNode.kind = "graph";
          if (!graphNode.graphType && visualDirective.graphType) graphNode.graphType = visualDirective.graphType;
          if (!graphNode.xAxisLabel && visualDirective.xAxisLabel) graphNode.xAxisLabel = visualDirective.xAxisLabel;
          if (!graphNode.yAxisLabel && visualDirective.yAxisLabel) graphNode.yAxisLabel = visualDirective.yAxisLabel;
          if (!graphNode.seriesSpec && visualDirective.seriesSpec) graphNode.seriesSpec = visualDirective.seriesSpec;
        } else {
          const fallbackGraphId = `follow-graph-${Date.now().toString(36).slice(4)}`;
          plan.nodes.unshift({
            id: fallbackGraphId,
            label: "Quantitative Graph Plot",
            kind: "graph",
            column: "full",
            imageQuery: "",
            regions: [],
            graphType: visualDirective.graphType || "line-chart",
            xAxisLabel: visualDirective.xAxisLabel || "x",
            yAxisLabel: visualDirective.yAxisLabel || "y",
            seriesSpec: visualDirective.seriesSpec || "",
          });
          if (plan.steps.length > 0 && !plan.steps[0].targetIds.includes(fallbackGraphId)) {
            plan.steps[0].targetIds.unshift(fallbackGraphId);
          }
        }
      }

      // If Route A was requested, ensure step 1 points to the annotated region
      if (visualDirective?.action === "in_place_image_annotation" && visualDirective.targetImageId) {
        const targetRef = visualDirective.targetRegionIndex !== undefined
          ? `${visualDirective.targetImageId}#${visualDirective.targetRegionIndex}`
          : visualDirective.targetImageId;
        if (plan.steps.length > 0 && !plan.steps[0].targetIds.some(t => t.startsWith(visualDirective!.targetImageId!))) {
          plan.steps[0].targetIds.unshift(targetRef);
        }
      }

      plan = normalizeTeachingPlanForExisting(plan, existing);
      lesson = compileTeachingPlan(plan, question, sources, existing);
      for (const object of lesson.objects) if (object.plot) attachPlot(object, sources.map(s => s.id));

      // Asynchronously enhance any scientific graph with Python Matplotlib if available
      for (const object of lesson.objects) {
        if (object.image?.provenance === "plot") {
          const correspondingNode = plan.nodes.find(n => n.id === object.id);
          try {
            const enhanced = await generateScientificGraph({
              title: object.label,
              graphType: correspondingNode?.graphType || "line-chart",
              xAxisLabel: correspondingNode?.xAxisLabel || "x",
              yAxisLabel: correspondingNode?.yAxisLabel || "y",
              seriesSpec: correspondingNode?.seriesSpec || "",
              series: correspondingNode?.plot?.series?.map(s => ({
                name: s.name,
                points: s.points,
                expression: correspondingNode?.plot?.expression,
              })),
              points: correspondingNode?.plot?.series?.[0]?.points,
            });
            if (enhanced?.dataUrl && object.image) {
              object.image.url = enhanced.dataUrl;
              object.image.width = enhanced.width;
              object.image.height = enhanced.height;
              if (enhanced.regions && enhanced.regions.length > 0) {
                object.image.regions = enhanced.regions;
              }
              object.annotations = []; // Matplotlib renders internal callouts; disable external margin arrows
              if (enhanced.plotMetadata) {
                object.plotMetadata = enhanced.plotMetadata;
                if (object.plot && object.plot.kind) {
                  object.plot = {
                    ...object.plot,
                    plotMetadata: enhanced.plotMetadata,
                    xMin: enhanced.plotMetadata.xMin,
                    xMax: enhanced.plotMetadata.xMax,
                    yMin: enhanced.plotMetadata.yMin,
                    yMax: enhanced.plotMetadata.yMax,
                    seriesSummary: enhanced.plotMetadata.seriesSummary,
                  } as any;
                }
              }
            }
          } catch {
            // Keep pure-TS SVG fallback
          }
        }
      }
    } catch (error) {
      failure = error instanceof Error ? error.message.slice(0, 500) : 'Invalid plan';
      continue;
    }
    // The compiler may namespace a model ID that collides with the old board.
    // Keep tool requests aligned with the compiled objects by declaration order.
    const imagePlan = { ...plan, nodes: plan.nodes.map((node, index) => {
      const matched = lesson.objects.find(o => o.id === node.id) ?? lesson.objects[index];
      return matched ? { ...node, id: matched.id } : node;
    }) };
    lesson.language = normalizeLessonLanguage(teaching.language ?? existing?.language);
    await attachLessonImages(lesson, imagePlan, options, teaching.sourceMaterials);
    try {
      await groundNarrationInImages(lesson, question, context, options, existing);
    } catch (groundErr) {
      console.warn("Could not ground narration cues, preserving compiled lesson narrations:", groundErr);
    }
    return { plan, lesson };
  }
  throw new ProviderResponseError('The teaching plan was incomplete. Please try again.');
}

function shouldUseElk(plan: LessonPlan): boolean {
  if (plan.teachingMode === "sequence") return true;
  if (plan.connections.length > 0) return true;
  if (plan.teachingMode === "concept" && plan.objects.length > 1) return true;
  return false;
}

export async function createLessonWithGroq(question: string, context: string, sources: ResearchSource[], options: GroqCallOptions = {}, teaching: TeachingOptions = {}): Promise<LessonPlan> {
  const { lesson } = await createPlan(question, context, sources, options, undefined, undefined, teaching);
  if (shouldUseElk(lesson)) {
    try {
      return await applyElkLayout(lesson);
    } catch {
      return layoutTeachingScene(lesson);
    }
  }
  return layoutTeachingScene(lesson);
}

export async function createFollowUpWithGroq(question: string, context: string, sources: ResearchSource[], currentLesson: LessonPlan, options: GroqCallOptions = {}, teaching: TeachingOptions = {}): Promise<FollowUpPlan> {
  let targetAnnotation: ImageAnnotation | null = null;
  let lessonWithAnnotation = currentLesson;
  let visualDirective: VisualDirective | undefined;

  try {
    const decision = await routeVisualIntent(question, currentLesson, context, options);
    if (decision.action === "in_place_image_annotation") {
      const targetObj = currentLesson.objects.find(o => o.id === decision.targetImageId)
        || currentLesson.objects.find(o => o.image);

      if (targetObj?.image) {
        const dense = await denseGroundExistingImage(targetObj.image, decision.targetFeatureQuery, options);
        const primaryRegion = dense.regions[0]
          ?? targetObj.image.regions.find(r => r.label.toLowerCase().includes(decision.targetFeatureQuery.toLowerCase()))
          ;
        if (!primaryRegion) throw new Error("The requested feature could not be located in this image");

        const safeCallout = (decision.calloutLabel && isValidCalloutLabel(decision.calloutLabel))
          ? decision.calloutLabel
          : (isValidCalloutLabel(primaryRegion.label) ? primaryRegion.label : "Key feature");

        targetAnnotation = {
          id: `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          targetImageId: targetObj.id,
          regionLabel: primaryRegion.label,
          normalized: {
            x: primaryRegion.x,
            y: primaryRegion.y,
            width: primaryRegion.width,
            height: primaryRegion.height,
          },
          color: decision.shadingColor,
          drawStyle: decision.drawStyle,
          calloutText: safeCallout,
        };

        const existingRegIdx = targetObj.image.regions.findIndex(r => r.label.toLowerCase() === primaryRegion.label.toLowerCase());
        const updatedRegions = existingRegIdx >= 0
          ? targetObj.image.regions
          : [...targetObj.image.regions, primaryRegion];
        const targetRegionIndex = existingRegIdx >= 0 ? existingRegIdx : updatedRegions.length - 1;

        const updatedObjects = currentLesson.objects.map(o =>
          o.id === targetObj.id ? {
            ...o,
            image: o.image ? { ...o.image, regions: updatedRegions } : o.image,
            annotations: [...(o.annotations ?? []), targetAnnotation!]
          } : o
        );
        lessonWithAnnotation = { ...currentLesson, objects: updatedObjects };

        visualDirective = {
          action: "in_place_image_annotation",
          targetImageId: targetObj.id,
          targetRegionIndex,
          annotationLabel: primaryRegion.label,
          instruction: `IN-PLACE ANNOTATION: We have visually pointed with a callout arrow to '${primaryRegion.label}' on existing image '${targetObj.label}' (target ID: '${targetObj.id}#${targetRegionIndex}'). Step 1 narration MUST explain this highlighted feature, with targetIds: ['${targetObj.id}#${targetRegionIndex}'].`
        };
      }
    } else if (decision.action === "open_library_search") {
      visualDirective = {
        action: "open_library_search",
        imageQuery: decision.imageQuery,
        regionsToLocate: decision.regionsToLocate,
        instruction: `MANDATORY VISUAL REFERENCE: The learner needs a new visual reference. Set coverage: 'append'. You MUST include at least one node with kind: 'image', label: '${decision.imageQuery}', imageQuery: '${decision.imageQuery}', and regions: ${JSON.stringify(decision.regionsToLocate || [])}. Step 1 narration MUST introduce this visual.`
      };
    } else if (decision.action === "scientific_graph_plot") {
      visualDirective = {
        action: "scientific_graph_plot",
        graphType: decision.graphType,
        xAxisLabel: decision.xAxisLabel,
        yAxisLabel: decision.yAxisLabel,
        seriesSpec: decision.seriesSpec,
        instruction: `MANDATORY SCIENTIFIC GRAPH: The learner requested a mathematical graph, chart, or curve plot. Set coverage: 'append'. You MUST include at least one node with kind: 'graph', label: '${("graphTitle" in decision ? String((decision as Record<string, unknown>).graphTitle) : "") || "Quantitative Graph"}', graphType: '${decision.graphType || "line-chart"}', xAxisLabel: '${decision.xAxisLabel || "x"}', yAxisLabel: '${decision.yAxisLabel || "y"}', and seriesSpec: '${decision.seriesSpec || ""}'. Step 1 narration MUST introduce and explain this mathematical curve.`
      };
    } else if (decision.action === "canvas_concept_focus") {
      visualDirective = {
        action: "canvas_concept_focus",
        instruction: `CANVAS CONCEPT FOCUS & SEQUENTIAL CAUSAL FLOWCHART:
The learner is referencing or asking about the existing diagram and graph on the board.
DO NOT generate duplicate or unrelated graphs.
Instead:
1. Append 2 to 4 kind: 'box' sequential flowchart cards detailing the cause-and-effect chain (e.g. 1. Perturbation/Boost -> 2. Energy Shift -> 3. Orbit Transition).
2. Connect these cards with directed causal links ('increases', 'stretches into', 'shifts').
3. Connect the first card to the existing visual anchor if applicable.
4. Set coverage: 'append'. Step narrations must pan attention between the existing visuals and these new sequential cards.`
      };
    }
  } catch {
    options.signal?.throwIfAborted();
  }

  const { lesson, plan } = await createPlan(question, context, sources, options, lessonWithAnnotation, visualDirective, teaching);
  const ids = new Set(lesson.objects.map(object => object.id));
  const internal = lesson.connections.filter(link => ids.has(link.from) && ids.has(link.to));
  const extension = { ...lesson, connections: internal };
  let laidOut: LessonPlan;
  if (extension.objects.length && shouldUseElk(extension)) {
    try {
      laidOut = await applyElkLayout(extension);
    } catch {
      laidOut = layoutTeachingScene(extension);
    }
  } else {
    laidOut = layoutTeachingScene(extension);
  }

  // If in-place image annotation was generated, ensure the annotated object is passed with its annotations
  const returnedObjects = laidOut.objects.map(obj => {
    if (targetAnnotation && obj.id === targetAnnotation.targetImageId) {
      return { ...obj, annotations: [...(obj.annotations ?? []), targetAnnotation] };
    }
    return obj;
  });

  if (targetAnnotation && !returnedObjects.some(o => o.id === targetAnnotation?.targetImageId)) {
    const origObj = lessonWithAnnotation.objects.find(o => o.id === targetAnnotation?.targetImageId);
    if (origObj) returnedObjects.push(origObj);
  }

  return {
    id: lesson.id,
    language: lesson.language,
    teachingMode: lesson.teachingMode,
    title: lesson.title,
    answer: (lesson.summary || lesson.segments[0]?.narration || "Follow-up explanation.").slice(0, 2400),
    coverage: plan.coverage,
    visualStrategy: lesson.visualStrategy,
    targetIds: [...new Set(lesson.segments.flatMap(s => s.targetIds))].slice(0, 8),
    objects: returnedObjects,
    connections: [...laidOut.connections, ...lesson.connections.filter(link => !internal.includes(link))],
    segments: lesson.segments,
    sources
  };
}
