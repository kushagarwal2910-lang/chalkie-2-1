import test from "node:test";
import assert from "node:assert/strict";
import { compileExpression, compilePlot, plotSpecSchema, type PlotSpec } from "./plot-tool.ts";
import { attachPlot, createDirectPlotLesson, localGraphEvidence, parseDirectPlot } from "./plot-lesson.ts";
import { computeTargetPositions } from "./target-matcher.ts";
import { resolveTeachingTarget } from "./teaching-focus.ts";

const spec = (overrides: Partial<PlotSpec>) => plotSpecSchema.parse({ kind: "bar", title: "Sample", xLabel: "Category", yLabel: "Value", provenance: "user", series: [{ name: "Values", points: [{ x: 0, y: -10, label: "A" }, { x: 1, y: 0, label: "B" }, { x: 2, y: 20, label: "C" }] }], ...overrides });
test("local graph inputs remain available to follow-up narration without web research", () => {
  const lesson = createDirectPlotLesson("Chart A: -10, B: 0, C: 20", spec({}));
  const evidence = localGraphEvidence(lesson);
  assert.equal(evidence.sources.length, 1);
  assert.match(evidence.context, /\"y\":-10/);
  assert.match(evidence.context, /\"y\":20/);
  assert.match(evidence.context, /hypothetical, not measured/);
  lesson.objects[0].plot!.provenance = "sourced";
  assert.equal(localGraphEvidence(lesson).sources.length, 0, "Measured plots keep their original external evidence requirements");
});
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const dataPath = (svg: string) => [...svg.matchAll(/<path [^>]+>/g)].map(match => attributes(match[0])).find(attrs => attrs["clip-path"] === "url(#plot)" && attrs["stroke-width"] === "3")?.d ?? "";

test("expression arithmetic follows exponent and unary precedence without executing code", () => {
  assert.equal(compileExpression("-x^2")(3), -9);
  assert.equal(compileExpression("2^3^2")(0), 512);
  assert.equal(compileExpression("x^-2")(2), .25);
  assert.ok(Math.abs(compileExpression("SIN(pi / 2) + 1E2")(0) - 101) < 1e-9);
  for (const unsafe of ["process.exit()", "constructor(x)", "toString(x)", "x;alert(1)", "Math.sin(x)", "x[0]", "x=>x", "x +"]) assert.throws(() => compileExpression(unsafe));
});

test("bar geometry has a shared zero baseline and preserves negative and zero values", () => {
  const { svg } = compilePlot(spec({}));
  const bars = [...svg.matchAll(/<rect [^>]+>/g)].map(match => attributes(match[0])).filter(attrs => attrs.fill === "#67e8f9");
  assert.equal(bars.length, 3);
  const negative = bars[0], zero = bars[1], positive = bars[2];
  assert.equal(Number(zero.height), 0);
  assert.ok(Math.abs(Number(positive.height) / Number(negative.height) - 2) < 1e-9);
  assert.ok(Math.abs(Number(negative.y) - (Number(positive.y) + Number(positive.height))) < 1e-9);
  assert.equal(negative.y, zero.y);
});

test("irregular numerical bar positions do not produce overlapping bars", () => {
  const { svg } = compilePlot(spec({ series: [{ name: "Data", points: [{ x: 0, y: 1, label: "A" }, { x: 0.01, y: 2, label: "B" }, { x: 1000, y: 3, label: "C" }] }] }));
  const bars = [...svg.matchAll(/<rect [^>]+>/g)].map(match => attributes(match[0])).filter(attrs => attrs.fill === "#67e8f9");
  assert.ok(Number(bars[0].x) + Number(bars[0].width) < Number(bars[1].x));
});

test("force vectors preserve equal physical scale and agree with grid tick values", () => {
  const { svg } = compilePlot(spec({ kind: "forces", provenance: "formula", series: [], vectors: [{ label: "Right", x: 0, y: 0, dx: 10, dy: 0 }, { label: "Up", x: 0, y: 0, dx: 0, dy: 10 }] }));
  const vectors = [...svg.matchAll(/<path [^>]+>/g)].map(match => attributes(match[0])).filter(attrs => attrs["marker-end"] === "url(#arrow)").map(attrs => attrs.d.match(/M([^,]+),([^L]+)L([^,]+),(.+)/)!.slice(1).map(Number));
  assert.equal(vectors.length, 2);
  assert.ok(Math.abs((vectors[0][2] - vectors[0][0]) - (vectors[1][1] - vectors[1][3])) < 1e-9);
  const xmin = Number(svg.match(/<text x="105" y="471"[^>]*>([^<]+)</)![1]);
  const xmax = Number(svg.match(/<text x="850" y="471"[^>]*>([^<]+)</)![1]);
  const expectedOrigin = 105 + (0 - xmin) / (xmax - xmin) * (850 - 105);
  // Tick labels are rounded for display, so allow one pixel of display-rounding error.
  assert.ok(Math.abs(expectedOrigin - vectors[0][0]) < 1);
});

test("math curves break at odd and even singularities instead of drawing across poles", () => {
  for (const expression of ["1/(x-0.13)", "1/(x-0.13)^2", "tan(x)"]) {
    const { svg } = compilePlot(spec({ kind: "curve", provenance: "formula", expression, domain: [-2, 2], series: [] }));
    assert.ok((dataPath(svg).match(/M/g) ?? []).length >= 2, expression);
    assert.equal(/NaN|Infinity/.test(svg), false);
  }
  const smooth = compilePlot(spec({ kind: "curve", provenance: "formula", expression: "x^3", domain: [-2, 2], series: [] }));
  assert.equal((dataPath(smooth.svg).match(/M/g) ?? []).length, 1);
});

test("timeline series regions cover the rendered event line", () => {
  const { regions } = compilePlot(spec({ kind: "timeline", series: [{ name: "Events", points: [{ x: 1900, y: -100, label: "First" }, { x: 2000, y: 1000, label: "Second" }] }] }));
  const series = regions.find(region => region.id === "series_0")!;
  assert.ok(Math.abs((series.y + series.height / 2) * 580 - 270) < 1e-9);
  assert.ok(series.height * 580 <= 17);
});

test("all compiled targets have normalized bounds and resolve to the rendered graph", () => {
  const plot = spec({});
  const lesson = createDirectPlotLesson("Graph A: -10, B: 0, C: 20", plot);
  for (const region of lesson.objects[0].image!.regions) {
    assert.ok(region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0);
    assert.ok(region.x + region.width <= 1.00001 && region.y + region.height <= 1.00001);
    assert.ok(resolveTeachingTarget(`graph#${region.id}`, lesson.objects), region.label);
  }
  const segment = lesson.segments[0];
  const cues = computeTargetPositions(segment.narration, segment.targetIds, lesson.objects, [], segment.cues);
  assert.equal(cues.filter(cue => cue.cue?.kind === "circle").length, 3);
});

test("SVG output is deterministic and escapes untrusted labels", () => {
  const plot = spec({ title: '<script>alert("hello")</script>' });
  const first = compilePlot(plot), second = compilePlot(plot);
  assert.deepEqual(first, second);
  assert.ok(first.svg.includes("&lt;script&gt;"));
  assert.equal(first.svg.includes("<script>"), false);
});

test("direct formulas and supplied data are parsed locally, including negative numeric x", () => {
  const curve = parseDirectPlot("Plot y = sin(x) from -3 to 3");
  assert.equal(curve?.kind, "curve");
  assert.deepEqual(curve?.domain, [-3, 3]);
  const data = parseDirectPlot("scatter -1: 2, 0: 3, 1: 4");
  assert.equal(data?.kind, "scatter");
  assert.deepEqual(data?.series[0].points.map(point => point.x), [-1, 0, 1]);
  assert.equal(parseDirectPlot("explain a cell"), null);
});

test("a sourced plot cannot cite nonexistent lesson sources", () => {
  const plot = spec({ provenance: "sourced", sourceIds: ["missing"] });
  const object = createDirectPlotLesson("Graph data", spec({})).objects[0];
  object.plot = plot;
  assert.throws(() => attachPlot(object, ["actual"]), /source/);
});
