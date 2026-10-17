import type { LessonPlan, VisualObject, VisualConnection } from "./lesson-schema.ts";
import { routeOrthogonalConnector } from "./connector-routing.ts";
import { formatCardMathForCanvas } from "./math-formatter.ts";

export const boardFontSize = (_object: VisualObject) => 20;

/** Wraps card text labels cleanly at 24-26 characters per line */
export function wrapCardLabel(label: string, maxLineChars = 25): string[] {
  return (label || "").split("\n").flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed) return [""];
    if (trimmed.length <= maxLineChars) return [trimmed];
    // CJK and long compounds have no whitespace; wrap on grapheme boundaries
    // rather than stretching a card or splitting an Indic combining sequence.
    const words = trimmed.split(/\s+/).flatMap(word => {
      if (word.length <= maxLineChars) return [word];
      const glyphs = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(word)].map(s => s.segment);
      const chunks: string[] = [];
      const limit = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word) ? Math.max(10, Math.floor(maxLineChars / 2)) : maxLineChars;
      for (let start = 0; start < glyphs.length; start += limit) chunks.push(glyphs.slice(start, start + limit).join(""));
      return chunks;
    });
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

export function boardTextLines(object: VisualObject) {
  // Retain explicit equation/paragraph breaks and wrap cleanly at 24-26 characters.
  // Convert any raw LaTeX formulas to clean Unicode math symbols (√, ², ³, ≈, →, ×, Δ, π, θ).
  // Strip markdown ** asterisks so headlines render cleanly on the board.
  const formatted = formatCardMathForCanvas(object.label || "");
  const clean = formatted.replace(/\*\*([^*]+)\*\*/g, "$1");
  return wrapCardLabel(clean, 25);
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

  // 1. Calculate dynamic card footprint based on wrapped text lines
  for (const object of plan.objects) {
    if (object.image) {
      sizeImage(object, mode === "reference" ? 640 : mode === "comparison" && object.comparisonSide === "full" ? 840 : 420, 440);
      continue;
    }
    if (mode === "reference" || mode === "worked-example" || mode === "comparison" || mode === "sequence") {
      object.shapeType = "note";
    }
    const baselineWrapped = boardTextLines({ ...object, width: 380 });
    const longestLine = Math.max(...baselineWrapped.map(l => l.length), 0);
    const minDynamicWidth = Math.max(380, longestLine * 14 + 64);
    const minDynamicHeight = Math.max(110, baselineWrapped.length * 34 + 48);
    object.width = mode === "worked-example" ? Math.max(720, minDynamicWidth)
      : mode === "comparison"
      ? (object.comparisonSide === "left" || object.comparisonSide === "right" ? Math.max(400, minDynamicWidth) : Math.max(900, minDynamicWidth))
      : minDynamicWidth;
    object.height = minDynamicHeight;
  }

  // 2. Spatial Zoning & Flowcard Layout
  const nonImageNotes = plan.objects.filter(object => !object.image);

  if (images.length && mode !== "comparison") {
    // Primary visual anchor (Hero Image or Matplotlib Graph) occupies focus zone (x: 64, y: 112)
    let heroY = 112;
    for (const image of images) {
      image.x = 64;
      image.y = heroY;
      heroY += image.height + 48;
    }
    const heroWidth = Math.max(...images.map(image => image.width));
    const heroHeight = Math.max(...images.map(image => image.height));
    const rightCol1X = 64 + heroWidth + 80;

    if (nonImageNotes.length <= 3) {
      // 1 to 3 cards: stack cleanly in right column beside the hero image
      let noteY = 112;
      for (const note of nonImageNotes) {
        note.x = rightCol1X;
        note.y = noteY;
        noteY += note.height + 44;
      }
    } else {
      // 4 to 6 cards: Intelligent Spatial Flowmap branching to the right AND below
      // Tier 1 (Right Col 1): Notes 0 and 1
      const note0 = nonImageNotes[0];
      const note1 = nonImageNotes[1];
      if (note0) { note0.x = rightCol1X; note0.y = 112; }
      if (note1) { note1.x = rightCol1X; note1.y = 112 + (note0 ? note0.height + 44 : 0); }

      // Tier 2 (Right Col 2): Notes 2 and 3 branching further right
      const maxCol1Width = Math.max(note0?.width ?? 380, note1?.width ?? 380);
      const rightCol2X = rightCol1X + maxCol1Width + 64;
      const note2 = nonImageNotes[2];
      const note3 = nonImageNotes[3];
      if (note2) { note2.x = rightCol2X; note2.y = 112; }
      if (note3) { note3.y = 112 + (note2 ? note2.height + 44 : 0); note3.x = rightCol2X; }

      // Below Tier: Notes 4 and 5 branching below the hero column
      let belowX = 64;
      const belowY = heroY + 24;
      for (let k = 4; k < nonImageNotes.length; k++) {
        nonImageNotes[k].x = belowX;
        nonImageNotes[k].y = belowY;
        belowX += nonImageNotes[k].width + 64;
      }
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
  } else if (mode === "sequence" || plan.connections.length > 0) {
    // Pure flowcard diagram (no image): Hierarchical Left-to-Right and Tiered Flow
    if (nonImageNotes.length <= 3) {
      let curX = 64;
      for (const note of nonImageNotes) {
        note.x = curX;
        note.y = 112;
        curX += note.width + 80;
      }
    } else {
      // 4 to 6 cards: 2 clean tiers
      const tier1Count = Math.ceil(nonImageNotes.length / 2);
      let tier1X = 64;
      let maxTier1Height = 110;
      for (let i = 0; i < tier1Count; i++) {
        nonImageNotes[i].x = tier1X;
        nonImageNotes[i].y = 112;
        maxTier1Height = Math.max(maxTier1Height, nonImageNotes[i].height);
        tier1X += nonImageNotes[i].width + 80;
      }
      let tier2X = 64;
      const tier2Y = 112 + maxTier1Height + 64;
      for (let i = tier1Count; i < nonImageNotes.length; i++) {
        nonImageNotes[i].x = tier2X;
        nonImageNotes[i].y = tier2Y;
        tier2X += nonImageNotes[i].width + 80;
      }
    }
  } else {
    // Single concept or worked example: clean vertical sequence
    let y = 112;
    for (const object of plan.objects) { object.x = 64; object.y = y; y += object.height + 56; }
  }

  // 3. Orthogonal Connector Routing with Obstacle Avoidance
  const byId = new Map(plan.objects.map(object => [object.id, object]));
  plan.connections = plan.connections.map(connection => {
    const from = byId.get(connection.from), to = byId.get(connection.to);
    if (!from || !to) return connection;
    const dx = to.x + to.width / 2 - from.x - from.width / 2;
    const dy = to.y + to.height / 2 - from.y - from.height / 2;

    let fromAnchor: VisualConnection["fromAnchor"];
    let toAnchor: VisualConnection["toAnchor"];

    if (to.x >= from.x + from.width) {
      // 'to' is strictly to the right
      fromAnchor = "right";
      toAnchor = "left";
    } else if (from.x >= to.x + to.width) {
      // 'to' is strictly to the left
      if (to.y >= from.y + from.height) {
        // 'to' is below and to the left (e.g. tier 1 to tier 2)
        fromAnchor = "bottom";
        toAnchor = "top";
      } else if (from.y >= to.y + to.height) {
        fromAnchor = "top";
        toAnchor = "bottom";
      } else {
        fromAnchor = "left";
        toAnchor = "right";
      }
    } else if (to.y >= from.y + from.height) {
      // 'to' is strictly below
      fromAnchor = "bottom";
      toAnchor = "top";
    } else if (from.y >= to.y + to.height) {
      // 'to' is strictly above
      fromAnchor = "top";
      toAnchor = "bottom";
    } else {
      const horizontal = Math.abs(dx) > Math.abs(dy);
      fromAnchor = horizontal ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
      toAnchor = horizontal ? (dx >= 0 ? "left" : "right") : (dy >= 0 ? "top" : "bottom");
    }

    const port = (object: VisualObject, side: string) => ({
      x: object.x + (side === "left" ? 0 : side === "right" ? object.width : object.width / 2),
      y: object.y + (side === "top" ? 0 : side === "bottom" ? object.height : object.height / 2)
    });

    const points = routeOrthogonalConnector({
      start: port(from, fromAnchor),
      end: port(to, toAnchor),
      startDirection: fromAnchor,
      endDirection: toAnchor,
      obstacles: plan.objects,
      startId: from.id,
      endId: to.id,
      clearance: 14,
    });

    return {
      ...connection,
      route: "elbow" as const,
      arrowhead: "arrow" as const,
      fromAnchor,
      toAnchor,
      points,
    };
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
