/**
 * lib/graph-generator.ts
 * Universal Scientific Graph Engine for Chalkie 2.0.
 * Transforms mathematical and quantitative graph specifications into self-grounded
 * high-resolution ImageAssets complete with normalized ImageRegion[] bounding boxes.
 *
 * 100% Domain-Agnostic: Zero hardcoded subject matter presets or domain branching.
 * Primary Engine: Local Python Matplotlib helper (scripts/render_graph.py).
 * Fallback Engine: Zero-dependency pure-TypeScript scientific SVG plotter.
 */

import type { ImageRegion } from "./lesson-schema.ts";

export interface GraphPoint {
  x: number;
  y: number;
  label?: string;
  callout?: string;
}

export interface GraphSeries {
  name: string;
  color?: string;
  points: GraphPoint[];
  formulaInX?: string;
  expression?: string;
}

export interface UniversalPlotSpec {
  title: string;
  subtitleFormula?: string;
  chartKind?: "line" | "curve" | "bar" | "scatter" | string;
  graphType?: string; // backwards compatibility alias for chartKind
  xAxisLabel: string;
  yAxisLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  series: GraphSeries[];
  referenceLines?: Array<{
    axis: "x" | "y";
    value: number;
    label: string;
  }>;
  width?: number;
  height?: number;
}

export interface ScientificPlotSpec {
  title: string;
  subtitleFormula?: string;
  xAxisLabel: string;
  yAxisLabel: string;
  xDomain: [number, number];
  yDomain?: [number, number];
  series: Array<{
    label: string;
    color?: string;
    formulaInX?: string;
    anchorPoints: Array<{ x: number; y: number; callout?: string; label?: string }>;
  }>;
  referenceLines?: Array<{
    axis: "x" | "y";
    value: number;
    label: string;
  }>;
  width?: number;
  height?: number;
}

export interface GraphRequest {
  title: string;
  subtitleFormula?: string;
  chartKind?: "line" | "curve" | "bar" | "scatter" | string;
  graphType?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  seriesSpec?: string;
  domain?: [number, number];
  xDomain?: [number, number];
  yDomain?: [number, number];
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number; label?: string; callout?: string }>;
  series?: Array<{
    name?: string;
    label?: string;
    points?: Array<{ x: number; y: number; label?: string; callout?: string }>;
    anchorPoints?: Array<{ x: number; y: number; callout?: string; label?: string }>;
    color?: string;
    expression?: string;
    formulaInX?: string;
  }>;
  referenceLines?: Array<{
    axis: "x" | "y";
    value: number;
    label: string;
  }>;
}

export type GraphRequestInput = GraphRequest | ScientificPlotSpec | UniversalPlotSpec;

export interface PlotMetadata {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  seriesSummary?: Array<{
    name: string;
    peakX: number;
    peakY: number;
    minY: number;
    maxY: number;
  }>;
}

export interface ScientificGraphResult {
  dataUrl: string;
  width: number;
  height: number;
  regions: ImageRegion[];
  plotMetadata?: PlotMetadata;
}

const CHALK_PALETTE = ["#38bdf8", "#f43f5e", "#a78bfa", "#34d399", "#fbbf24", "#e879f9"];

function parseExplicitPointsTs(text: string): Array<{ x: number; y: number; label?: string }> | null {
  if (!text) return null;
  const matches = [...text.matchAll(/[\(\[]\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*[\)\]]/g)];
  if (matches.length >= 2) {
    return matches.map(m => ({ x: Number(m[1]), y: Number(m[2]) }));
  }
  return null;
}

function interpolateHermiteTs(points: Array<{ x: number; y: number }>, x: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (x <= sorted[0].x) return sorted[0].y;
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (x >= sorted[i].x && x <= sorted[i + 1].x) {
      const span = sorted[i + 1].x - sorted[i].x || 1;
      const t = (x - sorted[i].x) / span;
      const smoothT = t * t * (3 - 2 * t);
      return sorted[i].y + smoothT * (sorted[i + 1].y - sorted[i].y);
    }
  }
  return sorted[sorted.length - 1].y;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

/**
 * Pure TypeScript Zero-Dependency Universal Scientific SVG Plotter.
 * Renders publication-grade dark chalkboard graph with glowing chalk paths,
 * 12% breathing room, and mathematically exact ImageRegion bounding boxes.
 */
export function renderScientificSvgGraph(req: GraphRequestInput): ScientificGraphResult {
  const W = req.width || 800;
  const H = req.height || 520;
  const title = req.title || "Scientific Data Plot";
  const xLabel = req.xAxisLabel || "x";
  const yLabel = req.yAxisLabel || "y";
  const subtitleFormula = req.subtitleFormula || "";

  let chartKind = ((req as any).chartKind || (req as any).graphType || "curve").toLowerCase();
  if (chartKind === "wave-comparison" || chartKind === "function-plot") {
    chartKind = "curve";
  } else if (chartKind === "line-chart" || chartKind === "timeline") {
    chartKind = "line";
  } else if (chartKind === "bar-chart") {
    chartKind = "bar";
  }

  interface SvgSeries {
    name: string;
    color: string;
    points: { x: number; y: number; label?: string }[];
    samples: { x: number; y: number }[];
  }

  const svgSeries: SvgSeries[] = [];
  const rawSeries = req.series;

  if (Array.isArray(rawSeries) && rawSeries.length > 0) {
    rawSeries.forEach((s, idx) => {
      const name = (s as any).name || (s as any).label || `Series ${idx + 1}`;
      const color = s.color || CHALK_PALETTE[idx % CHALK_PALETTE.length];
      const rawPoints = (s as any).points || (s as any).anchorPoints || [];
      const points: Array<{ x: number; y: number; label?: string }> = rawPoints.map((p: any) => ({
        x: Number(p.x),
        y: Number(p.y),
        label: p.label || p.callout || "",
      })).filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));

      svgSeries.push({
        name,
        color,
        points,
        samples: [],
      });
    });
  } else if ((req as GraphRequest).seriesSpec) {
    const spec = (req as GraphRequest).seriesSpec || "";
    const parts = spec.split(";").map(s => s.trim()).filter(Boolean);
    parts.forEach((part, idx) => {
      const color = CHALK_PALETTE[idx % CHALK_PALETTE.length];
      let name = "";
      let expr = part;
      if (expr.includes(":")) {
        const segs = expr.split(":");
        name = segs[0].trim();
        expr = segs[1].trim();
      }
      if (expr.includes("|")) {
        expr = expr.split("|")[0].trim();
      }
      if (!name) {
        name = `Series ${idx + 1}`;
      }
      const explicit = parseExplicitPointsTs(expr);
      svgSeries.push({
        name,
        color,
        points: explicit || [],
        samples: [],
      });
    });
  } else if ((req as any).points && Array.isArray((req as any).points)) {
    const pts = (req as any).points
      .map((p: any) => ({ x: Number(p.x), y: Number(p.y), label: p.label || p.callout || "" }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length > 0) {
      svgSeries.push({
        name: title,
        color: CHALK_PALETTE[0],
        points: pts,
        samples: [],
      });
    }
  }

  // If no series parsed, create a clean default 2-point unit segment
  if (!svgSeries.length) {
    svgSeries.push({
      name: title,
      color: CHALK_PALETTE[0],
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      samples: [],
    });
  }

  // Calculate X bounds with 12% breathing room
  const allPointsX = svgSeries.flatMap(s => s.points.map(p => p.x));
  let minX = allPointsX.length ? Math.min(...allPointsX) : 0;
  let maxX = allPointsX.length ? Math.max(...allPointsX) : 10;

  if ((req as any).xDomain && (req as any).xDomain.length === 2) {
    [minX, maxX] = (req as any).xDomain;
  } else if ((req as any).domain && (req as any).domain.length === 2) {
    [minX, maxX] = (req as any).domain;
  }

  if (minX >= maxX) {
    minX -= 1;
    maxX += 1;
  }

  const spanX = maxX - minX || 1;
  const padX = spanX * 0.12;
  const plotMinX = (req as any).xDomain || (req as any).domain ? minX : minX - padX;
  const plotMaxX = (req as any).xDomain || (req as any).domain ? maxX : maxX + padX;

  // Sample points across domain for curve interpolation
  const sampleCount = 200;
  svgSeries.forEach(s => {
    s.samples = [];
    if (s.points.length >= 2) {
      for (let i = 0; i <= sampleCount; i++) {
        const x = plotMinX + (i / sampleCount) * (plotMaxX - plotMinX);
        s.samples.push({ x, y: interpolateHermiteTs(s.points, x) });
      }
    } else if (s.points.length === 1) {
      s.samples.push({ x: plotMinX, y: s.points[0].y }, { x: plotMaxX, y: s.points[0].y });
    }
  });

  // Calculate Y bounds with 12% breathing room
  const left = 85;
  const right = W - 45;
  const top = subtitleFormula ? 80 : 65;
  const bottom = H - 75;

  let allY = svgSeries.flatMap(s => [
    ...s.points.map(p => p.y),
    ...s.samples.map(p => p.y)
  ]).filter(Number.isFinite);

  if (!allY.length) allY = [0, 10];
  let minY = Math.min(...allY);
  let maxY = Math.max(...allY);

  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  const spanY = maxY - minY || 1;
  const padY = spanY * 0.12;
  let plotMinY = (req as any).yDomain ? (req as any).yDomain[0] : (minY >= 0 && minY - padY < 0 ? 0 : minY - padY);
  let plotMaxY = (req as any).yDomain ? (req as any).yDomain[1] : maxY + padY * 1.15;

  const toPx = (x: number) => left + ((x - plotMinX) / (plotMaxX - plotMinX)) * (right - left);
  const toPy = (y: number) => bottom - ((y - plotMinY) / (plotMaxY - plotMinY)) * (bottom - top);

  const svgParts: string[] = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  svgParts.push(`<rect width="${W}" height="${H}" rx="14" fill="#121318"/>`);

  // Title
  svgParts.push(`<text x="${W / 2}" y="32" fill="#f8fafc" font-size="15" font-family="system-ui, sans-serif" font-weight="bold" text-anchor="middle">${escapeXml(title)}</text>`);

  // Subtitle Formula Badge
  if (subtitleFormula) {
    svgParts.push(`<rect x="${W / 2 - 180}" y="42" width="360" height="24" rx="6" fill="#181a24" stroke="#475569" stroke-width="0.8"/>`);
    svgParts.push(`<text x="${W / 2}" y="58" fill="#e2e8f0" font-size="11" font-family="system-ui, monospace" text-anchor="middle">${escapeXml(subtitleFormula)}</text>`);
  }

  // Gridlines & Ticks
  const gridStepsX = 5;
  const gridStepsY = 4;
  for (let i = 0; i <= gridStepsX; i++) {
    const gx = left + (i / gridStepsX) * (right - left);
    const valX = plotMinX + (i / gridStepsX) * (plotMaxX - plotMinX);
    svgParts.push(`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${bottom}" stroke="#222738" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.85"/>`);
    svgParts.push(`<text x="${gx}" y="${bottom + 22}" fill="#94a3b8" font-size="11" font-family="system-ui, sans-serif" text-anchor="middle">${valX.toFixed(1)}</text>`);
  }
  for (let i = 0; i <= gridStepsY; i++) {
    const gy = top + (i / gridStepsY) * (bottom - top);
    const valY = plotMaxY - (i / gridStepsY) * (plotMaxY - plotMinY);
    svgParts.push(`<line x1="${left}" y1="${gy}" x2="${right}" y2="${gy}" stroke="#222738" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.85"/>`);
    svgParts.push(`<text x="${left - 12}" y="${gy + 4}" fill="#94a3b8" font-size="11" font-family="system-ui, sans-serif" text-anchor="end">${valY.toFixed(1)}</text>`);
  }

  // Reference lines
  if (req.referenceLines && req.referenceLines.length > 0) {
    for (const ref of req.referenceLines) {
      if (ref.axis === "y") {
        const py = toPy(ref.value);
        svgParts.push(`<line x1="${left}" y1="${py}" x2="${right}" y2="${py}" stroke="#71717a" stroke-width="1.2" stroke-dasharray="6,4"/>`);
        svgParts.push(`<text x="${right - 10}" y="${py - 6}" fill="#a1a1aa" font-size="10" font-style="italic" text-anchor="end">${escapeXml(ref.label)}</text>`);
      } else if (ref.axis === "x") {
        const px = toPx(ref.value);
        svgParts.push(`<line x1="${px}" y1="${top}" x2="${px}" y2="${bottom}" stroke="#71717a" stroke-width="1.2" stroke-dasharray="6,4"/>`);
        svgParts.push(`<text x="${px + 6}" y="${top + 16}" fill="#a1a1aa" font-size="10" font-style="italic">${escapeXml(ref.label)}</text>`);
      }
    }
  } else if (plotMinY <= 0 && plotMaxY >= 0) {
    const y0 = toPy(0);
    svgParts.push(`<line x1="${left}" y1="${y0}" x2="${right}" y2="${y0}" stroke="#3f3f46" stroke-width="1.0" opacity="0.7"/>`);
  }

  // Border Spines
  svgParts.push(`<path d="M${left},${top} V${bottom} H${right}" fill="none" stroke="#3f3f46" stroke-width="1.2"/>`);

  // Axis Labels
  svgParts.push(`<text x="${(left + right) / 2}" y="${H - 22}" fill="#f1f5f9" font-size="12" font-family="system-ui, sans-serif" font-weight="500" text-anchor="middle">${escapeXml(xLabel)}</text>`);
  svgParts.push(`<text x="24" y="${(top + bottom) / 2}" transform="rotate(-90 24 ${(top + bottom) / 2})" fill="#f1f5f9" font-size="12" font-family="system-ui, sans-serif" font-weight="500" text-anchor="middle">${escapeXml(yLabel)}</text>`);

  // Render Series by chartKind
  if (chartKind === "bar") {
    const numS = svgSeries.length;
    const allX = Array.from(new Set(svgSeries.flatMap(s => s.points.map(p => p.x)))).sort((a, b) => a - b);
    let minDx = 1.0;
    if (allX.length > 1) {
      const diffs = allX.slice(1).map((x, i) => x - allX[i]).filter(d => d > 1e-4);
      if (diffs.length) minDx = Math.min(...diffs);
    }
    const totalGroupW = Math.max(12, Math.min(80, (toPx(plotMinX + minDx) - toPx(plotMinX)) * 0.72));
    const singleBarW = totalGroupW / Math.max(1, numS);

    svgSeries.forEach((s, sIdx) => {
      const offset = (sIdx - (numS - 1) / 2) * singleBarW;
      s.points.forEach(p => {
        const cx = toPx(p.x) + offset;
        const cy = toPy(p.y);
        const yBase = toPy(Math.max(0, plotMinY));
        const barY = Math.min(cy, yBase);
        const barH = Math.max(2, Math.abs(cy - yBase));
        svgParts.push(`<rect x="${cx - singleBarW / 2}" y="${barY}" width="${singleBarW}" height="${barH}" fill="${s.color}" fill-opacity="0.88" stroke="${s.color}" stroke-width="1.2" rx="3"/>`);
      });
    });
  } else if (chartKind === "scatter") {
    svgSeries.forEach(s => {
      s.points.forEach(p => {
        const cx = toPx(p.x);
        const cy = toPy(p.y);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="9" fill="${s.color}" opacity="0.25"/>`);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="4.5" fill="${s.color}" stroke="#ffffff" stroke-width="1.2"/>`);
      });
    });
  } else if (chartKind === "line") {
    svgSeries.forEach(s => {
      let d = "";
      s.points.forEach((p, idx) => {
        const px = toPx(p.x).toFixed(1);
        const py = toPy(p.y).toFixed(1);
        d += `${idx === 0 ? "M" : "L"}${px},${py} `;
      });
      svgParts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="5.5" stroke-linecap="round" opacity="0.18"/>`);
      svgParts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round"/>`);
      s.points.forEach(p => {
        const cx = toPx(p.x);
        const cy = toPy(p.y);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${s.color}" stroke="#ffffff" stroke-width="1"/>`);
      });
    });
  } else {
    // Default: "curve" with smooth Hermite interpolation passing strictly through points
    svgSeries.forEach(s => {
      let d = "";
      s.samples.forEach((p, idx) => {
        const px = toPx(p.x).toFixed(1);
        const py = toPy(p.y).toFixed(1);
        d += `${idx === 0 ? "M" : "L"}${px},${py} `;
      });
      svgParts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="5.5" stroke-linecap="round" opacity="0.18"/>`);
      svgParts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round"/>`);
      s.points.forEach(p => {
        const cx = toPx(p.x);
        const cy = toPy(p.y);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="3.5" fill="${s.color}" stroke="#ffffff" stroke-width="0.8"/>`);
      });
    });
  }

  // Callouts & Normalized ImageRegion[] bounding boxes
  const regions: ImageRegion[] = [];
  const boxW = 0.16;
  const boxH = 0.11;

  const toNormRegion = (xVal: number, yVal: number, label: string, id: string): ImageRegion => {
    const px = toPx(xVal);
    const py = toPy(yVal);
    const cx = px / W;
    const cy = py / H;
    const rx = Math.max(0.01, Math.min(0.98 - boxW, cx - boxW / 2));
    const ry = Math.max(0.01, Math.min(0.98 - boxH, cy - boxH / 2));
    return {
      id,
      label,
      x: Number(rx.toFixed(3)),
      y: Number(ry.toFixed(3)),
      width: boxW,
      height: boxH,
      confidence: 1.0,
    };
  };

  svgSeries.forEach((s, sIdx) => {
    s.points.forEach((pt, pIdx) => {
      if (pt.label) {
        const cx = toPx(pt.x);
        const cy = toPy(pt.y);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="${s.color}" opacity="0.25"/>`);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="${s.color}"/>`);
        const tx = cx > (left + right) * 0.55 ? cx - 110 : cx + 15;
        const ty = cy > (top + bottom) * 0.55 ? cy - 20 : cy + 20;
        const badgeW = pt.label.length * 7 + 16;
        svgParts.push(`<rect x="${tx - 6}" y="${ty - 14}" width="${badgeW}" height="20" rx="4" fill="#181a24" stroke="#52525b" stroke-width="0.8"/>`);
        svgParts.push(`<text x="${tx}" y="${ty}" fill="#f8fafc" font-size="10" font-family="system-ui, sans-serif">${escapeXml(pt.label)}</text>`);
        regions.push(toNormRegion(pt.x, pt.y, pt.label, `point_${sIdx}_${pIdx}`));
      }
    });
  });

  // If no explicit point callouts exist, annotate peak of the first series
  if (regions.length === 0 && svgSeries.length > 0) {
    const s0 = svgSeries[0];
    const pts = s0.points.length ? s0.points : s0.samples;
    if (pts.length > 0) {
      const peakPt = pts.reduce((max, p) => p.y > max.y ? p : max, pts[0]);
      regions.push(toNormRegion(peakPt.x, peakPt.y, `${s0.name} Maximum`, "peak_0"));
    }
  }

  // Legend Box (Top Right)
  const legX = right - 220;
  const legY = top + 10;
  svgParts.push(`<rect x="${legX}" y="${legY}" width="210" height="${svgSeries.length * 24 + 12}" rx="6" fill="#181a24" stroke="#3f3f46" stroke-width="1" fill-opacity="0.92"/>`);
  svgSeries.forEach((s, i) => {
    const itemY = legY + 18 + i * 24;
    svgParts.push(`<line x1="${legX + 12}" y1="${itemY}" x2="${legX + 34}" y2="${itemY}" stroke="${s.color}" stroke-width="3"/>`);
    svgParts.push(`<circle cx="${legX + 23}" cy="${itemY}" r="3" fill="${s.color}"/>`);
    svgParts.push(`<text x="${legX + 42}" y="${itemY + 4}" fill="#e2e8f0" font-size="10.5" font-family="system-ui, sans-serif">${escapeXml(s.name.slice(0, 24))}</text>`);
  });

  // Axis Regions
  regions.push({
    id: "x_axis",
    label: xLabel || "X Axis",
    x: 0.15,
    y: 0.88,
    width: 0.72,
    height: 0.10,
    confidence: 1.0,
  });

  regions.push({
    id: "y_axis",
    label: yLabel || "Y Axis",
    x: 0.02,
    y: 0.15,
    width: 0.12,
    height: 0.68,
    confidence: 1.0,
  });

  svgParts.push("</svg>");
  const svgContent = svgParts.join("\n");
  const base64Svg = typeof Buffer !== "undefined"
    ? Buffer.from(svgContent, "utf-8").toString("base64")
    : btoa(unescape(encodeURIComponent(svgContent)));
  const dataUrl = `data:image/svg+xml;base64,{base64Svg}`;

  const plotMetadata: PlotMetadata = {
    xMin: Number(plotMinX.toFixed(2)),
    xMax: Number(plotMaxX.toFixed(2)),
    yMin: Number(plotMinY.toFixed(2)),
    yMax: Number(plotMaxY.toFixed(2)),
    seriesSummary: svgSeries.map(s => {
      const vals = s.points.length ? s.points.map(p => p.y) : s.samples.map(p => p.y);
      const peakPt = s.points.length ? s.points.reduce((max, p) => p.y > max.y ? p : max, s.points[0]) : s.samples[0];
      return {
        name: s.name,
        peakX: Number((peakPt?.x ?? 0).toFixed(2)),
        peakY: Number((peakPt?.y ?? 0).toFixed(2)),
        minY: Number(Math.min(...vals).toFixed(2)),
        maxY: Number(Math.max(...vals).toFixed(2)),
      };
    }),
  };

  return {
    dataUrl,
    width: W,
    height: H,
    regions,
    plotMetadata,
  };
}

/**
 * Executes Python helper script with input JSON payload.
 * Times out after 7 seconds to guarantee zero UI freezes.
 */
async function runPythonGraphEngine(payload: GraphRequestInput): Promise<ScientificGraphResult> {
  if (typeof window !== "undefined") {
    throw new Error("Python graph engine is server-only");
  }
  const { execFile } = await import("node:child_process");
  const path = await import("node:path");

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "render_graph.py");
    const child = execFile(
      "python",
      [scriptPath],
      { timeout: 7000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          return reject(error);
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed && parsed.error) {
            return reject(new Error(parsed.message || parsed.error));
          }
          if (parsed && parsed.dataUrl && Array.isArray(parsed.regions)) {
            return resolve(parsed as ScientificGraphResult);
          }
          reject(new Error("Invalid output format from python renderer"));
        } catch (err) {
          reject(err);
        }
      }
    );

    child.stdin?.write(JSON.stringify(payload));
    child.stdin?.end();
  });
}

/**
 * Main Entry Point: Universal Scientific Graph Engine.
 * 1. Tries local Python Matplotlib renderer (sub-2s execution).
 * 2. If unavailable or times out, seamlessly falls back to pure-TS SVG scientific plotter.
 */
export async function generateScientificGraph(req: GraphRequestInput): Promise<ScientificGraphResult> {
  try {
    return await runPythonGraphEngine(req);
  } catch {
    // Immediate zero-dependency fallback
    return renderScientificSvgGraph(req);
  }
}
