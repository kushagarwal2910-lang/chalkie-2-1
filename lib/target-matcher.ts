import type { VisualObject, VisualConnection } from "./lesson-schema";

export interface TargetPosition {
  charIndex: number;
  targetId: string;       // e.g. "central-solenoid#2" or "central-solenoid"
  baseTargetId: string;   // e.g. "central-solenoid"
  partIndex: number;      // -1 for whole object, >= 0 for specific internal part
  partLabel: string;      // specific label of the topic/part being discussed
  matchedToken: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "by", "from", "up", "about", "into", "over", "after", "is", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "this", "that", "these", "those", "each", "all", "both", "half", "some",
  "any", "most", "layer", "stage", "component", "card", "overview", "system",
  "structure", "model", "diagram", "where", "which", "then", "also", "here",
  "part", "high", "low", "shaped", "side", "type", "unit", "form", "item",
  "eye", "human", "cross-section", "cross", "section", "image", "figure", "illustration",
]);

interface CandidateTerm {
  term: string;
  targetId: string;
  baseTargetId: string;
  partIndex: number;
  partLabel: string;
  priority: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * High-precision linguistic target matcher:
 * Maps spoken teacher narration words to visual blackboard objects AND internal parts in real time with 110% precision.
 * When a specific part or concept is discussed (e.g. "Hydrogen Shell", "Loss Function", "D-T Ions", "MECO"),
 * the laser pointer glides directly to that exact feature and displays a synchronized live guide pill.
 */
export function computeTargetPositions(
  spokenNarration: string,
  targetIds: string[],
  objects: VisualObject[],
  connections?: VisualConnection[]
): TargetPosition[] {
  if (!objects || objects.length === 0) return [];
  const text = spokenNarration.toLowerCase();

  // If a step's targetIds contains specific region anchors (id#region or id#index),
  // filter out the bare parent image ID (id) from targetIds for that step so
  // Syllable-0 Anchoring (charIndex === 0) locks immediately onto the first specific region.
  const hasRegionAnchor = (baseId: string) => (targetIds || []).some(t => t.startsWith(`${baseId}#`));
  const effectiveTargetIds = (targetIds || []).filter(t => !t.includes("#") ? !hasRegionAnchor(t) : true);
  const primaryIdSet = new Set(effectiveTargetIds);

  const candidates: CandidateTerm[] = [];

  // Register terms from all objects (with higher priority for active segment targets)
  for (const obj of objects) {
    const isPrimary = primaryIdSet.has(obj.id) || Array.from(primaryIdSet).some((t) => t.split("#")[0] === obj.id);
    const hasActiveSubRegion = hasRegionAnchor(obj.id);

    // 1. VLM detected regions inside image
    if (obj.image?.regions && Array.isArray(obj.image.regions)) {
      obj.image.regions.forEach((region, index) => {
        const rawLabel = region.label || "";
        const cleanReg = rawLabel
          .replace(/\([^)]*\)/g, " ")
          .replace(/[{}\[\]<>:=+*\\/]/g, " ")
          .toLowerCase()
          .trim();
        const regPriority = isPrimary ? 4.5 : 2.8;

        // Extract parenthetical acronyms (e.g. "Left Ventricle (LV)" -> "lv")
        const parenMatches = rawLabel.match(/\(([^)]+)\)/g);
        if (parenMatches) {
          for (const pm of parenMatches) {
            const inside = pm.slice(1, -1).trim().toLowerCase();
            if (inside.length >= 2 && !STOP_WORDS.has(inside)) {
              candidates.push({
                term: inside,
                targetId: `${obj.id}#${index}`,
                baseTargetId: obj.id,
                partIndex: index,
                partLabel: region.label,
                priority: regPriority + 0.8,
              });
            }
          }
        }

        if (cleanReg.length >= 3 && !STOP_WORDS.has(cleanReg)) {
          candidates.push({
            term: cleanReg,
            targetId: `${obj.id}#${index}`,
            baseTargetId: obj.id,
            partIndex: index,
            partLabel: region.label,
            priority: regPriority,
          });
          const words = cleanReg.split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
          if (words.length >= 2) {
            for (let i = 0; i < words.length - 1; i++) {
              candidates.push({
                term: `${words[i]} ${words[i + 1]}`,
                targetId: `${obj.id}#${index}`,
                baseTargetId: obj.id,
                partIndex: index,
                partLabel: region.label,
                priority: regPriority - 0.2,
              });
            }
          }
          for (const w of words) {
            if (w.length >= 3 && !STOP_WORDS.has(w)) {
              candidates.push({
                term: w,
                targetId: `${obj.id}#${index}`,
                baseTargetId: obj.id,
                partIndex: index,
                partLabel: region.label,
                priority: isPrimary ? regPriority - 0.3 : regPriority - 0.7,
              });
            }
          }
        }
      });
    }

    // 2. Callout annotations for image
    if (obj.annotations && Array.isArray(obj.annotations)) {
      obj.annotations.forEach((ann, annIndex) => {
        const rawLabel = ann.calloutText || ann.regionLabel || "";
        const cleanAnn = rawLabel
          .replace(/\([^)]*\)/g, " ")
          .replace(/[{}\[\]<>:=+*\\/]/g, " ")
          .toLowerCase()
          .trim();
        const regIdx = obj.image?.regions?.findIndex(r => r.label.toLowerCase() === ann.regionLabel.toLowerCase());
        const targetId = `${obj.id}#${regIdx !== undefined && regIdx >= 0 ? regIdx : ann.id}`;
        const annPriority = isPrimary ? 4.8 : 3.4;

        const parenMatches = rawLabel.match(/\(([^)]+)\)/g);
        if (parenMatches) {
          for (const pm of parenMatches) {
            const inside = pm.slice(1, -1).trim().toLowerCase();
            if (inside.length >= 2 && !STOP_WORDS.has(inside)) {
              candidates.push({
                term: inside,
                targetId,
                baseTargetId: obj.id,
                partIndex: regIdx !== undefined && regIdx >= 0 ? regIdx : annIndex,
                partLabel: ann.calloutText || ann.regionLabel,
                priority: annPriority + 0.8,
              });
            }
          }
        }

        if (cleanAnn.length >= 3 && !STOP_WORDS.has(cleanAnn)) {
          candidates.push({
            term: cleanAnn,
            targetId,
            baseTargetId: obj.id,
            partIndex: regIdx !== undefined && regIdx >= 0 ? regIdx : annIndex,
            partLabel: ann.calloutText || ann.regionLabel,
            priority: annPriority,
          });

          const words = cleanAnn.split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
          if (words.length >= 2) {
            for (let i = 0; i < words.length - 1; i++) {
              candidates.push({
                term: `${words[i]} ${words[i + 1]}`,
                targetId,
                baseTargetId: obj.id,
                partIndex: regIdx !== undefined && regIdx >= 0 ? regIdx : annIndex,
                partLabel: ann.calloutText || ann.regionLabel,
                priority: annPriority - 0.2,
              });
            }
          }
          for (const w of words) {
            if (w.length >= 3 && !STOP_WORDS.has(w)) {
              candidates.push({
                term: w,
                targetId,
                baseTargetId: obj.id,
                partIndex: regIdx !== undefined && regIdx >= 0 ? regIdx : annIndex,
                partLabel: ann.calloutText || ann.regionLabel,
                priority: isPrimary ? annPriority - 0.3 : annPriority - 0.7,
              });
            }
          }
        }
      });
    }

    const priority = isPrimary ? 2.5 : 1.2;

    // 3. Object card label (including acronyms & stripped prefix)
    // If this object is an image and specific sub-regions are targeted for this step,
    // skip registering whole-image labels/tokens so broad terms don't hijack the laser to the center.
    if (!hasActiveSubRegion || !obj.image) {
      const rawObjLabel = obj.label || "";
      const cleanLabel = rawObjLabel
        .replace(/\([^)]*\)/g, " ")
        .replace(/[{}\[\]<>]/g, " ")
        .replace(/[:\-_—+*\\/]/g, " ")
        .trim()
        .toLowerCase();

      // Parenthetical acronyms in card label (e.g. "(MECO)", "(ATP)")
      const parenMatches = rawObjLabel.match(/\(([^)]+)\)/g);
      if (parenMatches) {
        for (const pm of parenMatches) {
          const inside = pm.slice(1, -1).trim().toLowerCase();
          if (inside.length >= 2 && !STOP_WORDS.has(inside)) {
            candidates.push({
              term: inside,
              targetId: obj.id,
              baseTargetId: obj.id,
              partIndex: -1,
              partLabel: obj.label,
              priority: priority + 1.2,
            });
          }
        }
      }

      // Stripped version without leading numbers/bullet prefixes (e.g. "1. Main Engine Cut-Off" -> "main engine cut off")
      const unnumberedLabel = cleanLabel.replace(/^(step\s*\d+|\d+[\.\):\-]\s*)/i, "").trim();
      if (unnumberedLabel && unnumberedLabel !== cleanLabel && unnumberedLabel.length >= 3 && !STOP_WORDS.has(unnumberedLabel)) {
        candidates.push({
          term: unnumberedLabel,
          targetId: obj.id,
          baseTargetId: obj.id,
          partIndex: -1,
          partLabel: obj.label,
          priority: priority + 0.6,
        });
      }

      if (cleanLabel.length >= 3 && !STOP_WORDS.has(cleanLabel)) {
        candidates.push({
          term: cleanLabel,
          targetId: obj.id,
          baseTargetId: obj.id,
          partIndex: -1,
          partLabel: obj.label,
          priority: priority + 0.5,
        });
      }

      // Multi-word phrases inside label
      const labelWords = (unnumberedLabel || cleanLabel).split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
      if (labelWords.length >= 2) {
        for (let i = 0; i < labelWords.length - 1; i++) {
          const bigram = `${labelWords[i]} ${labelWords[i + 1]}`;
          candidates.push({
            term: bigram,
            targetId: obj.id,
            baseTargetId: obj.id,
            partIndex: -1,
            partLabel: obj.label,
            priority: isPrimary ? priority + 0.3 : priority,
          });
        }
      }
      // Single words inside object label
      for (const w of labelWords) {
        if (isPrimary || w.length >= 6) {
          candidates.push({
            term: w,
            targetId: obj.id,
            baseTargetId: obj.id,
            partIndex: -1,
            partLabel: obj.label,
            priority: isPrimary ? priority : priority - 0.5,
          });
        }
      }

      // 4. Object ID tokens (e.g. "central-solenoid" -> "solenoid")
      const idTokens = obj.id
        .replace(/[^a-z0-9]/gi, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
      for (const token of idTokens) {
        if (isPrimary || token.length >= 7) {
          candidates.push({
            term: token,
            targetId: obj.id,
            baseTargetId: obj.id,
            partIndex: -1,
            partLabel: obj.label,
            priority: isPrimary ? priority : priority - 0.5,
          });
        }
      }
    }

    // 5. Meaningful part labels & data inside the object (flowchart bullet points)
    if (Array.isArray(obj.parts)) {
      obj.parts.forEach((p, pIdx) => {
        const partTargetId = `${obj.id}#${pIdx}`;

        if (p.text && p.text.length >= 2 && p.text.length <= 48) {
          const ptClean = p.text
            .replace(/\([^)]*\)/g, " ")
            .replace(/[{}\[\]<>:=+*\\/]/g, " ")
            .toLowerCase()
            .trim();

          if (ptClean && ptClean.length >= 3 && !STOP_WORDS.has(ptClean)) {
            candidates.push({
              term: ptClean,
              targetId: partTargetId,
              baseTargetId: obj.id,
              partIndex: pIdx,
              partLabel: p.text,
              priority: priority + 0.7,
            });

            const ptWords = ptClean.split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
            if (ptWords.length >= 2) {
              for (let i = 0; i < ptWords.length - 1; i++) {
                candidates.push({
                  term: `${ptWords[i]} ${ptWords[i + 1]}`,
                  targetId: partTargetId,
                  baseTargetId: obj.id,
                  partIndex: pIdx,
                  partLabel: p.text,
                  priority: priority + 0.4,
                });
              }
            }
            for (const pw of ptWords) {
              if (isPrimary || pw.length >= 6) {
                candidates.push({
                  term: pw,
                  targetId: partTargetId,
                  baseTargetId: obj.id,
                  partIndex: pIdx,
                  partLabel: p.text,
                  priority: isPrimary ? priority : priority - 0.5,
                });
              }
            }
          }
        }

        if (
          p.data &&
          typeof p.data === "string" &&
          p.data.length >= 3 &&
          p.data.length <= 24 &&
          !p.data.includes("|") &&
          !p.data.includes(":") &&
          !p.data.startsWith("M ") &&
          !/[0-9, ]{6,}/.test(p.data)
        ) {
          const pData = p.data.toLowerCase().trim();
          if (pData && !STOP_WORDS.has(pData) && (isPrimary || pData.length >= 6)) {
            candidates.push({
              term: pData,
              targetId: partTargetId,
              baseTargetId: obj.id,
              partIndex: pIdx,
              partLabel: p.text || obj.label,
              priority: isPrimary ? priority : priority - 0.5,
            });
          }
        }
      });
    }
  }

  // 6. Register connector labels (flowchart transitions between cards)
  if (connections && Array.isArray(connections)) {
    for (const conn of connections) {
      if (conn.label && conn.label.trim().length >= 3) {
        const cleanConn = conn.label
          .replace(/\([^)]*\)/g, " ")
          .replace(/[{}\[\]<>:=+*\\/]/g, " ")
          .toLowerCase()
          .trim();
        if (cleanConn.length >= 3 && !STOP_WORDS.has(cleanConn)) {
          candidates.push({
            term: cleanConn,
            targetId: conn.id,
            baseTargetId: conn.from,
            partIndex: -1,
            partLabel: conn.label,
            priority: 3.0,
          });
          const connWords = cleanConn.split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
          for (const cw of connWords) {
            if (cw.length >= 6 && !STOP_WORDS.has(cw)) {
              candidates.push({
                term: cw,
                targetId: conn.id,
                baseTargetId: conn.from,
                partIndex: -1,
                partLabel: conn.label,
                priority: 2.2,
              });
            }
          }
        }
      }
    }
  }

  // De-duplicate candidate terms per target
  const uniqueCandidates: CandidateTerm[] = [];
  const seenTermTarget = new Set<string>();
  for (const c of candidates) {
    const key = `${c.term}|${c.targetId}`;
    if (!seenTermTarget.has(key)) {
      seenTermTarget.add(key);
      uniqueCandidates.push(c);
    }
  }

  // Search for matches in spoken narration with strict word-boundary matching
  interface RawMatch extends TargetPosition {
    length: number;
    priority: number;
  }
  const rawMatches: RawMatch[] = [];

  for (const c of uniqueCandidates) {
    const escaped = escapeRegex(c.term);
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      rawMatches.push({
        charIndex: m.index,
        targetId: c.targetId,
        baseTargetId: c.baseTargetId,
        partIndex: c.partIndex,
        partLabel: c.partLabel,
        matchedToken: m[0],
        length: m[0].length,
        priority: c.priority,
      });
    }
  }

  // Sort matches:
  // 1. By charIndex ascending
  // 2. By length descending (longer, more specific phrases take precedence)
  // 3. By priority descending (active segment target preferred over other cards)
  rawMatches.sort((a, b) => a.charIndex - b.charIndex || b.length - a.length || b.priority - a.priority);

  // Filter overlapping spans (e.g. "central solenoid" vs "solenoid")
  const nonOverlapping: RawMatch[] = [];
  let lastEnd = -1;

  for (const m of rawMatches) {
    if (m.charIndex < lastEnd) continue;
    nonOverlapping.push(m);
    lastEnd = m.charIndex + m.length;
  }

  // Helper to resolve partLabel accurately
  const resolveTargetLabel = (targetId: string): string => {
    const [baseId, subId] = targetId.split("#");
    const obj = objects.find(o => o.id === baseId);
    if (!obj) return targetId;
    if (subId !== undefined) {
      const numIdx = Number(subId);
      if (obj.image?.regions) {
        const found = (!isNaN(numIdx) && obj.image.regions[numIdx])
          || obj.image.regions.find(r => r.label.toLowerCase() === subId.toLowerCase());
        if (found) return found.label;
      }
      if (obj.annotations) {
        const found = (!isNaN(numIdx) && obj.annotations[numIdx])
          || obj.annotations.find(a => a.id === subId || a.regionLabel.toLowerCase() === subId.toLowerCase());
        if (found) return found.calloutText || found.regionLabel;
      }
      if (obj.parts) {
        const found = (!isNaN(numIdx) && obj.parts[numIdx])
          || obj.parts.find(p => (p.text || "").toLowerCase() === subId.toLowerCase());
        if (found?.text) return found.text;
      }
    }
    return obj.label || targetId;
  };

  // 110% Precise Anchoring:
  // If NO terms matched in text, steadily anchor the pointer on the step's primary visual target.
  // Never arbitrarily jump mid-sentence across different cards!
  if (nonOverlapping.length === 0 && effectiveTargetIds.length > 0) {
    const primaryId = effectiveTargetIds[0];
    const baseId = primaryId.split("#")[0];
    const numIdx = primaryId.includes("#") ? Number(primaryId.split("#")[1]) : -1;
    nonOverlapping.push({
      charIndex: 0,
      targetId: primaryId,
      baseTargetId: baseId,
      partIndex: !isNaN(numIdx) ? numIdx : -1,
      partLabel: resolveTargetLabel(primaryId),
      matchedToken: "step-primary-anchor",
      length: 1,
      priority: 1,
    });
  }

  // Remove adjacent duplicate targets so pointer moves intentionally between topics
  const filtered: TargetPosition[] = [];
  for (const pos of nonOverlapping) {
    if (!filtered.length || filtered[filtered.length - 1].targetId !== pos.targetId) {
      filtered.push({
        charIndex: pos.charIndex,
        targetId: pos.targetId,
        baseTargetId: pos.baseTargetId,
        partIndex: pos.partIndex,
        partLabel: pos.partLabel,
        matchedToken: pos.matchedToken,
      });
    }
  }

  // Guarantee that from syllable 0 (charIndex 0), the pointer is positioned on the primary target
  if (filtered.length > 0 && filtered[0].charIndex > 0 && effectiveTargetIds.length > 0) {
    const primaryId = effectiveTargetIds[0];
    if (filtered[0].targetId === primaryId) {
      filtered[0].charIndex = 0;
    } else {
      const baseId = primaryId.split("#")[0];
      const numIdx = primaryId.includes("#") ? Number(primaryId.split("#")[1]) : -1;
      filtered.unshift({
        charIndex: 0,
        targetId: primaryId,
        baseTargetId: baseId,
        partIndex: !isNaN(numIdx) ? numIdx : -1,
        partLabel: resolveTargetLabel(primaryId),
        matchedToken: "step-initial-anchor",
      });
    }
  }

  return filtered;
}
