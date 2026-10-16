import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, teachingJsonSchema, teachingPlanSchema, compileTeachingPlan } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";
import { attachLessonImages } from "../lib/image-library.ts";
import { z } from "zod";

async function main() {
  const question = "explain human heart anatomy visually";
  const { sources, context } = await researchQuestion(question, "test-session", {});

  const modifiedSchema = JSON.parse(JSON.stringify(teachingJsonSchema));
  modifiedSchema.schema.properties.nodes.items.properties.regions.maxItems = 10;
  modifiedSchema.schema.properties.steps.items.properties.targetIds.maxItems = 12;

  console.log("Calling Groq with relaxed array limits (regions: 10, targetIds: 12)...");
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

  // Relax Zod schema to test parsing
  const id = z.string().regex(/^[a-zA-Z0-9_-]{1,56}$/);
  const node = z.object({ id, label: z.string().min(1).max(120), kind: z.enum(["box", "ellipse", "text", "image"]), column: z.enum(["left", "right", "full"]).optional(), imageQuery: z.string().max(160), regions: z.array(z.string().min(1).max(80)).max(12) });
  const link = z.object({ from: id, to: id, label: z.string().max(60) });
  const step = z.object({ title: z.string().min(1).max(80), narration: z.string().min(1).max(900), targetIds: z.array(id).min(1).max(12) });
  const relaxedPlanSchema = z.object({ title: z.string().min(1).max(120), summary: z.string().max(600), teachingMode: z.enum(["reference", "sequence", "comparison", "worked-example", "concept"]).optional(), nodes: z.array(node).max(12), links: z.array(link).max(18), steps: z.array(step).min(1).max(8), coverage: z.enum(["existing", "append"]) });

  const plan = relaxedPlanSchema.parse(parsedJson);
  console.log("Parsed Zod successfully!");
  
  const lesson = compileTeachingPlan(plan as any, question, sources);
  console.log("Compiled lesson successfully!");
  console.log("Lesson teaching mode:", lesson.teachingMode);
  console.log("Nodes count:", plan.nodes.length, "Image nodes:", plan.nodes.filter(n => n.kind === "image").map(n => ({ id: n.id, query: n.imageQuery, regions: n.regions })));

  console.log("Now attaching images via attachLessonImages...");
  await attachLessonImages(lesson, plan as any, {});
  console.log("Images attached successfully!");
  for (const obj of lesson.objects) {
    console.log(`Object ${obj.id}: shapeType=${obj.shapeType}, hasImage=${Boolean(obj.image)}, requestStatus=${obj.imageRequest?.status}`);
    if (obj.image) {
      console.log(`  -> URL: ${obj.image.url}`);
      console.log(`  -> Regions detected: ${obj.image.regions.length}`);
    }
  }
}

main().catch(console.error);
