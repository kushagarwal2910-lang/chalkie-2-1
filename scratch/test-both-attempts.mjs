import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, schemaForTeaching } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";

async function main() {
  const question = "explain human heart anatomy visually";
  const { context } = await researchQuestion(question, "test-session", {});
  for (let attempt = 0; attempt < 2; attempt++) {
    console.log(`\n--- ATTEMPT ${attempt} ---`);
    const validationError = attempt > 0 ? "The previous JSON was invalid or incomplete. Return a shorter complete plan matching the schema, with brief narration." : undefined;
    try {
      const response = await groqFetch('/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL, temperature: 0.2, reasoning_effort: 'low', max_completion_tokens: attempt ? 3200 : 2500,
          response_format: { type: 'json_schema', json_schema: schemaForTeaching(false) },
          messages: [
            { role: 'system', content: TEACHER_PROMPT },
            { role: 'user', content: JSON.stringify({ question, evidence: context, validationError }) }
          ],
        }),
      });
      const data = await response.json();
      console.log("Success on attempt", attempt, "JSON length:", data.choices?.[0]?.message?.content?.length);
    } catch (err) {
      console.error("Failed on attempt", attempt, ":", err.status, err.body?.slice(0, 300));
    }
  }
}

main().catch(console.error);
