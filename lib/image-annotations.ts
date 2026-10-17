import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { VisualObject } from "./lesson-schema";
import { type ImageAnnotation, type ImageAnnotationColor, isValidCalloutLabel } from "./visual-agent-schema.ts";

export const ANNOTATION_COLOR_MAP: Record<ImageAnnotationColor, { strokeColor: string; backgroundColor: string; badgeFill: string }> = {
  amber: { strokeColor: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.28)", badgeFill: "#fef3c7" },
  violet: { strokeColor: "#a78bfa", backgroundColor: "rgba(167, 139, 250, 0.28)", badgeFill: "#ede9fe" },
  cyan: { strokeColor: "#38bdf8", backgroundColor: "rgba(56, 189, 248, 0.28)", badgeFill: "#e0f2fe" },
  yellow: { strokeColor: "#fde047", backgroundColor: "rgba(253, 224, 71, 0.28)", badgeFill: "#fef9c3" },
  emerald: { strokeColor: "#34d399", backgroundColor: "rgba(52, 211, 153, 0.28)", badgeFill: "#d1fae5" },
};

export function compileImageAnnotationSkeletons(
  imageObject: VisualObject,
  annotations: ImageAnnotation[]
): ExcalidrawElementSkeleton[] {
  if (
    !imageObject.image ||
    !annotations.length ||
    imageObject.image.provenance === "plot" ||
    (imageObject as any).kind === "graph" ||
    (imageObject as any).kind === "plot" ||
    Boolean(imageObject.plot)
  ) return [];

  const imgW = imageObject.width;
  const imgH = imageObject.width * (imageObject.image.height / imageObject.image.width);
  const skeletons: ExcalidrawElementSkeleton[] = [];

  // Partition annotations into left-margin and right-margin groups.
  // Whiteboard diagrams naturally expand to the right, so we prefer the left margin
  // for concentric or centered structures to avoid colliding with outgoing connector lines.
  const leftAnns: ImageAnnotation[] = [];
  const rightAnns: ImageAnnotation[] = [];

  for (const ann of annotations) {
    const normCenterX = ann.normalized.x + ann.normalized.width * 0.5;
    // Only place on the right if clearly in the right third and not a wide concentric shell
    const isRightSide = normCenterX > 0.65 && ann.normalized.width < 0.55;
    if (isRightSide) {
      rightAnns.push(ann);
    } else {
      leftAnns.push(ann);
    }
  }

  const layoutSide = (anns: ImageAnnotation[], side: "left" | "right") => {
    if (!anns.length) return;

    // Sort annotations by their natural vertical position (or shell size if at similar Y)
    // so arrows remain parallel and NEVER cross each other.
    const sorted = [...anns].sort((a, b) => {
      const aCenterY = a.normalized.y + a.normalized.height * 0.5;
      const bCenterY = b.normalized.y + b.normalized.height * 0.5;
      if (Math.abs(aCenterY - bCenterY) >= 0.05) {
        return aCenterY - bCenterY;
      }
      // For concentric rings at the same Y, sort outer rings to the top, inner core below
      return b.normalized.width - a.normalized.width;
    });

    const slotSpacing = 44; // 44px vertical gap guarantees zero overlap between 18px text lines
    const totalClusterH = (sorted.length - 1) * slotSpacing;
    const baseSlotY = Math.round(imageObject.y + Math.max(16, (imgH - totalClusterH) / 2));

    sorted.forEach((ann, i) => {
      const palette = ANNOTATION_COLOR_MAP[ann.color] ?? ANNOTATION_COLOR_MAP.amber;
      const candidateText = ann.calloutText && isValidCalloutLabel(ann.calloutText)
        ? ann.calloutText
        : (isValidCalloutLabel(ann.regionLabel) ? ann.regionLabel : ann.regionLabel.slice(0, 28).trim());
      const labelText = candidateText || ann.regionLabel.slice(0, 28).trim();
      const labelWidth = Math.min(220, Math.max(90, Math.round(labelText.length * 8.2 + 26)));
      const slotY = baseSlotY + i * slotSpacing;

      let arrowStartX: number;
      let badgeX: number;
      let targetX: number;
      let targetY: number;

      if (side === "left") {
        // Position badge in the left margin
        badgeX = Math.round(imageObject.x - labelWidth - 36);
        arrowStartX = Math.round(imageObject.x - 22);

        // Target point: for wide concentric shells, point to the outer/left boundary of that shell
        if (ann.normalized.width >= 0.22) {
          targetX = Math.round(imageObject.x + (ann.normalized.x + Math.min(ann.normalized.width * 0.18, 0.08)) * imgW);
        } else {
          targetX = Math.round(imageObject.x + (ann.normalized.x + ann.normalized.width * 0.5) * imgW);
        }
        targetY = Math.round(imageObject.y + (ann.normalized.y + ann.normalized.height * 0.5) * imgH);
      } else {
        // Position badge in the right margin
        arrowStartX = Math.round(imageObject.x + imgW + 22);
        badgeX = Math.round(imageObject.x + imgW + 36);

        if (ann.normalized.width >= 0.22) {
          targetX = Math.round(imageObject.x + (ann.normalized.x + ann.normalized.width - Math.min(ann.normalized.width * 0.18, 0.08)) * imgW);
        } else {
          targetX = Math.round(imageObject.x + (ann.normalized.x + ann.normalized.width * 0.5) * imgW);
        }
        targetY = Math.round(imageObject.y + (ann.normalized.y + ann.normalized.height * 0.5) * imgH);
      }

      const dx = targetX - arrowStartX;
      const dy = targetY - slotY;

      // The arrow body originates in the outer margin beside the badge, and points precisely inward to the feature
      skeletons.push({
        id: `${ann.id}-arrow`,
        type: "arrow",
        x: arrowStartX,
        y: slotY,
        points: [[0, 0], [dx, dy]],
        strokeColor: palette.strokeColor,
        strokeWidth: 2.2,
        roughness: 0,
        endArrowhead: "arrow",
        customData: { chalkieId: imageObject.id, annotationId: ann.id, regionLabel: ann.regionLabel } as any,
      });

      // Crisp badge text with guaranteed >= 44px vertical separation
      skeletons.push({
        id: `${ann.id}-badge`,
        type: "text",
        x: badgeX,
        y: slotY - 10,
        text: `✦ ${labelText}`,
        fontSize: 14,
        strokeColor: palette.strokeColor || "#f8fafc",
        width: labelWidth,
        customData: { chalkieId: imageObject.id, annotationId: ann.id, regionLabel: ann.regionLabel } as any,
      });
    });
  };

  layoutSide(leftAnns, "left");
  layoutSide(rightAnns, "right");

  return skeletons;
}
