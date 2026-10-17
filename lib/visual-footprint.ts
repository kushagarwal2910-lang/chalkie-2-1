import type { VisualObject } from "./lesson-schema";
import { getNetworkMinimumSize, getCycleMinimumSize } from "./template-geometry.ts";
import { wrapConnectorLabel, connectorLabelTextWidth } from "./connector-routing.ts";
import { wrapCardLabel } from "./teaching-layout.ts";

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
    const lines = wrapCardLabel(object.label || "", 25);
    const longestLine = Math.max(...lines.map(l => l.length), 0);
    minWidth = Math.max(380, longestLine * 14 + 64);
    minHeight = Math.max(110, lines.length * 34 + 48);
  } else if (object.label) {
    // Standard shapes (rectangle, ellipse) with centered label
    const isEllipse = object.geo === "ellipse";
    const lines = wrapCardLabel(object.label, 25);
    const longestLine = Math.max(...lines.map(l => l.length), 0);
    const baseW = Math.max(380, longestLine * 14 + 64);
    const baseH = Math.max(110, lines.length * 34 + 48);
    minWidth = isEllipse ? Math.max(baseW, Math.round(Math.min(420, (connectorLabelTextWidth(object.label) + 64) * 1.25))) : baseW;
    minHeight = isEllipse ? Math.max(110, Math.round(baseH * 1.2)) : baseH;
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

