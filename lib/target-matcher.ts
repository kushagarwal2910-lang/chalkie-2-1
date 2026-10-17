import type { VisualObject, VisualConnection } from "./lesson-schema.ts";
import { resolveTeachingTarget, targetSlug, visualRegions, type TeachingCue } from "./teaching-focus.ts";

export interface TargetPosition {
  charIndex: number;
  targetId: string;
  baseTargetId: string;
  partIndex: number;
  partLabel: string;
  matchedToken: string;
  cue?: TeachingCue;
}

function phrasePattern(phrase: string) {
  return phrase.normalize("NFKC").trim().split(/[\s\p{P}]+/u).filter(Boolean)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\p{P}]+");
}

/** Exact labels and explicit narration phrases own focus; generic word fragments cannot steal it. */
export function computeTargetPositions(
  spokenNarration: string,
  targetIds: string[],
  objects: VisualObject[],
  connections: VisualConnection[] = [],
  teachingCues: TeachingCue[] = [],
): TargetPosition[] {
  const matches: Array<TargetPosition & { length: number; priority: number }> = [];
  const explicitRegionParents = new Set(targetIds.filter(id => id.includes("#") && resolveTeachingTarget(id, objects, connections)).map(id => id.split("#")[0]));
  const effectiveTargets = targetIds.filter(id => id.includes("#") || !explicitRegionParents.has(id));
  const primary = new Set(targetIds.map(id => id.split("#")[0]));
  const candidates: Array<{ phrase: string; targetId: string; priority: number; cue?: TeachingCue }> = [];
  for (const object of objects) {
    if (!primary.has(object.id)) continue;
    if (!explicitRegionParents.has(object.id)) candidates.push({ phrase: object.label, targetId: object.id, priority: 1 });
    visualRegions(object).forEach((region, index) => {
      const targetId = `${object.id}#${region.id ?? index}`;
      candidates.push({ phrase: region.label, targetId, priority: 3 });
      // Acronyms are safe aliases only when explicitly present in the feature label.
      for (const acronym of region.label.matchAll(/\(([A-Z][A-Z0-9-]{1,9})\)/g)) {
        candidates.push({ phrase: acronym[1], targetId, priority: 3 });
      }
      const expanded = region.label.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      if (expanded !== region.label) candidates.push({ phrase: expanded, targetId, priority: 3 });
    });
    for (const annotation of object.annotations ?? []) {
      const index = visualRegions(object).findIndex(region => targetSlug(region.label) === targetSlug(annotation.regionLabel));
      const region = visualRegions(object)[index];
      candidates.push({ phrase: annotation.calloutText || annotation.regionLabel, targetId: `${object.id}#${region ? region.id ?? index : annotation.id}`, priority: 3 });
    }
  }
  for (const connection of connections) {
    if (targetIds.includes(connection.id)) candidates.push({ phrase: connection.label, targetId: connection.id, priority: 2 });
  }
  for (const cue of teachingCues) {
    const from = resolveTeachingTarget(cue.targetId, objects, connections);
    const to = cue.toTargetId ? resolveTeachingTarget(cue.toTargetId, objects, connections) : null;
    if (!from || (cue.kind === "arrow" && (!to || from.kind !== "region" || to.kind !== "region" || from.objectId !== to.objectId))) continue;
    candidates.push({ phrase: cue.phrase, targetId: cue.targetId, priority: 10, cue });
  }
  for (const candidate of candidates) {
    const target = resolveTeachingTarget(candidate.targetId, objects, connections);
    const pattern = phrasePattern(candidate.phrase);
    if (!target || !pattern || candidate.phrase.trim().length < 2) continue;
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}])(${pattern})(?=$|[^\\p{L}\\p{N}\\p{M}])`, "giu");
    for (const match of spokenNarration.matchAll(regex)) {
      const subId = candidate.targetId.split("#")[1];
      matches.push({
        charIndex: (match.index ?? 0) + match[1].length,
        targetId: candidate.targetId,
        baseTargetId: target.objectId,
        partIndex: subId !== undefined && /^\d+$/.test(subId) ? Number(subId) : -1,
        partLabel: target.label,
        matchedToken: match[2],
        length: match[2].length,
        priority: candidate.priority,
        ...(candidate.cue ? { cue: candidate.cue } : {}),
      });
    }
  }
  // Explicit interaction phrases suppress ordinary label matches inside their spoken span.
  const explicit = matches.filter(m => m.cue);
  const sorted = matches.filter(m => m.cue || !explicit.some(c => m.charIndex >= c.charIndex && m.charIndex < c.charIndex + c.length))
    .sort((a, b) => a.charIndex - b.charIndex || b.priority - a.priority || b.length - a.length);
  const selected: TargetPosition[] = [];
  let previousEnd = -1;
  for (const match of sorted) {
    if (match.charIndex < previousEnd) continue;
    // Ambiguous equal labels on different regions should never produce a guessed jump.
    if (!match.cue && sorted.some(other => other !== match && other.charIndex === match.charIndex && other.length === match.length && other.priority === match.priority && other.targetId !== match.targetId)) continue;
    previousEnd = match.charIndex + match.length;
    const position: TargetPosition = { charIndex: match.charIndex, targetId: match.targetId, baseTargetId: match.baseTargetId, partIndex: match.partIndex, partLabel: match.partLabel, matchedToken: match.matchedToken, ...(match.cue ? { cue: match.cue } : {}) };
    if (selected.at(-1)?.targetId !== position.targetId || position.cue || selected.at(-1)?.cue) selected.push(position);
  }
  // Start at the declared visual's scope. A future phrase cue never fires before it is spoken.
  const firstTarget = effectiveTargets.map(id => resolveTeachingTarget(id, objects, connections)).find(Boolean);
  if (firstTarget && (!selected.length || selected[0].charIndex > 0)) {
    selected.unshift({ charIndex: 0, targetId: firstTarget.id, baseTargetId: firstTarget.objectId, partIndex: -1, partLabel: firstTarget.label, matchedToken: "step-anchor" });
  }
  return selected;
}
