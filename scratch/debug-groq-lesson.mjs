import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, schemaForTeaching, teachingPlanSchema, compileTeachingPlan } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";

async function main() {
  const question = "explain human heart anatomy visually";
  console.log("Researching...");
  const { sources, context } = await researchQuestion(question, "test-session", {});
  console.log("Calling Groq directly...");
  const response = await groqFetch('/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.2, reasoning_effort: 'low', max_completion_tokens: 3200,
      response_format: { type: 'json_schema', json_schema: schemaForTeaching(false) },
      messages: [{ role: 'system', content: TEACHER_PROMPT }, { role: 'user', content: JSON.stringify({ question, evidence: context }) }],
    }),
  });
  const body = await response.json();
  const rawJson = body.choices?.[0]?.message?.content;
  console.log("Raw JSON length:", rawJson?.length);
  console.log("Raw JSON:\n", rawJson);
  
  try {
    const plan = teachingPlanSchema.parse(JSON.parse(rawJson || '{}'));
    console.log("teachingPlanSchema parse: SUCCESS!");
    try {
      const lesson = compileTeachingPlan(plan, question, sources);
      console.log("compileTeachingPlan: SUCCESS!");
      console.log("Objects:", lesson.objects.map(o => ({ id: o.id, label: o.label, shapeType: o.shapeType, kind: plan.nodes.find(n => n.id === o.id)?.kind, imageQuery: plan.nodes.find(n => n.id === o.id)?.imageQuery })));
    } catch (compileErr) {
      console.error("compileTeachingPlan FAILED:", compileErr);
    }
  } catch (schemaErr) {
    console.error("teachingPlanSchema parse FAILED:", schemaErr);
  }
}

main().catch(console.error);
