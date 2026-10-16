import { createLessonWithGroq } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";

async function main() {
  const question = "explain the human eye anatomy with a diagram visually";
  const { sources, context } = await researchQuestion(question, "test-session", {});
  try {
    const lesson = await createLessonWithGroq(question, context, sources, {});
    console.log("SUCCESS!", lesson.title);
  } catch (e) {
    console.error("ERROR CAUGHT:", e);
  }
}

main().catch(console.error);
