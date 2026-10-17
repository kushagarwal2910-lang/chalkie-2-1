import type { VisualObject, VisualConnection } from "./lesson-schema.ts";
import { projectImageRegion } from "./image-coordinates.ts";

export type TeachingCue = {
  phrase: string;
  targetId: string;
  kind: "focus" | "arrow" | "circle" | "bracket";
  toTargetId?: string;
};
export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number };
type Region = Bounds & { id?: string; label: string; confidence?: number };
export type SceneGeometry = Bounds & {
  id: string; type?: string; angle?: number; scale?: readonly number[];
  points?: readonly (readonly number[])[];
  customData?: Record<string, unknown> | null;
};
export type TeachingTarget = {
  id: string;
  objectId: string;
  label: string;
  kind: "region" | "image" | "card" | "connection";
  center: Point;
  bounds: Bounds;
  polygon: Point[];
  parentPolygon?: Point[];
};

export const targetSlug = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "_").replace(/^_|_$/g, "");
const validRegion = (r: Bounds) => [r.x, r.y, r.width, r.height].every(Number.isFinite)
  && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1.001 && r.y + r.height <= 1.001;
const whole = { x: 0, y: 0, width: 1, height: 1 };

export function boundsForPoints(points: Point[]): Bounds {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function visualRegions(object: VisualObject): Region[] {
  const plot = (object as VisualObject & { plot?: { regions?: Region[] } }).plot;
  return plot?.regions?.length ? plot.regions : object.image?.regions ?? [];
}

/** Resolve only real geometry. An unknown/low-confidence image feature never becomes a center guess. */
export function resolveTeachingTarget(
  targetId: string | null | undefined,
  objects: VisualObject[],
  connections: VisualConnection[] = [],
  scene?: readonly SceneGeometry[],
): TeachingTarget | null {
  if (!targetId) return null;
  let [objectId, subId] = targetId.split("#");
  let object = objects.find(o => o.id === objectId);
  if (!object && subId === undefined) {
    object = objects.find(o => o.annotations?.some(a => a.id === objectId));
    if (object) { subId = objectId; objectId = object.id; }
  }
  if (object) {
    const live = scene?.find(el => el.id === object!.id);
    if (scene && !live) return null; // The feature is not visible yet.
    const isImage = !!object.image || !!(object as VisualObject & { plot?: unknown }).plot;
    const box = live ?? { ...object, height: object.image ? object.width * object.image.height / object.image.width : object.height };
    const parentPolygon = projectImageRegion(box, whole);
    let polygon = parentPolygon;
    let label = object.label;
    let kind: TeachingTarget["kind"] = isImage ? "image" : "card";
    if (subId !== undefined) {
      if (!isImage || (live && live.type !== "image")) return null;
      const regions = visualRegions(object);
      const index = /^\d+$/.test(subId) ? Number(subId) : -1;
      const region = index >= 0 ? regions[index] : regions.find(r => r.id === subId || targetSlug(r.label) === targetSlug(subId));
      const annotation = object.annotations?.find(a => a.id === subId || targetSlug(a.regionLabel) === targetSlug(subId));
      // Numeric anchors always refer to detected/compiled regions, never annotation order.
      const normalized = region ?? annotation?.normalized;
      if (!normalized || !validRegion(normalized) || (region?.confidence !== undefined && region.confidence < 0.5)) return null;
      polygon = projectImageRegion(box, normalized);
      label = annotation?.calloutText || region?.label || annotation?.regionLabel || object.label;
      kind = "region";
    }
    const bounds = boundsForPoints(polygon);
    return { id: targetId, objectId, label, kind, bounds, polygon, center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, ...(isImage ? { parentPolygon } : {}) };
  }
  const connection = connections.find(c => c.id === targetId);
  if (!connection) return null;
  const live = scene?.find(el => el.id === connection.id);
  if (scene && !live) return null;
  const points = live?.points?.map(p => ({ x: live.x + p[0], y: live.y + p[1] })) ?? connection.points;
  if (!points?.length) return null;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let center = points[0];
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0;
      center = { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
      break;
    }
    remaining -= lengths[i];
  }
  return { id: targetId, objectId: connection.from, label: connection.label, kind: "connection", polygon: points, bounds: boundsForPoints(points), center };
}

export function cameraForTarget(target: TeachingTarget, viewport: { width: number; height: number }) {
  const width = Math.max(1, viewport.width), height = Math.max(1, viewport.height);
  const fit = Math.min(width * 0.7 / Math.max(1, target.bounds.width), height * 0.7 / Math.max(1, target.bounds.height));
  // Broad regions/small screens may need less than 1.8x so their bounding box stays visible.
  const zoom = target.kind === "region" ? Math.min(2.5, Math.max(1.8, fit), fit) : Math.min(1.8, fit);
  const safeZoom = Math.max(0.1, zoom);
  return { zoom: safeZoom, scrollX: width / (2 * safeZoom) - target.center.x, scrollY: height / (2 * safeZoom) - target.center.y };
}

function insidePolygon(point: Point, polygon: Point[]) {
  const signs = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  });
  return signs.every(s => s >= -0.001) || signs.every(s => s <= 0.001);
}

/** A quadratic curve whose control point remains inside the same image, including rotated images. */
export function interactionCurve(from: TeachingTarget, to: TeachingTarget): { start: Point; control: Point; end: Point } | null {
  if (from.kind !== "region" || to.kind !== "region" || from.objectId !== to.objectId || !from.parentPolygon) return null;
  const start = from.center, end = to.center;
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  let bend = Math.min(90, length * 0.25);
  let control = { x: (start.x + end.x) / 2 - dy / length * bend, y: (start.y + end.y) / 2 + dx / length * bend };
  while (bend > 0.1 && !insidePolygon(control, from.parentPolygon)) {
    bend /= 2;
    control = { x: (start.x + end.x) / 2 - dy / length * bend, y: (start.y + end.y) / 2 + dx / length * bend };
  }
  return { start, control, end };
}
