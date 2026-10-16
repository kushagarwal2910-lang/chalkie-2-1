import { mergeFollowUpLesson } from "../lib/follow-up.ts";

const currentLesson = {
  id: "initial-lesson",
  title: "Human Pancreas",
  question: "How does the human pancreas work?",
  summary: "Initial summary",
  diagramType: "structure",
  visualStrategy: "Diagram",
  sources: [],
  objects: [
    {
      id: "pancreas-anatomy",
      role: "subject",
      shapeType: "image",
      geo: "rectangle",
      label: "Pancreas structure",
      labelPlacement: "inside",
      color: "violet",
      x: 100,
      y: 100,
      width: 480,
      height: 330,
      parts: [],
      image: {
        id: "img-pancreas",
        title: "Pancreas",
        url: "https://upload.wikimedia.org/wikipedia/commons/1/11/Pancreas.jpg",
        sourceUrl: "https://commons.wikimedia.org",
        author: "Author",
        license: "CC BY",
        licenseUrl: "https://creativecommons.org",
        width: 800,
        height: 600,
        regions: []
      }
    }
  ],
  connections: [],
  segments: [
    {
      id: "step-0",
      title: "Pancreas",
      narration: "The pancreas is an organ...",
      targetIds: ["pancreas-anatomy"],
      action: "reveal",
      durationMs: 3000
    }
  ]
};

const followUpPlan = {
  id: "followup-1",
  title: "Islets of Langerhans",
  answer: "Islets contain beta cells that release insulin.",
  coverage: "append",
  teachingMode: "reference",
  visualStrategy: "Diagram",
  targetIds: ["islet-img#0"],
  objects: [
    {
      id: "islet-img",
      role: "component",
      shapeType: "image",
      geo: "rectangle",
      label: "Islet of Langerhans",
      labelPlacement: "inside",
      color: "violet",
      x: 0,
      y: 0,
      width: 480,
      height: 330,
      parts: [],
      image: {
        id: "img-islet",
        title: "Islet",
        url: "https://upload.wikimedia.org/wikipedia/commons/2/22/Islet.jpg",
        sourceUrl: "https://commons.wikimedia.org",
        author: "Author 2",
        license: "CC BY",
        licenseUrl: "https://creativecommons.org",
        width: 800,
        height: 600,
        regions: [
          { label: "beta cells", x: 0.2, y: 0.2, width: 0.4, height: 0.4, confidence: 0.95 }
        ]
      }
    },
    {
      id: "note-beta",
      role: "annotation",
      shapeType: "note",
      geo: "rectangle",
      label: "Beta cells secrete insulin",
      labelPlacement: "inside",
      color: "violet",
      x: 0,
      y: 350,
      width: 260,
      height: 120,
      parts: []
    }
  ],
  connections: [
    {
      id: "link-1",
      from: "pancreas-anatomy",
      to: "islet-img",
      label: "contains islets",
      color: "slate",
      route: "elbow",
      fromAnchor: "right",
      toAnchor: "left",
      arrowhead: "arrow",
      bend: 0
    }
  ],
  segments: [
    {
      id: "step-1",
      title: "Islet Visual",
      narration: "Look at the islet of Langerhans with beta cells.",
      targetIds: ["islet-img#0"],
      action: "reveal",
      durationMs: 3500
    }
  ]
};

const merged = mergeFollowUpLesson(currentLesson, followUpPlan);
console.log("StartIndex:", merged.startIndex);
console.log("NewObjectIds:", merged.newObjectIds);
console.log("Merged Objects:", merged.lesson.objects.map(o => ({
  id: o.id,
  shapeType: o.shapeType,
  hasImage: Boolean(o.image),
  imageTitle: o.image?.title,
  regions: o.image?.regions,
  x: o.x,
  y: o.y,
  width: o.width,
  height: o.height
})));
console.log("Merged Segments TargetIds:", merged.lesson.segments.map(s => ({
  id: s.id,
  title: s.title,
  targetIds: s.targetIds
})));
console.log("Merged Connections:", merged.lesson.connections);
