import { z } from "zod";
import { lessonPlanSchema, visualObjectSchema, teachingModes, type LessonPlan, type ResearchSource } from "./lesson-schema.ts";
import { readableNarration } from "./narration-labels.ts";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,56}$/);
const node = z.object({ id, label: z.string().min(1).max(120), kind: z.enum(["box", "ellipse", "text", "image"]), column: z.enum(["left", "right", "full"]).optional(), imageQuery: z.string().max(160), regions: z.array(z.string().min(1).max(80)).max(12) });
const link = z.object({ from: id, to: id, label: z.string().max(60) });
const step = z.object({ title: z.string().min(1).max(80), narration: z.string().min(1).max(2000), targetIds: z.array(id).min(1).max(12) });
export const teachingPlanSchema = z.object({ title: z.string().min(1).max(120), summary: z.string().max(600), teachingMode: z.enum(teachingModes).optional(), nodes: z.array(node).max(12), links: z.array(link).max(18), steps: z.array(step).min(1).max(8), coverage: z.enum(["existing", "append"]) });
export type TeachingPlan = z.infer<typeof teachingPlanSchema>;
const str = { type: "string" };
const array = (items: object, maxItems: number) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const teachingJsonSchema = {
  name: "chalkie_teaching_plan_v2", strict: true,
  schema: object({ title: str, summary: str, teachingMode: { type: "string", enum: teachingModes }, coverage: { type: "string", enum: ["existing", "append"] },
    nodes: array(object({ id: str, label: str, kind: { type: "string", enum: ["box", "ellipse", "text", "image"] }, column: { type: "string", enum: ["left", "right", "full"] }, imageQuery: str, regions: array(str, 12) }), 12),
    links: array(object({ from: str, to: str, label: str }), 18),
    steps: array(object({ title: str, narration: str, targetIds: array(str, 12) }), 8),
  }),
};

export function schemaForTeaching(_followup?: boolean) {
  void _followup;
  return { ...teachingJsonSchema, schema: { ...teachingJsonSchema.schema, properties: { ...teachingJsonSchema.schema.properties,
    steps: { ...teachingJsonSchema.schema.properties.steps, minItems: 1, maxItems: 6 },
  } } };
}

export function compileTeachingPlan(raw: TeachingPlan, question: string, sources: ResearchSource[], existing?: LessonPlan): LessonPlan {
  const plan = teachingPlanSchema.parse(raw);
  if (existing) {
    if (plan.steps.length > 6) plan.steps = plan.steps.slice(0, 6);
    if (plan.coverage === "existing") {
      const existingIds = new Set(existing.objects.map(o => o.id));
      plan.nodes = plan.nodes.filter(n => !existingIds.has(n.id));
      if (plan.nodes.length || plan.links.length) {
        plan.coverage = "append";
      }
    }
  }
  if (!existing && !plan.nodes.length) throw new Error("A new lesson needs at least one visual");
  if (plan.coverage === "existing" && existing && (plan.nodes.length || plan.links.length)) throw new Error("Existing coverage cannot add objects");
  const incomingIds = new Set<string>();
  for (const n of plan.nodes) {
    if (incomingIds.has(n.id)) throw new Error(`Duplicate visual ID: ${n.id}`);
    incomingIds.add(n.id);
  }
  // A model sometimes reuses an old ID for a newly declared visual. Namespace
  // that declaration and its references rather than dropping the image or
  // overwriting the existing board. Ambiguous duplicates within one plan fail.
  const occupied = new Set([...(existing?.objects.map(o => o.id) ?? []), ...incomingIds]);
  const remapped = new Map<string, string>();
  for (const n of plan.nodes) if (existing?.objects.some(o => o.id === n.id)) {
    const base = `${n.id.slice(0, 40)}-detail`;
    let fresh = base, suffix = 2;
    while (occupied.has(fresh)) fresh = `${base}-${suffix++}`;
    occupied.add(fresh); remapped.set(n.id, fresh); n.id = fresh;
  }
  for (const s of plan.steps) s.targetIds = s.targetIds.map(id => remapped.get(id) ?? id);
  for (const l of plan.links) { l.from = remapped.get(l.from) ?? l.from; l.to = remapped.get(l.to) ?? l.to; }
  const ids = new Set(existing?.objects.map(o => o.id) ?? []);
  for (const n of plan.nodes) {
    if (ids.has(n.id)) throw new Error(`Duplicate visual ID: ${n.id}`);
    ids.add(n.id);
  }
  if (existing) {
    for (const s of plan.steps) {
      s.targetIds = s.targetIds.filter(target => ids.has(target.split("#")[0]));
      if (!s.targetIds.length) {
        const fallback = plan.nodes[0]?.id ?? existing?.objects[0]?.id;
        if (fallback) s.targetIds = [fallback];
      }
    }
    plan.links = plan.links.filter(l => ids.has(l.from) && ids.has(l.to));
  } else {
    for (const s of plan.steps) for (const target of s.targetIds) if (!ids.has(target.split("#")[0])) throw new Error(`Unknown target: ${target}`);
    for (const l of plan.links) if (!ids.has(l.from) || !ids.has(l.to)) throw new Error("Unknown connection endpoint");
  }
  for (const n of plan.nodes) {
    if (!plan.steps.some(s => s.targetIds.some(t => t.split("#")[0] === n.id))) {
      if (plan.steps[0]) plan.steps[0].targetIds.push(n.id);
    }
  }
  const teachingMode = plan.teachingMode ?? (plan.nodes.some(n => n.kind === "image") ? "reference" : "concept");
  // Keep the shared reference present while the teacher builds an explanation around it.
  const requestedTargets = new Set(plan.steps.flatMap(s => s.targetIds.map(t => t.split("#")[0])));
  const anchor = teachingMode === "reference" ? plan.nodes.find(n => n.kind === "image")?.id
    ?? existing?.objects.find(object => object.image && requestedTargets.has(object.id))?.id : undefined;
  return lessonPlanSchema.extend({ objects: z.array(visualObjectSchema).max(12) }).parse({
    version: 2, teachingMode, id: `lesson-${Date.now()}`, title: plan.title, question, summary: plan.summary,
    diagramType: teachingMode === "sequence" ? "process" : teachingMode === "comparison" ? "comparison" : teachingMode === "worked-example" ? "quantitative" : "structure", visualStrategy: plan.summary, sources,
    objects: plan.nodes.map((n, i) => ({ id: n.id, comparisonSide: teachingMode === "comparison" ? n.column ?? "full" : undefined, role: n.kind === "text" ? teachingMode === "concept" && i === 0 ? "subject" : "annotation" : "component", shapeType: n.kind === "image" ? "image" : n.kind === "text" ? "note" : "geo", geo: n.kind === "ellipse" ? "ellipse" : "rectangle", label: n.label, labelPlacement: "inside", color: "violet", x: (i % 3) * 380, y: Math.floor(i / 3) * 300, width: n.kind === "image" ? 480 : 260, height: n.kind === "image" ? 330 : 130, parts: [] })),
    connections: plan.links.map((l, i) => ({ ...l, id: `link-${i}`, color: "slate", route: "elbow", fromAnchor: "right", toAnchor: "left", arrowhead: "arrow", bend: 0 })),
    segments: plan.steps.map((s, i) => {
      const hasAnchor = Boolean(anchor && s.targetIds.some(t => t === anchor || t.startsWith(`${anchor}#`)));
      const targetIds = anchor && !hasAnchor ? [anchor, ...s.targetIds] : s.targetIds;
      return { ...s, targetIds, narration: readableNarration(s.narration, [...(existing?.objects ?? []), ...plan.nodes]), id: `step-${i}`, action: plan.coverage === "existing" ? "focus" : "reveal", durationMs: Math.max(2500, s.narration.length * 75) };
    }),
  });
}

export const TEACHER_PROMPT = `You are Chalkie, an extraordinary, patient human educator teaching in an offline classroom. Return the compact JSON schema only. Structure the lesson with natural human pedagogical clarity: plan the cognitive progression and stages before selecting visuals. The app handles coordinates and rendering.
Choose teachingMode to match the question:
- reference: teach from one or more real visual references, with short cards highlighting the specific mechanism or insight asked about. Introduce the primary reference in the FIRST step and build upon it. Do not create redundant cards for every part or repeat labels already legible in the image. No decorative links labelled "shows" or "next".
- sequence: a genuine chronological sequence, physical stages, causal chain, or flow. Use concise cards linked by meaningful actions. Arrows represent causal progression or stage transitions.
- comparison: compare alternatives side by side. Give each node column left for alternative A, right for B, or full for a shared overview. Pair observations in corresponding order on each side. Label which alternative each card describes. In all other teaching modes use column full.
- worked-example: work through the requested example using successive handwritten transformations. Explain the conceptual reason behind each move. Group an operation and its result in the same spoken step.
- concept: state the core idea clearly, followed by supporting insights or examples needed to truly grasp it. Use geometry or cards to represent distinct components and relationships.

DIAGRAM STRUCTURE & ELK.JS SPATIAL LAYOUT:
- Bounded Whiteboard Cards: Every node on the whiteboard represents a bounded card containing a clear, concise insight or stage (under 12 words), never raw floating text. Use kind: "box" for core stages, structures, and entities; use kind: "text" for explanatory notes and annotations.
- Layered Flow & Clean Routing: The layout engine (ELK.js) arranges nodes into hierarchical stages (left-to-right for processes, top-to-bottom for mathematical derivations) and routes obstacle-avoiding orthogonal connector arrows.
- Sparse, Purposeful Links: Keep diagram links intentional and direct (typically 1 to 2 connections per node, e.g. A -> B -> C or a central hub with clear branches). NEVER create a dense web where every node connects to every other node—dense cross-links clutter the board and cause arrows to bump into each other.
- Informative Link Labels: Give every link a concise action or relationship label (1 to 4 words, e.g. "activates", "converts to", "inhibits", "pumps blood to").

HUMAN-LIKE TEACHING & PLANNING METHODOLOGY (OFFLINE CLASSROOM MASTER PEDAGOGY):
- Teach like an exceptional master educator in an offline classroom:
  * ASSUME ZERO PRIOR KNOWLEDGE: Treat the learner as starting from zero baseline (like an eager, curious 10-year-old child learning this for the very first time), UNLESS the learner explicitly requests advanced/graduate-level treatment.
  * SYSTEMATIC COGNITIVE ASCENT: Your mission is to take the student from that intuitive baseline all the way to a mature, rigorous, comprehensive understanding. Anchor the idea first with intuitive first-principles intuition, then unpack all the underlying physical laws, biological structures, or logical mechanisms step-by-step.
  * DEEP, COMPREHENSIVE EXPLANATIONS: Provide genuine, rich depth—never superficial summaries, rushed one-liners, or shallow bullet points. Cover all essential definitions, physical/logical mechanisms, causes, and consequences. Explain *why* and *how* things happen, not just *that* they happen.
  * NATURAL SPOKEN FLOW (3-6 SUBSTANTIVE SENTENCES PER STEP): Each step must contain 3 to 6 comprehensive, engaging, spoken sentences (around 350 to 900 characters per step). Use warm, conversational authority, active verbs, and smooth narrative bridges ("Notice how...", "To grasp this clearly, let's understand...", "The critical physical mechanism at work here is...", "As a direct result...").
  * 110% PINPOINT VISUAL COORDINATION: Mention specific inspected visual regions, image parts, and flowchart stages by their EXACT names naturally in the narration as you discuss them. This allows the learner's eyes and the live laser pointer to follow along with 110% real-time accuracy.
  * Never narrate canvas mechanics ("look at this box", "the node", colors, shapes). Mention subjects naturally so the laser pointer can guide the learner's eyes. Never announce pictures or discuss image licenses.
- Divide explanations into as many logical stages or frames as the topic genuinely demands (1 to 5 steps). Never artificially compress complex multi-stage phenomena into fewer steps than needed, and never pad simple facts with fluff.
- Step titles must be vivid, descriptive micro-headlines naming the exact physical event or insight (e.g., "Stage 1: The Lift-Off & Max-Q", "Interstage Separation", "Entry Burn: Braking in Rarefied Air"), never generic labels like "Direct Answer" or "Step 1".

IMAGE & VISUAL GUIDANCE:
- Visual triggers: If the learner asks to explain visually ("visually", "show me", "diagram", "stages visually", "draw"), proactively include precise image nodes for the key entities or stages.
- Proactive visual reasoning: Even if the learner does NOT explicitly say "visually", evaluate the physical nature and intensity of the question. For physical, structural, mechanical, anatomical, astronomical, or spatial topics (rockets, engines, biology, anatomy, geographic formations, celestial bodies, machinery), proactively request relevant reference images to anchor the explanation visually. For purely abstract logic, syntax, or philosophy, rely primarily on concise text notes and diagrams.
- Image requests: imageQuery must be 2-4 core search keywords (e.g. "Falcon 9 booster landing legs", "rocket stage separation interstage", "human heart ventricles diagram"). You may request multiple distinct images (1-4 images) when different stages or entities need their own clear visual references. Regions lists up to eight visible parts relevant to this question. Never invent image URLs, SVG, or code.
- Non-image nodes use imageQuery:"" and regions:[]. Labels contain a short key phrase, formula, or causal insight (under 12 words), not a paragraph.
- DRAWING & ANNOTATING ON IMAGES: The system detects key inspected regions inside the image and points a clean callout arrow directly to each feature from the margins. Speak about the specific inspected region by its exact part name during narration so the live red laser pointer and callout arrow accurately guide the learner's eyes to that exact part of the image. Never draw shading boxes over the image.

FOLLOW-UP LESSONS:
- Plan follow-ups precisely according to the depth and scope of the question asked. If the learner asks for a multi-stage breakdown, detailed mechanism, or comprehensive explanation, plan across as many distinct stages/frames (2 to 5 steps) as required to thoroughly and clearly answer it.
- IMAGE DEMANDS & VISUAL QUESTIONS: If the learner asks for an image, diagram, picture, visual example, or to explain with an image (e.g. "with the image", "with an image", "image example", "show me", "diagram of", "visually", "picture of"), you MUST select coverage: append and include a new targeted kind: "image" node with an accurate imageQuery. NEVER reuse existing coverage or point back to a parent overview diagram when the user asks for an image or visual example.
- SUB-STRUCTURES & MECHANISMS: Even if the learner does NOT explicitly use the word "image", if the question is about a specific physical component, internal layer, anatomical structure (e.g. islets, beta cells, valves, nozzles, turbines, nephrons, organelles), or physical interaction not already given its own dedicated visual in the existing inventory, set coverage: append and request an image node to visually ground the explanation rather than relying purely on text notes.
- REUSING EXISTING BOARD: Use coverage: existing (empty nodes and links) ONLY for quick pointing questions that ask where an already-labeled region is located or brief clarifying questions that the existing board already fully answers without needing any new visual reference.
- In coverage: append mode, nodes must ONLY contain NEW entities being added (with non-empty imageQuery for image nodes). Do not re-declare or duplicate existing nodes inside nodes; reference existing IDs directly in links (from/to) and steps (targetIds). Links may connect new nodes to existing IDs. Do not repeat the original lesson verbatim; build forward from the current understanding.`;
