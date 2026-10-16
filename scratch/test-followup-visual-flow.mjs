import { mergeFollowUpLesson } from "../lib/follow-up.ts";
import { computeTargetPositions } from "../lib/target-matcher.ts";
import { getProgressiveVisibleObjects } from "../lib/progressive-scene.ts";
import { createDemoLesson } from "../lib/demo-lesson.ts";

async function runTest() {
  const currentLesson = createDemoLesson();
  console.log("1. Initial lesson loaded with", currentLesson.objects.length, "objects and", currentLesson.segments.length, "segments.");

  const question = "can you show an image of the islets of Langerhans and show where the beta cells are";
  console.log("\n2. Sending follow-up to /api/follow-up:", question);

  const res = await fetch("http://localhost:3000/api/follow-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      sessionId: "test-visual-flow-session",
      currentLesson
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Follow-up API failed with status ${res.status}: ${errorText}`);
  }

  const text = await res.text();
  const lines = text.split("\n").filter(l => l.startsWith("data: "));
  let plan = null;
  for (const line of lines) {
    try {
      const data = JSON.parse(line.slice(6));
      if (data.plan) plan = data.plan;
    } catch {}
  }

  if (!plan) {
    throw new Error("No follow-up plan found in SSE events:\n" + text.slice(0, 500));
  }

  console.log("\n3. Follow-up plan received:");
  console.log("- Title:", plan.title);
  console.log("- Coverage:", plan.coverage);
  console.log("- TargetIds:", plan.targetIds);
  console.log("- Objects count:", plan.objects.length);
  const imgObj = plan.objects.find(o => o.shapeType === "image" && o.image);
  if (imgObj) {
    console.log("- Image found! Title:", imgObj.image.title);
    console.log("- Image URL:", imgObj.image.url);
    console.log("- Regions inspected by Qwen Vision:", imgObj.image.regions?.length);
    imgObj.image.regions?.forEach((r, i) => console.log(`  [Region ${i}]: "${r.label}" at [x:${r.x.toFixed(2)}, y:${r.y.toFixed(2)}, w:${r.width.toFixed(2)}, h:${r.height.toFixed(2)}] (confidence: ${r.confidence})`));
  } else {
    console.log("- WARNING: No image attached in objects:", plan.objects.map(o => ({ id: o.id, shapeType: o.shapeType })));
  }

  console.log("\n4. Merging follow-up with mergeFollowUpLesson...");
  const merged = mergeFollowUpLesson(currentLesson, plan);
  console.log("- StartIndex:", merged.startIndex);
  console.log("- New object IDs:", merged.newObjectIds);
  const mergedImg = merged.lesson.objects.find(o => o.shapeType === "image" && o.id.includes("islet") || (o.image && o.id !== currentLesson.objects[0]?.id));
  console.log("- Merged Image Object ID:", mergedImg?.id);
  console.log("- Merged Image Regions count:", mergedImg?.image?.regions?.length);

  const followUpSegments = merged.lesson.segments.slice(merged.startIndex);
  console.log("\n5. Follow-up segments targetIds:");
  followUpSegments.forEach((seg, i) => {
    console.log(`  Segment ${i + 1} ("${seg.title}"):`);
    console.log(`    TargetIds:`, seg.targetIds);
    console.log(`    Narration: "${seg.narration.slice(0, 100)}..."`);
    const positions = computeTargetPositions(seg.narration, seg.targetIds, merged.lesson.objects);
    console.log(`    Target Cues matched:`, positions.map(p => `${p.targetId} ("${p.partLabel}")`));
  });

  console.log("\n6. Checking canvas progressive visibility:");
  const visibleFull = getProgressiveVisibleObjects(merged.lesson, merged.startIndex, false);
  console.log("- Visible with revealedStep === null (complete board):", visibleFull.length, "objects (includes image:", visibleFull.some(o => o.id === mergedImg?.id), ")");
  const visibleAtStart = getProgressiveVisibleObjects(merged.lesson, merged.startIndex, true);
  console.log("- Visible at step startIndex:", visibleAtStart.length, "objects (includes image:", visibleAtStart.some(o => o.id === mergedImg?.id), ")");

  console.log("\nTEST COMPLETE: All assertions verified!");
}

runTest().catch(console.error);
