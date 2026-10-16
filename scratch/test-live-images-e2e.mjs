import { randomUUID } from "node:crypto";

async function testLesson() {
  console.log("=== Testing POST /api/lesson ===");
  const res = await fetch("http://localhost:3000/api/lesson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: "explain the human eye anatomy with a diagram visually",
      sessionId: randomUUID(),
      useWeb: true
    })
  });

  const text = await res.text();
  const events = text.split(/\r?\n\r?\n/)
    .filter(b => b.startsWith("event:"))
    .map(b => {
      const lines = b.split(/\r?\n/);
      const type = lines[0].slice(6).trim();
      const dataLine = lines.find(l => l.startsWith("data:"));
      const data = dataLine ? JSON.parse(dataLine.slice(5)) : null;
      return { type, data };
    });

  const lessonEvent = events.find(e => e.type === "lesson");
  if (!lessonEvent) {
    console.error("No lesson event! Events:", events);
    return;
  }

  const lesson = lessonEvent.data.lesson;
  console.log("Lesson title:", lesson.title);
  console.log("Teaching mode:", lesson.teachingMode);
  console.log("Objects count:", lesson.objects.length);
  for (const obj of lesson.objects) {
    console.log(`- Object ${obj.id}: label="${obj.label}", shapeType="${obj.shapeType}", hasImage=${Boolean(obj.image)}, imageRequest=${JSON.stringify(obj.imageRequest)}`);
    if (obj.image) {
      console.log(`   Image url: ${obj.image.url}, regions: ${obj.image.regions.length}`);
    }
  }

  // Now test follow-up requesting an image!
  console.log("\n=== Testing POST /api/follow-up ===");
  const followRes = await fetch("http://localhost:3000/api/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: "can you show me a detailed diagram of the retina with an image",
      sessionId: randomUUID(),
      currentLesson: lesson
    })
  });

  const followText = await followRes.text();
  const followEvents = followText.split(/\r?\n\r?\n/)
    .filter(b => b.startsWith("event:"))
    .map(b => {
      const lines = b.split(/\r?\n/);
      const type = lines[0].slice(6).trim();
      const dataLine = lines.find(l => l.startsWith("data:"));
      const data = dataLine ? JSON.parse(dataLine.slice(5)) : null;
      return { type, data };
    });

  const followPlan = followEvents.find(e => e.type === "followup")?.data?.plan;
  if (!followPlan) {
    console.error("No followup plan! Events:", followEvents);
    return;
  }

  console.log("Follow-up title:", followPlan.title);
  console.log("Coverage:", followPlan.coverage);
  console.log("Objects count:", followPlan.objects.length);
  for (const obj of followPlan.objects) {
    console.log(`- Follow Object ${obj.id}: label="${obj.label}", shapeType="${obj.shapeType}", hasImage=${Boolean(obj.image)}, imageRequest=${JSON.stringify(obj.imageRequest)}`);
    if (obj.image) {
      console.log(`   Image url: ${obj.image.url}, regions: ${obj.image.regions.length}`);
    }
  }
}

testLesson().catch(console.error);
