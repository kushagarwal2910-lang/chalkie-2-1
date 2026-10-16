import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, teachingJsonSchema } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";
import { attachLessonImages } from "../lib/image-library.ts";
import { z } from "zod";
import { lessonPlanSchema, visualObjectSchema, teachingModes } from "../lib/lesson-schema.ts";
import { readableNarration } from "../lib/narration-labels.ts";

// Relaxed schema
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,56}$/);
const node = z.object({ id, label: z.string().min(1).max(120), kind: z.enum(["box", "ellipse", "text", "image"]), column: z.enum(["left", "right", "full"]).optional(), imageQuery: z.string().max(160), regions: z.array(z.string().min(1).max(80)).max(12) });
const link = z.object({ from: id, to: id, label: z.string().max(60) });
const step = z.object({ title: z.string().min(1).max(80), narration: z.string().min(1).max(900), targetIds: z.array(id).min(1).max(12) });
const relaxedPlanSchema = z.object({ title: z.string().min(1).max(120), summary: z.string().max(600), teachingMode: z.enum(teachingModes).optional(), nodes: z.array(node).max(12), links: z.array(link).max(18), steps: z.array(step).min(1).max(8), coverage: z.enum(["existing", "append"]) });

function relaxedCompile(raw: any, question: string, sources: any[]) {
  const plan = relaxedPlanSchema.parse(raw);
  const teachingMode = plan.teachingMode ?? (plan.nodes.some(n => n.kind === "image") ? "reference" : "concept");
  const anchor = teachingMode === "reference" ? plan.nodes.find(n => n.kind === "image")?.id : undefined;
  return lessonPlanSchema.extend({ objects: z.array(visualObjectSchema).max(12) }).parse({
    version: 2, teachingMode, id: `lesson-${Date.now()}`, title: plan.title, question, summary: plan.summary,
    diagramType: "structure", visualStrategy: plan.summary, sources,
    objects: plan.nodes.map((n, i) => ({ id: n.id, role: n.kind === "text" ? "annotation" : "component", shapeType: n.kind === "image" ? "image" : n.kind === "text" ? "note" : "geo", geo: n.kind === "ellipse" ? "ellipse" : "rectangle", label: n.label, labelPlacement: "inside", color: "violet", x: (i % 3) * 380, y: Math.floor(i / 3) * 300, width: n.kind === "image" ? 480 : 260, height: n.kind === "image" ? 330 : 130, parts: [] })),
    connections: plan.links.map((l, i) => ({ ...l, id: `link-${i}`, color: "slate", route: "elbow", fromAnchor: "right", toAnchor: "left", arrowhead: "arrow", bend: 0 })),
    segments: plan.steps.map((s, i) => ({ ...s, id: `step-${i}`, action: "reveal", durationMs: Math.max(2500, s.narration.length * 75) })),
  });
}

async function main() {
  const question = "explain human heart anatomy visually";
  const { sources, context } = await researchQuestion(question, "test-session", {});

  const modifiedSchema = JSON.parse(JSON.stringify(teachingJsonSchema));
  modifiedSchema.schema.properties.nodes.items.properties.regions.maxItems = 12;
  modifiedSchema.schema.properties.steps.items.properties.targetIds.maxItems = 12;

  console.log("Calling Groq with relaxed limits...");
  const response = await groqFetch('/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL, temperature: 0.2, reasoning_effort: 'low', max_completion_tokens: 3000,
      response_format: { type: 'json_schema', json_schema: modifiedSchema },
      messages: [
        { role: 'system', content: TEACHER_PROMPT },
        { role: 'user', content: JSON.stringify({ question, evidence: context }) }
      ],
    }),
  });
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content;
  console.log("SUCCESS! Got response length:", raw?.length);
  const parsedJson = JSON.parse(raw);

  const plan = relaxedPlanSchema.parse(parsedJson);
  const lesson = relaxedCompile(plan, question, sources);
  console.log("Compiled lesson. Teaching mode:", lesson.teachingMode);
  console.log("Image nodes requested:", plan.nodes.filter(n => n.kind === "image").map(n => ({ id: n.id, query: n.imageQuery, regions: n.regions })));

  console.log("Attaching images via attachLessonImages...");
  await attachLessonImages(lesson, plan as any, {});
  console.log("\nRESULT OF ATTACHING IMAGES:");
  for (const obj of lesson.objects) {
    console.log(`- [${obj.shapeType}] id="${obj.id}" label="${obj.label}" hasImage=${Boolean(obj.image)} status=${obj.imageRequest?.status}`);
    if (obj.image) {
      console.log(`     URL: ${obj.image.url}`);
      console.log(`     Title: ${obj.image.title}`);
      console.log(`     Regions (${obj.image.regions.length}):`, obj.image.regions.map(r => r.label));
    }
  }
}

main().catch(console.error);
