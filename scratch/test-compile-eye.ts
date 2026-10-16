import { compileTeachingPlan, teachingPlanSchema } from "../lib/lesson-v2.ts";
import { attachLessonImages } from "../lib/image-library.ts";
import { groundNarrationInImages } from "../lib/grounded-narration.ts";
import { readFileSync } from "node:fs";

async function main() {
  const log = readFileSync("C:/Users/agarw/.gemini/antigravity-ide/brain/7f490104-bc27-439d-b835-b9f9fe15774e/.system_generated/tasks/task-338.log", "utf8");
  const jsonStart = log.indexOf("{\n  \"title\":");
  const rawJson = log.slice(jsonStart);
  
  console.log("Parsing with teachingPlanSchema...");
  const plan = teachingPlanSchema.parse(JSON.parse(rawJson));
  console.log("teachingPlanSchema parsed!");
  
  console.log("Compiling with compileTeachingPlan...");
  const lesson = compileTeachingPlan(plan, "explain the human eye anatomy with a diagram visually", []);
  console.log("Compiled lesson! Mode:", lesson.teachingMode);

  console.log("Attaching images...");
  await attachLessonImages(lesson, plan, {});
  console.log("Image attached! Objects:", lesson.objects.map(o => ({ id: o.id, shapeType: o.shapeType, hasImage: !!o.image })));
  
  console.log("Grounding narration...");
  await groundNarrationInImages(lesson, "explain the human eye anatomy with a diagram visually", "evidence", {});
  console.log("Narrations grounded!");
  console.log("Done!");
}

main().catch(console.error);
