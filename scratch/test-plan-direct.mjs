import { createLessonWithGroq } from "../lib/groq.ts";
import { researchQuestion } from "../lib/research.ts";

async function main() {
  const question = "explain human heart anatomy visually";
  console.log("Researching...");
  const { sources, context } = await researchQuestion(question, "test-session", {});
  console.log("Sources count:", sources.length);
  
  console.log("Calling createLessonWithGroq...");
  try {
    const lesson = await createLessonWithGroq(question, context, sources, {});
    console.log("SUCCESS! Lesson:", lesson.title, "mode:", lesson.teachingMode);
    console.log("Objects:", lesson.objects.map(o => ({ id: o.id, label: o.label, shapeType: o.shapeType, hasImage: !!o.image, imageRequest: o.imageRequest })));
  } catch (err) {
    console.error("FAILED createLessonWithGroq:", err);
  }
}

main().catch(console.error);
