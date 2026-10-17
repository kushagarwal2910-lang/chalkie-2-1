import type { LessonPlan, VisualObject } from "./lesson-schema";

const BACKDROP_ROLES = new Set(["environment", "container", "layer", "field", "path"]);

export interface ProgressiveSceneResult {
  visibleObjects: VisualObject[];
  visibleObjectIds: Set<string>;
  visibleConnectionIds: Set<string>;
  newlyRevealedIds: Set<string>;
}

export function getProgressiveScene(
  lesson: LessonPlan,
  activeStep: number,
  isPresenting: boolean
): ProgressiveSceneResult {
  // When not presenting (e.g. overview or editing), the complete board is visible
  if (!isPresenting) {
    const allObjIds = new Set(lesson.objects.map((o) => o.id));
    const allConnIds = new Set(lesson.connections.map((c) => c.id));
    return {
      visibleObjects: lesson.objects,
      visibleObjectIds: allObjIds,
      visibleConnectionIds: allConnIds,
      newlyRevealedIds: new Set(),
    };
  }

  if (activeStep < 0) {
    return {
      visibleObjects: [],
      visibleObjectIds: new Set(),
      visibleConnectionIds: new Set(),
      newlyRevealedIds: new Set(),
    };
  }

  // Targets revealed in prior steps (0 to activeStep - 1)
  const priorTargets = new Set<string>();
  for (let i = 0; i < activeStep && i < lesson.segments.length; i++) {
    const seg = lesson.segments[i];
    if (seg && Array.isArray(seg.targetIds)) {
      seg.targetIds.forEach((t) => {
        priorTargets.add(t);
        if (t.includes("#")) priorTargets.add(t.split("#")[0]);
      });
    }
  }

  // Targets revealed in the current activeStep
  const currentStepTargets = new Set<string>();
  const currentSeg = lesson.segments[activeStep];
  if (currentSeg && Array.isArray(currentSeg.targetIds)) {
    currentSeg.targetIds.forEach((t) => {
      currentStepTargets.add(t);
      if (t.includes("#")) currentStepTargets.add(t.split("#")[0]);
    });
  }

  // Cumulative targets (0 through activeStep)
  const cumulativeTargets = new Set<string>([...priorTargets, ...currentStepTargets]);

  // If a step targets a connection itself, its endpoints must also be present
  for (const connection of lesson.connections) {
    if (cumulativeTargets.has(connection.id)) {
      cumulativeTargets.add(connection.from);
      cumulativeTargets.add(connection.to);
    }
  }

  const visibleObjects = lesson.objects.filter((obj) => {
    // Structural backdrops or frame containers remain visible
    if (BACKDROP_ROLES.has(obj.role) || obj.shapeType === "frame") return true;

    if (cumulativeTargets.has(obj.id)) return true;

    const objIdLower = obj.id.toLowerCase();
    const objLabelLower = (obj.label || "").toLowerCase();
    for (const target of cumulativeTargets) {
      const tLower = target.toLowerCase();
      if (
        objIdLower.includes(tLower) ||
        tLower.includes(objIdLower) ||
        (objLabelLower.length > 0 && (objLabelLower.includes(tLower) || tLower.includes(objLabelLower)))
      ) {
        return true;
      }
    }
    return false;
  });

  // Safety fallback: ensure at least proportional objects are visible so canvas is never blank
  if (visibleObjects.length === 0 && lesson.objects.length > 0) {
    const fraction = Math.min(1, (activeStep + 1) / Math.max(1, lesson.segments.length));
    const count = Math.max(1, Math.ceil(fraction * lesson.objects.length));
    visibleObjects.push(...lesson.objects.slice(0, count));
  }

  const visibleObjectIds = new Set(visibleObjects.map((o) => o.id));

  // Determine visible connections:
  // A connection is visible if:
  // 1. It was explicitly targeted in cumulativeTargets, OR
  // 2. Both its `from` and `to` nodes are visible objects in the scene.
  const visibleConnectionIds = new Set<string>();
  for (const connection of lesson.connections) {
    if (
      cumulativeTargets.has(connection.id) ||
      (visibleObjectIds.has(connection.from) && visibleObjectIds.has(connection.to))
    ) {
      visibleConnectionIds.add(connection.id);
    }
  }

  // Prior visible connections (for newlyRevealed computation)
  const priorConnectionIds = new Set<string>();
  for (const connection of lesson.connections) {
    if (
      priorTargets.has(connection.id) ||
      (priorTargets.has(connection.from) && priorTargets.has(connection.to))
    ) {
      priorConnectionIds.add(connection.id);
    }
  }

  // Newly revealed IDs in this step (not revealed in prior steps)
  const newlyRevealedIds = new Set<string>();
  for (const obj of visibleObjects) {
    if (!priorTargets.has(obj.id)) {
      newlyRevealedIds.add(obj.id);
    }
  }
  for (const connId of visibleConnectionIds) {
    if (!priorConnectionIds.has(connId) || currentStepTargets.has(connId)) {
      newlyRevealedIds.add(connId);
    }
  }

  return {
    visibleObjects,
    visibleObjectIds,
    visibleConnectionIds,
    newlyRevealedIds,
  };
}

export function getProgressiveVisibleObjects(
  lesson: LessonPlan,
  activeStep: number,
  isPresenting: boolean
): VisualObject[] {
  return getProgressiveScene(lesson, activeStep, isPresenting).visibleObjects;
}
