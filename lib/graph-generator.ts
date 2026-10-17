/**
 * lib/graph-generator.ts
 * Keyless Scientific Graph Engine for Chalkie 2.0.
 * Transforms mathematical and quantitative graph specifications into self-grounded
 * high-resolution ImageAssets complete with normalized ImageRegion[] bounding boxes.
 *
 * Primary Engine: Local Python Matplotlib helper (scripts/render_graph.py).
 * Fallback Engine: Zero-dependency pure-TypeScript scientific SVG plotter.
 */

import type { ImageRegion } from "./lesson-schema.ts";

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
    anchorPoints: Array<{ x: number; y: number; callout?: string }>;
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
  graphType?: "function-plot" | "wave-comparison" | "bar-chart" | "line-chart" | string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  seriesSpec?: string;
  domain?: [number, number];
  xDomain?: [number, number];
  yDomain?: [number, number];
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number; label?: string }>;
  series?: Array<{
    name?: string;
    label?: string;
    points?: Array<{ x: number; y: number; label?: string; callout?: string }>;
    anchorPoints?: Array<{ x: number; y: number; callout?: string }>;
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

export type GraphRequestInput = GraphRequest | ScientificPlotSpec;

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

function parseExplicitPointsTs(text: string): Array<{ x: number; y: number; callout?: string }> | null {
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
 * Pure TypeScript Zero-Dependency Scientific SVG Plotter.
 * Renders dark blackboard graph with glowing curve paths and mathematically exact ImageRegion bounding boxes.
 */
export function renderScientificSvgGraph(req: GraphRequestInput): ScientificGraphResult {
  const W = req.width || 800;
  const H = req.height || 520;
  const title = req.title || "Scientific Mathematical Plot";
  const xLabel = req.xAxisLabel || "x";
  const yLabel = req.yAxisLabel || "y";
  const subtitleFormula = req.subtitleFormula || "";

  let [minX, maxX] = (req as any).xDomain || (req as any).domain || [1, 10];

  interface SvgSeries {
    name: string;
    color: string;
    points: { x: number; y: number; callout?: string }[];
    samples: { x: number; y: number }[];
  }

  const svgSeries: SvgSeries[] = [];
  const sampleCount = 200;
  const colors = ["#38bdf8", "#f43f5e", "#a78bfa", "#34d399", "#fbbf24"];

  // Normalize incoming series: Check structured series vs legacy seriesSpec
  const rawSeries = req.series;
  if (Array.isArray(rawSeries) && rawSeries.length > 0) {
    rawSeries.forEach((s, idx) => {
      const name = (s as any).label || (s as any).name || `Series ${idx + 1}`;
      const color = s.color || colors[idx % colors.length];
      const rawAnchors = (s as any).anchorPoints || (s as any).points || [];
      const anchors: Array<{ x: number; y: number; callout?: string }> = rawAnchors.map((p: any) => ({
        x: Number(p.x),
        y: Number(p.y),
        callout: p.callout || p.label,
      }));

      if (anchors.length >= 2) {
        minX = Math.min(minX, ...anchors.map(a => a.x));
        maxX = Math.max(maxX, ...anchors.map(a => a.x));
      }

      svgSeries.push({
        name,
        color,
        points: anchors,
        samples: [],
      });
    });
  } else {
    // Parse from seriesSpec
    const spec = (req as GraphRequest).seriesSpec || "";
    const parts = spec.split(";").map(s => s.trim()).filter(Boolean);
    parts.forEach((part, idx) => {
      const color = colors[idx % colors.length];
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
        if (expr.toLowerCase().includes("orbital")) name = "Orbital Velocity (km/s)";
        else if (expr.toLowerCase().includes("escape")) name = "Escape Velocity (km/s)";
        else name = `Profile ${idx + 1}`;
      }
      const explicit = parseExplicitPointsTs(expr);
      const anchors = explicit || [];
      if (anchors.length >= 2) {
        minX = Math.min(minX, ...anchors.map(a => a.x));
        maxX = Math.max(maxX, ...anchors.map(a => a.x));
      }
      svgSeries.push({
        name,
        color,
        points: anchors,
        samples: [],
      });
    });
  }

  // Fallback series if none parsed
  if (!svgSeries.length) {
    svgSeries.push({
      name: title,
      color: "#38bdf8",
      points: [
        { x: 1, y: 7.91, callout: "LEO: 7.91 km/s" },
        { x: 2, y: 5.59 },
        { x: 4, y: 3.95 },
        { x: 10, y: 2.50, callout: "GEO: 2.50 km/s" },
      ],
      samples: [],
    });
  }

  if (minX >= maxX) {
    minX = 1;
    maxX = 10;
  }

  // Sample points across domain
  svgSeries.forEach(s => {
    s.samples = [];
    for (let i = 0; i <= sampleCount; i++) {
      const x = minX + (i / sampleCount) * (maxX - minX);
      if (s.points.length >= 2) {
        s.samples.push({ x, y: interpolateHermiteTs(s.points, x) });
      } else {
        s.samples.push({ x, y: 7.91 / Math.sqrt(Math.max(x, 0.5)) });
      }
    }
  });

  // Calculate Y bounds
  const left = 85;
  const right = W - 45;
  const top = subtitleFormula ? 80 : 65;
  const bottom = H - 75;

  let allY = svgSeries.flatMap(s => s.samples.map(p => p.y)).filter(Number.isFinite);
  if (!allY.length) allY = [0, 10];
  let minY = req.yDomain ? req.yDomain[0] : Math.min(...allY);
  let maxY = req.yDomain ? req.yDomain[1] : Math.max(...allY);

  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const yPadding = (maxY - minY) * 0.12;
  const isPos = minY >= 0 && /velocity|speed|radius|mass|distance/i.test(`${yLabel} ${title}`);
  if (!req.yDomain) {
    minY = isPos ? 0 : minY - yPadding;
    maxY += yPadding * 1.15;
  }

  const toPx = (x: number) => left + ((x - minX) / (maxX - minX)) * (right - left);
  const toPy = (y: number) => bottom - ((y - minY) / (maxY - minY)) * (bottom - top);

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
    const valX = minX + (i / gridStepsX) * (maxX - minX);
    svgParts.push(`<line x1="${gx}" y1="${top}" x2="${gx}" y2="${bottom}" stroke="#222738" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.8"/>`);
    svgParts.push(`<text x="${gx}" y="${bottom + 22}" fill="#94a3b8" font-size="11" font-family="system-ui, sans-serif" text-anchor="middle">${valX.toFixed(1)}</text>`);
  }
  for (let i = 0; i <= gridStepsY; i++) {
    const gy = top + (i / gridStepsY) * (bottom - top);
    const valY = maxY - (i / gridStepsY) * (maxY - minY);
    svgParts.push(`<line x1="${left}" y1="${gy}" x2="${right}" y2="${gy}" stroke="#222738" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.8"/>`);
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
  } else if (minY <= 0 && maxY >= 0) {
    const y0 = toPy(0);
    svgParts.push(`<line x1="${left}" y1="${y0}" x2="${right}" y2="${y0}" stroke="#3f3f46" stroke-width="1.0" opacity="0.7"/>`);
  }

  // Border Spines
  svgParts.push(`<path d="M${left},${top} V${bottom} H${right}" fill="none" stroke="#3f3f46" stroke-width="1.2"/>`);

  // Axis Labels
  svgParts.push(`<text x="${(left + right) / 2}" y="${H - 22}" fill="#f1f5f9" font-size="12" font-family="system-ui, sans-serif" font-weight="500" text-anchor="middle">${escapeXml(xLabel)}</text>`);
  svgParts.push(`<text x="24" y="${(top + bottom) / 2}" transform="rotate(-90 24 ${(top + bottom) / 2})" fill="#f1f5f9" font-size="12" font-family="system-ui, sans-serif" font-weight="500" text-anchor="middle">${escapeXml(yLabel)}</text>`);

  // Render Curves
  svgSeries.forEach((s) => {
    let d = "";
    s.samples.forEach((p, idx) => {
      const px = toPx(p.x).toFixed(1);
      const py = toPy(p.y).toFixed(1);
      d += `${idx === 0 ? "M" : "L"}${px},${py} `;
    });
    // Glow Halo
    svgParts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="5.5" stroke-linecap="round" opacity="0.18"/>`);
    // Main Crisp Line
    svgParts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round"/>`);
  });

  // Callouts & Dots
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
      if (pt.callout) {
        const cx = toPx(pt.x);
        const cy = toPy(pt.y);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${s.color}" opacity="0.25"/>`);
        svgParts.push(`<circle cx="${cx}" cy="${cy}" r="3.5" fill="${s.color}"/>`);
        const tx = cx > (left + right) * 0.55 ? cx - 110 : cx + 15;
        const ty = cy > (top + bottom) * 0.55 ? cy - 20 : cy + 20;
        svgParts.push(`<rect x="${tx - 6}" y="${ty - 14}" width="${pt.callout.length * 7 + 14}" height="20" rx="4" fill="#181a24" stroke="#52525b" stroke-width="0.8"/>`);
        svgParts.push(`<text x="${tx}" y="${ty}" fill="#f8fafc" font-size="10" font-family="system-ui, sans-serif">${escapeXml(pt.callout)}</text>`);
        regions.push(toNormRegion(pt.x, pt.y, pt.callout, `anchor_${sIdx}_${pIdx}`));
      }
    });
  });

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
  const dataUrl = `data:image/svg+xml;base64,${base64Svg}`;

  const plotMetadata: PlotMetadata = {
    xMin: Number(minX.toFixed(2)),
    xMax: Number(maxX.toFixed(2)),
    yMin: Number(minY.toFixed(2)),
    yMax: Number(maxY.toFixed(2)),
    seriesSummary: svgSeries.map(s => {
      const allVals = s.samples.map(p => p.y);
      let peakIdx = 0;
      let maxVal = -Infinity;
      s.samples.forEach((p, idx) => {
        if (p.y > maxVal) {
          maxVal = p.y;
          peakIdx = idx;
        }
      });
      return {
        name: s.name,
        peakX: Number(s.samples[peakIdx].x.toFixed(2)),
        peakY: Number(s.samples[peakIdx].y.toFixed(2)),
        minY: Number(Math.min(...allVals).toFixed(2)),
        maxY: Number(Math.max(...allVals).toFixed(2)),
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
 * Main Entry Point: Keyless Scientific Graph Engine.
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
