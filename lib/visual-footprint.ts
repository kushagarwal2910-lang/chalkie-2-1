import type { VisualObject } from "./lesson-schema";
import { getNetworkMinimumSize, getCycleMinimumSize } from "./template-geometry.ts";
import { wrapConnectorLabel, connectorLabelTextWidth } from "./connector-routing.ts";

/** The layout and the shape renderer must reserve exactly the same rectangle. */
export function getVisualFootprint(object: VisualObject) {
  let minWidth = 120;
  let minHeight = 80;

  if (object.shapeType === "custom-template" || object.templateType || object.template) {
    minWidth = 320;
    minHeight = 220;
    const props = object.props || object.templateData || {};
    const template = props.templateType || object.templateType || object.template;
    const data = props.data || props.content || object.content || props;
    const minimum = template === "network-graph" ? getNetworkMinimumSize(data)
      : template === "process-cycle" ? getCycleMinimumSize(data) : null;
    if (minimum) {
      minWidth = Math.max(minWidth, minimum.width);
      minHeight = Math.max(minHeight, minimum.height);
    }
  } else if (object.shapeType === "custom-chart") {
    minWidth = 200;
    minHeight = 160;
  } else if (object.shapeType === "custom-svg") {
    minWidth = 80;
    minHeight = 80;
  } else if (object.image) {
    // Sized for image asset and its accompanying bottom caption
    const targetW = Math.max(380, Number.isFinite(object.width) && object.width > 0 ? object.width : 480);
    const aspectH = object.image.width > 0 && object.image.height > 0
      ? (targetW * object.image.height) / object.image.width
      : 320;
    let captionH = 0;
    if (object.label) {
      const captionLines = wrapConnectorLabel(object.label, targetW * 13 / 20 + 20).length;
      captionH = captionLines * 28 + 20;
    }
    minWidth = targetW;
    minHeight = Math.round(aspectH + captionH + 16);
  } else if (object.shapeType === "image") {
    minWidth = Math.max(420, Number.isFinite(object.width) && object.width > 0 ? object.width : 480);
    minHeight = Math.max(320, Number.isFinite(object.height) && object.height > 0 ? object.height : 330);
  } else if (object.shapeType === "note" || object.role === "formula") {
    const isFormula = object.role === "formula" || /[=+Δ\\/*^]/.test(object.label || "");
    const fontSize = object.role === "subject" ? 30 : 24;
    const targetW = Math.max(isFormula ? 260 : 380, Number.isFinite(object.width) && object.width > 0 ? object.width : 380);
    const availableWidth = Math.max(100, targetW - 36);
    const maxLineChars = Math.max(28, Math.floor(availableWidth / 12));
    const lines = object.label
      ? object.label.split("\n").flatMap((line) => {
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
        })
      : [""];
    const textH = lines.length * fontSize * 1.35 + 24;
    minWidth = targetW;
    minHeight = Math.max(isFormula ? 88 : 80, Math.round(textH));
  } else if (object.label) {
    // Standard shapes (rectangle, ellipse) with centered label
    const isEllipse = object.geo === "ellipse";
    const targetW = Math.max(isEllipse ? 180 : 380, Number.isFinite(object.width) && object.width > 0 ? object.width : (isEllipse ? 180 : 380));
    const wrapW = Math.max(100, targetW - 32);
    const lines = wrapConnectorLabel(object.label, wrapW * 13 / 22 + 10).length;
    const textH = lines * 28 + 32;
    minWidth = isEllipse ? Math.max(targetW, Math.round(Math.min(380, (connectorLabelTextWidth(object.label) + 48) * 1.25))) : targetW;
    minHeight = Math.max(80, Math.round(isEllipse ? textH * 1.3 : textH));
  }

  if (object.parts?.some((part) => part.type === "axes")) {
    minWidth = Math.max(minWidth, 360);
    minHeight = Math.max(minHeight, 240);
  }

  return {
    width: Math.max(minWidth, Number.isFinite(object.width) ? object.width : minWidth),
    height: Math.max(minHeight, Number.isFinite(object.height) ? object.height : minHeight),
  };
}

