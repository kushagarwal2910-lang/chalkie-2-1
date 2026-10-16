import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, teachingJsonSchema } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";

async function main() {
  const question = "explain human heart anatomy visually";
  const { context } = await researchQuestion(question, "test-session", {});

  // Create schema with regions maxItems: 10
  const modifiedSchema = JSON.parse(JSON.stringify(teachingJsonSchema));
  modifiedSchema.schema.properties.nodes.items.properties.regions.maxItems = 10;

  console.log("Testing with regions maxItems = 10...");
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
  const parsed = JSON.parse(raw);
  console.log("Title:", parsed.title);
  console.log("Nodes:", parsed.nodes.map(n => ({ id: n.id, kind: n.kind, imageQuery: n.imageQuery, regionsCount: n.regions.length })));
}

main().catch(console.error);
