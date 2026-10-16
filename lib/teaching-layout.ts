import type { LessonPlan, VisualObject } from "./lesson-schema.ts";
import { routeOrthogonalConnector, wrapConnectorLabel } from "./connector-routing.ts";

export const boardFontSize = (object: VisualObject) => object.role === "subject" && object.shapeType === "note" ? 30 : 24;
export function boardTextLines(object: VisualObject) {
  // Share wrapping with the canvas, retaining explicit equation/paragraph breaks.
  // Ensure lines wrap cleanly at 28-32 characters (padded within object.width - 36).
  const availableWidth = Math.max(100, (object.width || 380) - 36);
  const maxLineChars = Math.max(28, Math.floor(availableWidth / 12));
  return object.label.split("\n").flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed) return [""];
    if (trimmed.length <= maxLineChars) return [trimmed];
    const words = trimmed.split(/\s+/);
    const wrapped: string[] = [];
    let cur = "";
    for (const w of words) {
      if (!cur) {
        cur = w;
      } else if ((cur + " " + w).length <= maxLineChars) {
        cur += " " + w;
      } else {
        wrapped.push(cur);
        cur = w;
      }
    }
    if (cur) wrapped.push(cur);
    return wrapped;
  });
}

function sizeImage(object: VisualObject, maxWidth: number, maxHeight: number) {
  if (!object.image) return;
  const scale = Math.min(maxWidth / object.image.width, maxHeight / object.image.height);
  object.width = object.image.width * scale;
  object.height = object.image.height * scale + 60;
}

/** Layout choices express teaching intent without asking a model for coordinates. */
export function layoutTeachingScene(raw: LessonPlan): LessonPlan {
  const plan = structuredClone(raw);
  const mode = plan.teachingMode ?? "concept";
  const images = plan.objects.filter(object => object.image);
  for (const object of plan.objects) {
    if (object.image) { sizeImage(object, mode === "reference" ? 640 : mode === "comparison" && object.comparisonSide === "full" ? 840 : 420, 440); continue; }
    if (mode === "reference" || mode === "worked-example" || mode === "comparison") object.shapeType = "note";
    const baselineWrapped = boardTextLines({ ...object, width: 380 });
    const maxChars = Math.max(...baselineWrapped.map(l => l.length), 0);
    const minDynamicWidth = Math.max(380, maxChars * 11 + 48);
    object.width = mode === "worked-example" ? 720 : mode === "comparison" ? object.comparisonSide === "left" || object.comparisonSide === "right" ? Math.max(400, minDynamicWidth) : 900 : mode === "reference" ? minDynamicWidth : Math.max(500, minDynamicWidth);
    if (object.shapeType === "note") object.height = Math.max(64, boardTextLines(object).length * boardFontSize(object) * 1.35 + 20);
  }
  if (images.length && mode !== "comparison") {
    let y = 112;
    for (const image of images) { image.x = 64; image.y = y; y += image.height + 48; }
    let noteY = 112;
    const noteX = 64 + Math.max(...images.map(image => image.width)) + 80;
    for (const note of plan.objects.filter(object => !object.image)) {
      note.x = noteX; note.y = noteY; noteY += note.height + 44;
    }
  } else if (mode === "comparison") {
    let y = 112;
    for (const object of plan.objects.filter(object => !object.comparisonSide || object.comparisonSide === "full")) {
      object.x = 64; object.y = y; y += object.height + 60;
    }
    const left = plan.objects.filter(object => object.comparisonSide === "left");
    const right = plan.objects.filter(object => object.comparisonSide === "right");
    const maxLeftWidth = left.length ? Math.max(...left.map(o => o.width)) : 400;
    const rightX = 64 + Math.max(400, maxLeftWidth) + 80;
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const pair = [left[index], right[index]].filter((object): object is VisualObject => !!object);
      pair.forEach(object => { object.x = object.comparisonSide === "left" ? 64 : rightX; object.y = y; });
      y += Math.max(...pair.map(object => object.height)) + 60;
    }
  } else {
    // Concepts and worked examples read like a small set of handwritten lines.
    let y = 112;
    for (const object of plan.objects) { object.x = 64; object.y = y; y += object.height + 56; }
  }
  const byId = new Map(plan.objects.map(object => [object.id, object]));
  plan.connections = plan.connections.map(connection => {
    const from = byId.get(connection.from), to = byId.get(connection.to);
    if (!from || !to) return connection;
    const dx = to.x + to.width / 2 - from.x - from.width / 2;
    const dy = to.y + to.height / 2 - from.y - from.height / 2;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const fromAnchor = horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top";
    const toAnchor = horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom";
    const port = (object: VisualObject, side: string) => ({ x: object.x + (side === "left" ? 0 : side === "right" ? object.width : object.width / 2), y: object.y + (side === "top" ? 0 : side === "bottom" ? object.height : object.height / 2) });
    return { ...connection, fromAnchor, toAnchor, points: routeOrthogonalConnector({ start: port(from, fromAnchor), end: port(to, toAnchor), startDirection: fromAnchor, endDirection: toAnchor, obstacles: plan.objects, startId: from.id, endId: to.id }) };
  });
  return plan;
}

/** A narration cue moves the pointer; only changing the teaching step moves the camera. */
export function teachingFrameIds(lesson: LessonPlan, targetIds: string[]) {
  const targets = new Set(targetIds.map(id => id.split("#")[0]));
  for (const connection of lesson.connections) if (targets.has(connection.id)) {
    targets.add(connection.from); targets.add(connection.to);
  }
  return targets;
}
