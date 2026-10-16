import { TEACHER_PROMPT, schemaForTeaching, teachingPlanSchema, compileTeachingPlan } from './lesson-v2.ts';
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

export const GROQ_MODEL = TEXT_MODEL;

interface VisualDirective {
  action: "in_place_image_annotation" | "open_library_search";
  imageQuery?: string;
  regionsToLocate?: string[];
  targetImageId?: string;
  targetRegionIndex?: number;
  annotationLabel?: string;
  instruction: string;
}

async function createPlan(
  question: string,
  context: string,
  sources: ResearchSource[],
  options: GroqCallOptions,
  existing?: LessonPlan,
  visualDirective?: VisualDirective
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
            { role: 'system', content: TEACHER_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                question,
                evidence: context,
                existing: inventory,
                previousSummary: existing?.summary,
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
      plan = teachingPlanSchema.parse(JSON.parse(body.choices?.[0]?.message?.content || '{}'));

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

      // If Route A was requested, ensure step 1 points to the annotated region
      if (visualDirective?.action === "in_place_image_annotation" && visualDirective.targetImageId) {
        const targetRef = visualDirective.targetRegionIndex !== undefined
          ? `${visualDirective.targetImageId}#${visualDirective.targetRegionIndex}`
          : visualDirective.targetImageId;
        if (plan.steps.length > 0 && !plan.steps[0].targetIds.some(t => t.startsWith(visualDirective!.targetImageId!))) {
          plan.steps[0].targetIds.unshift(targetRef);
        }
      }

      lesson = compileTeachingPlan(plan, question, sources, existing);
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
    await attachLessonImages(lesson, imagePlan, options);
    await groundNarrationInImages(lesson, question, context, options, existing);
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

export async function createLessonWithGroq(question: string, context: string, sources: ResearchSource[], options: GroqCallOptions = {}): Promise<LessonPlan> {
  const { lesson } = await createPlan(question, context, sources, options);
  if (shouldUseElk(lesson)) {
    try {
      return await applyElkLayout(lesson);
    } catch {
      return layoutTeachingScene(lesson);
    }
  }
  return layoutTeachingScene(lesson);
}

export async function createFollowUpWithGroq(question: string, context: string, sources: ResearchSource[], currentLesson: LessonPlan, options: GroqCallOptions = {}): Promise<FollowUpPlan> {
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
          ?? {
            label: decision.calloutLabel || decision.targetFeatureQuery,
            x: 0.35, y: 0.35, width: 0.3, height: 0.3, confidence: 0.85
          };

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
    }
  } catch {
    options.signal?.throwIfAborted();
  }

  const { lesson, plan } = await createPlan(question, context, sources, options, lessonWithAnnotation, visualDirective);
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
    teachingMode: lesson.teachingMode,
    title: lesson.title,
    answer: lesson.summary || lesson.segments[0].narration,
    coverage: plan.coverage,
    visualStrategy: lesson.visualStrategy,
    targetIds: [...new Set(lesson.segments.flatMap(s => s.targetIds))].slice(0, 8),
    objects: returnedObjects,
    connections: [...laidOut.connections, ...lesson.connections.filter(link => !internal.includes(link))],
    segments: lesson.segments,
    sources
  };
}
