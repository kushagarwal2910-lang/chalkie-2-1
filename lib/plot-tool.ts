import { z } from "zod";

const finite = z.number().finite().min(-1e12).max(1e12);
const pointSchema = z.object({ x: finite, y: finite, label: z.string().max(80).default("") });
export const plotSpecSchema = z.object({
  kind: z.enum(["bar", "line", "scatter", "curve", "forces", "timeline"]),
  title: z.string().min(1).max(120), xLabel: z.string().max(80), yLabel: z.string().max(80),
  provenance: z.enum(["sourced", "user", "illustrative", "formula"]),
  sourceIds: z.array(z.string().max(80)).max(8).default([]),
  series: z.array(z.object({ name: z.string().min(1).max(80), points: z.array(pointSchema).max(100) })).max(5).default([]),
  expression: z.string().max(160).default(""),
  domain: z.tuple([finite, finite]).default([-5, 5]),
  vectors: z.array(z.object({ label: z.string().min(1).max(80), x: finite, y: finite, dx: finite, dy: finite })).max(12).default([]),
  plotMetadata: z.any().optional(),
  xMin: z.number().optional(),
  xMax: z.number().optional(),
  yMin: z.number().optional(),
  yMax: z.number().optional(),
  seriesSummary: z.array(z.any()).optional(),
}).passthrough().superRefine((plot, ctx) => {
  if (plot.domain[0] >= plot.domain[1]) ctx.addIssue({ code: "custom", message: "Plot domain must increase" });
  if (plot.kind === "curve" && !plot.expression) ctx.addIssue({ code: "custom", message: "A curve needs an expression" });
  if (plot.kind === "forces" && !plot.vectors.length) ctx.addIssue({ code: "custom", message: "A force diagram needs vectors" });
  if (!["curve", "forces"].includes(plot.kind) && !plot.series.some(s => s.points.length)) ctx.addIssue({ code: "custom", message: "A graph needs data" });
  if (plot.provenance === "sourced" && !plot.sourceIds.length) ctx.addIssue({ code: "custom", message: "Measured data requires source IDs" });
});
export type PlotSpec = z.infer<typeof plotSpecSchema>;
export type PlotRegion = { id: string; label: string; x: number; y: number; width: number; height: number; confidence: number };

const jsonObject = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const string = { type: "string" }, number = { type: "number" };
export const plotJsonSchema = jsonObject({
  kind: { type: "string", enum: ["bar", "line", "scatter", "curve", "forces", "timeline"] }, title: string, xLabel: string, yLabel: string,
  provenance: { type: "string", enum: ["sourced", "user", "illustrative", "formula"] },
  sourceIds: { type: "array", items: string, maxItems: 8 },
  series: { type: "array", maxItems: 5, items: jsonObject({ name: string, points: { type: "array", maxItems: 100, items: jsonObject({ x: number, y: number, label: string }) } }) },
  expression: string, domain: { type: "array", minItems: 2, maxItems: 2, items: number },
  vectors: { type: "array", maxItems: 12, items: jsonObject({ label: string, x: number, y: number, dx: number, dy: number }) },
});

/** Small arithmetic parser. No eval, JavaScript, property access, or model-written drawing code. */
/** Small arithmetic parser. No eval, JavaScript, property access, or model-written drawing code. */
export function compileExpression(expression: string): (x: number) => number {
  let input = expression.replace(/\s/g, "").replace(/²/g, "^2").replace(/³/g, "^3").toLowerCase();
  input = input.replace(/^[a-z_]\w*(?:\([^)]*\))?=/, "");

  // Alias single-letter domain variables (e.g. M, t, r, v, f) to x if x is not present
  if (!/\bx\b/.test(input)) {
    const varMatch = input.match(/\b([mtrfvzk])\b/);
    if (varMatch) input = input.replace(new RegExp(`\\b${varMatch[1]}\\b`, "g"), "x");
  }

  if (!input || input.length > 160) throw new Error("Invalid expression");
  const tokens = input.match(/(?:\d*\.)?\d+(?:e[+-]?\d+)?|[A-Za-z]+|[()+\-*/^]/g) ?? [];
  if (tokens.join("") !== input || tokens.length > 100) throw new Error("Unsupported expression; use arithmetic, x, sin, cos, tan, sqrt, abs, log, or exp");
  let index = 0;
  type Fn = (x: number) => number;
  const functions: Record<string, Fn> = { sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, log: Math.log, exp: Math.exp };
  function atom(): Fn {
    const token = tokens[index++];
    if (token === "(") { const fn = sum(); if (tokens[index++] !== ")") throw new Error("Unclosed expression"); return fn; }
    if (token === "x" || token === "m" || token === "t" || token === "r") return x => x;
    if (token === "g") return () => 6.6743e-11;
    if (token === "c") return () => 2.99792e8;
    if (token === "pi") return () => Math.PI;
    if (token === "e") return () => Math.E;
    if (Object.hasOwn(functions, token)) { if (tokens[index++] !== "(") throw new Error("Functions require parentheses"); const arg = sum(); if (tokens[index++] !== ")") throw new Error("Unclosed function"); return x => functions[token](arg(x)); }
    if (token && /^\d|^\.\d/.test(token)) return () => Number(token);
    throw new Error("Unsupported expression token");
  }
  function power(): Fn { const left = atom(); if (tokens[index] === "^") { index++; const right = unary(); return x => left(x) ** right(x); } return left; }
  function unary(): Fn { if (tokens[index] === "+") { index++; return unary(); } if (tokens[index] === "-") { index++; const right = unary(); return x => -right(x); } return power(); }
  function product(): Fn { let left = unary(); while (["*", "/"].includes(tokens[index])) { const op = tokens[index++], a = left, b = unary(); left = x => op === "*" ? a(x) * b(x) : a(x) / b(x); } return left; }
  function sum(): Fn { let left = product(); while (["+", "-"].includes(tokens[index])) { const op = tokens[index++], a = left, b = product(); left = x => op === "+" ? a(x) + b(x) : a(x) - b(x); } return left; }
  const fn = sum(); if (index !== tokens.length) throw new Error("Unexpected expression token"); return fn;
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const colors = ["#67e8f9", "#c4b5fd", "#fbbf24", "#6ee7b7", "#fda4af"];
const W = 900, H = 580, left = 105, right = 850, top = 95, bottom = 445;
const numeric = (n: number) => Number(n.toPrecision(4)).toString();

/** Pure TypeScript compiler: identical inputs always produce identical pixels and target regions. */
export function compilePlot(raw: PlotSpec): { svg: string; regions: PlotRegion[]; description: string; width: number; height: number } {
  const spec = plotSpecSchema.parse(raw);
  const series = spec.kind === "forces" ? [] : spec.series.map(s => ({ ...s, points: [...s.points] }));
  let expression: ((x: number) => number) | undefined;
  if (spec.kind === "curve") {
    const fn = compileExpression(spec.expression);
    expression = fn;
    series.splice(0, series.length, { name: spec.expression, points: Array.from({ length: 241 }, (_, i) => { const x = spec.domain[0] + i / 240 * (spec.domain[1] - spec.domain[0]); return { x, y: fn(x), label: "" }; }) });
  }
  const points = series.flatMap(s => s.points).filter(p => Number.isFinite(p.y) && Math.abs(p.y) <= 1e12);
  if (spec.kind === "forces") for (const v of spec.vectors) points.push({ x: v.x, y: v.y, label: "" }, { x: v.x + v.dx, y: v.y + v.dy, label: "" });
  if (!points.length) throw new Error("No finite points in the plot domain");
  const bars = spec.kind === "bar", timeline = spec.kind === "timeline";
  let xmin = Math.min(...points.map(p => p.x)), xmax = Math.max(...points.map(p => p.x));
  let ymin = Math.min(...points.map(p => p.y), ...(bars ? [0] : [])), ymax = Math.max(...points.map(p => p.y), ...(bars ? [0] : []));
  if (spec.kind === "curve") { xmin = spec.domain[0]; xmax = spec.domain[1]; }

  // Domain-agnostic flatline guard
  if (Math.abs(ymax - ymin) < 1e-4 || (ymin === 0 && ymax === 0)) {
    ymin -= 1.0;
    ymax += 1.0;
  }

  if (xmin === xmax) { xmin -= 1; xmax += 1; } if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const uniqueX = [...new Set(points.map(p => p.x))].sort((a, b) => a - b);
  const smallestXGap = uniqueX.length > 1 ? Math.min(...uniqueX.slice(1).map((x, i) => x - uniqueX[i])) : 1;
  if (bars) { xmin -= smallestXGap * .6; xmax += smallestXGap * .6; }
  if (spec.kind === "forces") {
    const d = Math.max(xmax - xmin, ymax - ymin) * .15; xmin -= d; xmax += d; ymin -= d; ymax += d;
    // Expand the domain instead of shrinking just the geometry: ticks then share the vector transform.
    const aspect = (right - left) / (bottom - top);
    if ((xmax - xmin) / (ymax - ymin) < aspect) {
      const center = (xmax + xmin) / 2, half = (ymax - ymin) * aspect / 2; xmin = center - half; xmax = center + half;
    } else {
      const center = (ymax + ymin) / 2, half = (xmax - xmin) / aspect / 2; ymin = center - half; ymax = center + half;
    }
  }
  let sx = (right - left) / (xmax - xmin), sy = (bottom - top) / (ymax - ymin);
  if (spec.kind === "forces") sx = sy = Math.min(sx, sy); // identical physical scale on both axes
  const ox = left + ((right - left) - (xmax - xmin) * sx) / 2, oy = bottom - ((bottom - top) - (ymax - ymin) * sy) / 2;
  const px = (x: number) => ox + (x - xmin) * sx, py = (y: number) => oy - (y - ymin) * sy;
  const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="#67e8f9"/></marker></defs><rect width="900" height="580" rx="18" fill="#111827"/>`];
  const text = (x: number, y: number, value: string, size = 17, color = "#e2e8f0", anchor = "middle") => svg.push(`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Arial, sans-serif" text-anchor="${anchor}">${escape(value)}</text>`);
  text(450, 39, spec.title, 24); text(450, 65, spec.provenance === "illustrative" ? "Illustrative data — not measured" : spec.provenance === "formula" ? `Computed: ${spec.expression || "vector geometry"}` : spec.provenance === "user" ? "From your supplied data" : `Sources: ${spec.sourceIds.join(", ")}`, 14, "#94a3b8");
  const regions: PlotRegion[] = [];
  const region = (id: string, label: string, x: number, y: number, w: number, h: number) => {
    x = Math.max(0, Math.min(W - 2, x)); y = Math.max(0, Math.min(H - 2, y));
    regions.push({ id, label, x: x / W, y: y / H, width: Math.max(2, Math.min(W - x, w)) / W, height: Math.max(2, Math.min(H - y, h)) / H, confidence: 1 });
  };
  for (let i = 0; i <= 5; i++) {
    const x = left + i / 5 * (right - left), y = top + i / 5 * (bottom - top);
    svg.push(`<path d="M${x},${top}V${bottom} M${left},${y}H${right}" stroke="#334155" stroke-width="1"/>`);
    if (!bars) text(x, bottom + 26, numeric(xmin + i / 5 * (xmax - xmin)), 14);
    if (!timeline) text(left - 14, y + 5, numeric(ymax - i / 5 * (ymax - ymin)), 14, "#cbd5e1", "end");
  }
  svg.push(`<path d="M${left},${top}V${bottom}H${right}" fill="none" stroke="#94a3b8" stroke-width="2"/>`);
  text(480, 520, spec.xLabel, 18); svg.push(`<text x="26" y="280" transform="rotate(-90 26 280)" fill="#e2e8f0" font-size="18" font-family="Arial" text-anchor="middle">${escape(spec.yLabel)}</text>`);
  region("x_axis", spec.xLabel || "Horizontal axis", left, bottom, right-left, 80); region("y_axis", spec.yLabel || "Vertical axis", 8, top, 90, bottom-top);
  series.forEach((s, si) => {
    const color = colors[si % colors.length];
    if (!bars && !timeline && spec.kind !== "scatter") {
      let path = "", previous: { x: number; y: number; dataX: number; dataY: number } | undefined;
      for (const p of s.points) {
        if (!Number.isFinite(p.y) || Math.abs(p.y) > 1e12) { previous = undefined; continue; }
        const x = px(p.x), y = py(p.y);
        let discontinuity = false;
        if (expression && previous) {
          // Refine sign changes: a true root approaches zero; a pole diverges under bisection.
          let a = previous.dataX, b = p.x, fa = previous.dataY, fb = p.y;
          const initialMagnitude = Math.max(1, Math.abs(fa), Math.abs(fb));
          if (Math.sign(fa) !== Math.sign(fb) && fa !== 0 && fb !== 0) {
            for (let depth = 0; depth < 14; depth++) {
              const mid = (a + b) / 2, value = expression(mid);
              if (!Number.isFinite(value) || Math.abs(value) > initialMagnitude * 8) { discontinuity = true; break; }
              if (Math.abs(value) < Math.min(Math.abs(previous.dataY), Math.abs(p.y)) * .05) break;
              if (Math.sign(value) === Math.sign(fa)) { a = mid; fa = value; } else { b = mid; fb = value; }
            }
          } else {
            // Even-order poles do not change sign. Interior samples still expose their divergence.
            for (const fraction of [.125, .25, .375, .5, .625, .75, .875]) {
              const value = expression(previous.dataX + (p.x - previous.dataX) * fraction);
              if (!Number.isFinite(value) || Math.abs(value) > initialMagnitude * 8) { discontinuity = true; break; }
            }
          }
        }
        path += `${previous && !discontinuity ? "L" : "M"}${x.toFixed(3)},${y.toFixed(3)} `; previous = { x, y, dataX: p.x, dataY: p.y };
      }
      svg.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="3" clip-path="url(#plot)"/>`);
    }
    const valid = s.points.filter(p => Number.isFinite(p.y) && Math.abs(p.y) <= 1e12);
    valid.forEach((p, i) => {
      const x = px(p.x), y = timeline ? (top + bottom) / 2 : py(p.y), pointLabel = p.label || `${s.name}: ${numeric(p.x)}, ${numeric(p.y)}`;
      if (bars) {
        const width = Math.min(64, smallestXGap * sx / Math.max(1, series.length) * .65);
        const bx = x + (si - (series.length - 1) / 2) * width - width/2, by = Math.min(py(0), y), height = Math.abs(py(0)-y);
        svg.push(`<rect x="${bx}" y="${by}" width="${width}" height="${height}" fill="${color}" rx="3"/>`);
        if (p.y === 0) svg.push(`<path d="M${bx},${by}h${width}" stroke="${color}" stroke-width="1"/>`);
        if (si === 0) text(x, bottom + 25, (p.label || numeric(p.x)).slice(0, 17), 13);
        text(bx+width/2, p.y >= 0 ? by-8 : by+height+17, numeric(p.y), 13, color);
        if (i < 10) region(`series_${si}_point_${i}`, pointLabel, bx-4, by-4, width+8, height+8);
      } else if (timeline) {
        svg.push(`<path d="M${left},${y}H${right}" stroke="${color}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="7" fill="${color}"/>`);
        text(x, y + (i % 2 ? 48 : -27), p.label.slice(0, 24), 15); text(x, y + (i % 2 ? 70 : -48), numeric(p.x), 13, "#94a3b8");
        if (i < 10) region(`series_${si}_point_${i}`, pointLabel, x-20, y-20, 40, 40);
      } else if (spec.kind !== "curve" || i === 0 || i === valid.length-1 || i === Math.floor(valid.length/2)) {
        svg.push(`<circle cx="${x}" cy="${y}" r="5" fill="${color}" clip-path="url(#plot)"/>`);
        if (i < 10 || spec.kind === "curve") region(`series_${si}_point_${i}`, pointLabel, x-12, y-12, 24, 24);
      }
    });
    if (valid.length) {
      const ys = valid.map(p => timeline ? (top + bottom) / 2 : py(p.y)), xs = valid.map(p => px(p.x));
      region(`series_${si}`, s.name, Math.min(...xs)-8, Math.min(...ys)-8, Math.max(...xs)-Math.min(...xs)+16, Math.max(...ys)-Math.min(...ys)+16);
    }
    text(110 + si * 150, 553, s.name.slice(0, 20), 14, color, "start");
  });
  (spec.kind === "forces" ? spec.vectors : []).forEach((v, i) => {
    const x1=px(v.x), y1=py(v.y), x2=px(v.x+v.dx), y2=py(v.y+v.dy);
    svg.push(`<path d="M${x1},${y1}L${x2},${y2}" stroke="#67e8f9" stroke-width="4" marker-end="url(#arrow)"/>`);
    text((x1+x2)/2+10, (y1+y2)/2-14, v.label, 17, "#67e8f9");
    region(`vector_${i}`, v.label, Math.min(x1,x2)-12, Math.min(y1,y2)-12, Math.abs(x2-x1)+24, Math.abs(y2-y1)+24);
  });
  svg.push("</svg>");
  return { svg: svg.join(""), regions: regions.slice(0, 64), width: W, height: H, description: `${spec.kind}: ${spec.title}. ${spec.xLabel}; ${spec.yLabel}. ${spec.provenance} data. ${series.map(s=>`${s.name}: ${s.points.slice(0,10).map(p=>`${p.label || p.x}=${numeric(p.y)}`).join(", ")}`).join("; ")}`.slice(0,600) };
}
