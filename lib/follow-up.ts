import type { FollowUpPlan, LessonPlan, LessonSegment, VisualConnection, VisualObject } from "./lesson-schema.ts";
import { normalizeLessonLayout } from "./lesson-layout.ts";
import { routeOrthogonalConnector } from "./connector-routing.ts";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const safeId = (value: string, fallback: string) => value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || fallback;

export type FollowUpMerge = {
  lesson: LessonPlan;
  startIndex: number;
  newObjectIds: string[];
};

function uniqueId(base: string, used: Set<string>) {
  let result = base;
  let suffix = 2;
  while (used.has(result)) result = `${base.slice(0, 52)}-${suffix++}`;
  used.add(result);
  return result;
}

function extensionLayout(plan: FollowUpPlan, idMap: Map<string, string>, objects: VisualObject[]): LessonPlan {
  const internalConnections = plan.connections.flatMap((connection, index) => {
    const from = idMap.get(connection.from);
    const to = idMap.get(connection.to);
    if (!from || !to || from === to) return [];
    return [{ ...connection, id: `extension-${index + 1}`, from, to }];
  });
  const firstId = objects[0]?.id ?? "extension-subject";
  const placeholder: LessonSegment = {
    id: "extension-layout",
    title: "Visual extension",
    narration: "Visual extension",
    targetIds: [firstId],
    action: "reveal",
    durationMs: 1200,
  };
  return normalizeLessonLayout({
    version: 2,
    teachingMode: plan.teachingMode,
    id: "follow-up-layout",
    title: plan.title,
    question: plan.title,
    summary: plan.answer,
    diagramType: "system",
    visualStrategy: plan.visualStrategy,
    sources: [],
    objects,
    connections: internalConnections,
    segments: [placeholder, { ...placeholder, id: "extension-layout-2" }],
  });
}

function automaticAnchors(from: VisualObject, to: VisualObject) {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  return Math.abs(dx) >= Math.abs(dy)
    ? { fromAnchor: dx >= 0 ? "right" as const : "left" as const, toAnchor: dx >= 0 ? "left" as const : "right" as const }
    : { fromAnchor: dy >= 0 ? "bottom" as const : "top" as const, toAnchor: dy >= 0 ? "top" as const : "bottom" as const };
}

export function mergeFollowUpLesson(current: LessonPlan, plan: FollowUpPlan): FollowUpMerge {
  const startIndex = current.segments.length;
  const existingIds = new Set(current.objects.map((object) => object.id));
  const usedObjectIds = new Set(existingIds);
  const room = Math.max(0, 72 - current.objects.length);
  // Filter out any objects that already exist in current.objects so existing scene objects are never duplicated or overwritten
  const rawObjects = plan.coverage === "append"
    ? plan.objects.slice(0, room).filter((object) => !existingIds.has(object.id))
    : [];
  const prefix = `follow-${safeId(plan.id, String(startIndex + 1))}`;
  const idMap = new Map<string, string>();
  const preparedObjects = rawObjects.map((object, index) => {
    const id = uniqueId(safeId(`${prefix}-${safeId(object.id, `object-${index + 1}`)}`, `follow-object-${index + 1}`), usedObjectIds);
    idMap.set(object.id, id);
    return { ...object, id };
  });

  const normalized = preparedObjects.length ? extensionLayout(plan, idMap, preparedObjects) : null;
  const localObjects = normalized?.objects ?? [];

  // Calculate currentMaxX including ALL existing VisualObjects AND any external margin callout badges
  let currentMaxX = 0;
  for (const object of current.objects) {
    let right = object.x + object.width;
    if (object.annotations && object.annotations.length > 0) {
      for (const ann of object.annotations) {
        const normCenterX = ann.normalized.x + ann.normalized.width * 0.5;
        const isRightSide = normCenterX > 0.65 && ann.normalized.width < 0.55;
        if (isRightSide) {
          const labelText = ann.calloutText || ann.regionLabel;
          const labelWidth = Math.min(220, Math.max(90, Math.round(labelText.length * 8.2 + 26)));
          const badgeRight = object.x + object.width + 36 + labelWidth;
          if (badgeRight > right) right = badgeRight;
        }
      }
    }
    if (right > currentMaxX) currentMaxX = right;
  }

  const currentMinY = current.objects.length ? Math.min(...current.objects.map((object) => object.y)) : 24;
  const extensionMinX = localObjects.length ? Math.min(...localObjects.map((object) => object.x)) : 0;
  const extensionMinY = localObjects.length ? Math.min(...localObjects.map((object) => object.y)) : 24;
  const xOffset = currentMaxX + 220 - extensionMinX;
  const yOffset = currentMinY - extensionMinY;
  const newObjects = localObjects.map((object) => ({ ...object, x: object.x + xOffset, y: object.y + yOffset }));
  const updatedExistingObjects = current.objects.map((existingObj) => {
    const matchingPlanObj = plan.objects.find((p) => p.id === existingObj.id);
    if (matchingPlanObj) {
      const existingAnnIds = new Set((existingObj.annotations ?? []).map((a) => a.id));
      const incoming = (matchingPlanObj.annotations ?? []).filter((a) => !existingAnnIds.has(a.id));
      return {
        ...existingObj,
        image: matchingPlanObj.image ?? existingObj.image,
        annotations: [...(existingObj.annotations ?? []), ...incoming],
      };
    }
    return existingObj;
  });
  const objectById = new Map([...updatedExistingObjects, ...newObjects].map((object) => [object.id, object]));

  const usedConnectionIds = new Set(current.connections.map((connection) => connection.id));
  const internalConnections = (normalized?.connections ?? []).map((connection) => ({
    ...connection,
    id: uniqueId(`${prefix}-${safeId(connection.id, "link")}`, usedConnectionIds),
    points: connection.points?.map(point => ({ x: point.x + xOffset, y: point.y + yOffset })),
    labelPosition: connection.labelPosition ? { ...connection.labelPosition, x: connection.labelPosition.x + xOffset, y: connection.labelPosition.y + yOffset } : undefined,
  }));
  const crossConnections: VisualConnection[] = plan.connections.flatMap((connection, index) => {
    const from = idMap.get(connection.from) ?? (usedObjectIds.has(connection.from) ? connection.from : undefined);
    const to = idMap.get(connection.to) ?? (usedObjectIds.has(connection.to) ? connection.to : undefined);
    if (!from || !to || from === to || (idMap.has(connection.from) && idMap.has(connection.to))) return [];
    const fromObject = objectById.get(from);
    const toObject = objectById.get(to);
    if (!fromObject || !toObject) return [];
    const anchors = automaticAnchors(fromObject, toObject);
    const port = (obj: VisualObject, side: string) => ({
      x: obj.x + (side === "left" ? 0 : side === "right" ? obj.width : obj.width / 2),
      y: obj.y + (side === "top" ? 0 : side === "bottom" ? obj.height : obj.height / 2),
    });
    const points = connection.route === "curve" ? undefined : routeOrthogonalConnector({
      start: port(fromObject, anchors.fromAnchor),
      end: port(toObject, anchors.toAnchor),
      startDirection: anchors.fromAnchor,
      endDirection: anchors.toAnchor,
      obstacles: [...updatedExistingObjects, ...newObjects],
      startId: from,
      endId: to,
    });
    return [{
      ...connection,
      id: uniqueId(`${prefix}-bridge-${safeId(connection.id, String(index + 1))}`, usedConnectionIds),
      from,
      to,
      label: connection.label.replace(/[<>]/g, "").slice(0, 36),
      route: connection.route === "curve" ? "curve" as const : "elbow" as const,
      ...(connection.route === "curve" ? {} : anchors),
      ...(points?.length ? { points } : {}),
      bend: clamp(connection.bend, -160, 160),
    }];
  });

  const validIds = new Set(objectById.keys());
  const mapTarget = (target: string): string | null => {
    const [base, part] = target.split("#");
    const mappedBase = idMap.get(base) ?? base;
    if (!validIds.has(mappedBase)) return null;
    return part !== undefined ? `${mappedBase}#${part}` : mappedBase;
  };

  const fallbackIds = plan.targetIds.map(mapTarget).filter((id): id is string => Boolean(id));
  const defaultFallback = newObjects[0]?.image?.regions?.length
    ? `${newObjects[0].id}#0`
    : (newObjects[0]?.id ?? current.objects[0]?.id);
  const fallback = fallbackIds[0] ?? defaultFallback;
  const usedSegmentIds = new Set(current.segments.map((segment) => segment.id));
  const newSegments = plan.segments.map((segment, index) => {
    const mapped = segment.targetIds.map(mapTarget).filter((id): id is string => Boolean(id));
    return {
      ...segment,
      id: uniqueId(`${prefix}-${safeId(segment.id, `step-${index + 1}`)}`, usedSegmentIds),
      title: segment.title.replace(/[<>]/g, "").slice(0, 80),
      narration: segment.narration.replace(/[<>]/g, "").slice(0, 700),
      targetIds: mapped.length ? [...new Set(mapped)] : fallback ? [fallback] : segment.targetIds,
      durationMs: clamp(segment.durationMs, 1200, 45000),
    };
  });

  return {
    startIndex,
    newObjectIds: newObjects.map((object) => object.id),
    lesson: {
      ...current,
      sources: [...new Map([...(plan.sources ?? []), ...current.sources].map(source => [source.url, source])).values()].map((source, index) => ({ ...source, id: `source-${index + 1}` })).slice(0, 20),
      summary: `${current.summary}${current.summary ? " " : ""}Follow-up: ${plan.answer}`.slice(0, 1600),
      objects: [...updatedExistingObjects, ...newObjects],
      connections: [...current.connections, ...internalConnections, ...crossConnections],
      segments: [...current.segments, ...newSegments],
    },
  };
}
