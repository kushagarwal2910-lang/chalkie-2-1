import { applyElkLayout } from '../lib/elk-spatial-layout.ts';
import { compileTeachingPlan } from '../lib/lesson-v2.ts';
import { boardTextLines, boardFontSize } from '../lib/teaching-layout.ts';

const plan = {
  title: "Test Whiteboard Rendering",
  summary: "Testing bounded cards and arrows",
  teachingMode: "concept",
  coverage: "append",
  nodes: [
    { id: "node-sun", label: "Sunlight warms water", kind: "ellipse", imageQuery: "", regions: [] },
    { id: "node-evap", label: "Evaporation transforms liquid into vapor", kind: "box", imageQuery: "", regions: [] },
    { id: "note-cond", label: "Condensation forms visible clouds in cooler altitudes", kind: "text", imageQuery: "", regions: [] },
  ],
  links: [
    { from: "node-sun", to: "node-evap", label: "heats surface" },
    { from: "node-evap", to: "note-cond", label: "rises and cools" },
  ],
  steps: [
    { title: "Step 1", narration: "Heat.", targetIds: ["node-sun"] },
    { title: "Step 2", narration: "Evap.", targetIds: ["node-evap"] },
    { title: "Step 3", narration: "Clouds.", targetIds: ["note-cond"] }
  ]
};

const lesson = compileTeachingPlan(plan, "How does water evaporate?", []);
const laid = await applyElkLayout(lesson);

console.log("=== VERIFYING OBJECT SHAPES & BOUNDS ===");
for (const o of laid.objects) {
  const isSubject = o.role === "subject";
  let renderedShape;
  if (o.shapeType === "note" || o.shapeType === "image") {
    renderedShape = {
      id: o.id,
      type: "rectangle",
      roundness: { type: 3 },
      strokeWidth: 1.5,
      strokeColor: isSubject ? "#a78bfa" : "#64748b",
      backgroundColor: isSubject ? "rgba(79, 70, 229, 0.22)" : "rgba(30, 41, 59, 0.55)",
      width: o.width,
      height: o.height,
      labelText: boardTextLines(o).join("\n"),
      fontSize: boardFontSize(o),
    };
  } else {
    renderedShape = {
      id: o.id,
      type: o.geo === "ellipse" ? "ellipse" : "rectangle",
      roundness: o.geo === "ellipse" ? null : { type: 3 },
      strokeColor: isSubject ? "#a78bfa" : "#38bdf8",
      backgroundColor: isSubject ? "rgba(79, 70, 229, 0.22)" : "rgba(14, 116, 144, 0.25)",
      width: o.width,
      height: o.height,
      labelText: o.label,
    };
  }
  console.log(JSON.stringify(renderedShape, null, 2));
}

console.log("\n=== VERIFYING CONNECTOR ARROWS ===");
for (const c of laid.connections) {
  const arrow = {
    id: c.id,
    type: "arrow",
    elbowed: true,
    roundness: null,
    startBinding: null,
    endBinding: null,
    points: c.points,
    label: c.label,
  };
  console.log(JSON.stringify(arrow, null, 2));
}
