import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, schemaForTeaching } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";

async function main() {
  const question = "explain the human eye anatomy with a diagram visually";
  const { sources, context } = await researchQuestion(question, "test-session", {});

  const schema = schemaForTeaching(false);
  console.log("Schema nodes regions maxItems:", schema.schema.properties.nodes.items.properties.regions.maxItems);
  console.log("Schema steps targetIds maxItems:", schema.schema.properties.steps.items.properties.targetIds.maxItems);

  try {
    const res = await groqFetch('/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL, temperature: 0.2, reasoning_effort: 'low', max_completion_tokens: 3200,
        response_format: { type: 'json_schema', json_schema: schema },
        messages: [
          { role: 'system', content: TEACHER_PROMPT },
          { role: 'user', content: JSON.stringify({ question, evidence: context }) }
        ],
      }),
    });
    const data = await res.json();
    console.log("SUCCESS RESPONSE:\n", data.choices?.[0]?.message?.content);
  } catch (err) {
    console.error("GROQ ERROR:", err.status, err.body);
  }
}

main().catch(console.error);
