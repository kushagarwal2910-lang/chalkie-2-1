import { createLessonWithGroq } from '../lib/groq.ts';
import { researchQuestion } from '../lib/research.ts';
import { TEACHER_PROMPT, schemaForTeaching, teachingPlanSchema, compileTeachingPlan } from '../lib/lesson-v2.ts';
import { groqFetch } from '../lib/groq-pool.ts';
import { GROQ_MODEL } from '../lib/groq.ts';
import { attachLessonImages } from '../lib/image-library.ts';

async function test() {
  const q = 'explain the human eye anatomy with a diagram visually';
  console.log('1. Starting research...');
  const { sources, context } = await researchQuestion(q, 'test-session', {});
  console.log('1. Research completed. Sources:', sources.length);

  console.log('2. Requesting plan from Groq...');
  const res = await groqFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      reasoning_effort: 'low',
      max_completion_tokens: 3000,
      response_format: { type: 'json_schema', json_schema: schemaForTeaching(false) },
      messages: [
        { role: 'system', content: TEACHER_PROMPT },
        { role: 'user', content: JSON.stringify({ question: q, evidence: context }) }
      ]
    })
  });
  console.log('2. Groq response status:', res.status);
  const data = await res.json() as any;
  const content = data.choices?.[0]?.message?.content;
  console.log('Raw content:', content);

  try {
    const parsed = JSON.parse(content);
    console.log('3. JSON.parse succeeded.');
    const plan = teachingPlanSchema.parse(parsed);
    console.log('4. teachingPlanSchema.parse succeeded!', plan.title);
    const lesson = compileTeachingPlan(plan, q, sources);
    console.log('5. compileTeachingPlan succeeded! Objects:', lesson.objects.length);
    console.log('6. Attaching lesson images (Qwen vision)...');
    await attachLessonImages(lesson, plan, {});
    console.log('7. attachLessonImages finished! Objects with images:', lesson.objects.filter(o => o.image).length);
    for (const o of lesson.objects) {
      if (o.image) {
        console.log(`Image object "${o.label}": regions count = ${o.image.regions?.length}`);
        console.log(`Regions:`, JSON.stringify(o.image.regions));
      }
    }
  } catch (err: any) {
    console.error('FAILED AT STEP:', err);
    if (err?.issues) console.error('Zod issues:', JSON.stringify(err.issues, null, 2));
  }
}

test().catch(console.error);
