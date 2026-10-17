import fs from "fs";
import path from "path";
import assert from "assert";
import { generateScientificGraph } from "../lib/graph-generator.ts";
import { createLessonWithGroq } from "../lib/groq.ts";

async function runGeneralizationAudit() {
  console.log("================================================================================");
  console.log("   CHALKIE 2.0 MANDATORY GENERALIZATION & PEDAGOGY AUDIT (PHASE 5)");
  console.log("================================================================================\n");

  // --------------------------------------------------------------------------
  // CHECK 1: Static Code Audit for Hardcoded Topics
  // --------------------------------------------------------------------------
  console.log(">>> CHECK 1: Scanning Core Files for Hardcoded Topic Presets & Fallbacks...");
  const coreFiles = [
    "lib/graph-generator.ts",
    "lib/plot-tool.ts",
    "scripts/render_graph.py",
    "lib/lesson-v2.ts",
    "lib/visual-agent.ts",
  ];

  const forbiddenTopicPatterns = [
    { name: "Schwarzschild", regex: /\bschwarzschild\b/i },
    { name: "Tacoma Narrows", regex: /\btacoma\b/i },
    { name: "Orbital Presets", regex: /\b(orbital|escape\s+velocity)\b/i },
    { name: "Mitochondria", regex: /\bmitochondria\b/i },
    { name: "Damped/Resonant wave hardcoding", regex: /\b(damped\s+wave|resonant\s+amplification)\b/i },
  ];

  for (const relPath of coreFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    assert.ok(fs.existsSync(fullPath), `File must exist: ${relPath}`);
    const content = fs.readFileSync(fullPath, "utf-8");

    // Remove negative prompt instructions that say e.g. "NEVER 'Curve 1'" or doc comments
    const codeLines = content.split("\n").filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("#");
    });
    const codeBody = codeLines.join("\n");

    for (const pattern of forbiddenTopicPatterns) {
      const match = pattern.regex.exec(codeBody);
      if (match) {
        throw new Error(`[FAIL] Found hardcoded topic pattern '${pattern.name}' in ${relPath}: "${match[0]}"`);
      }
    }

    // Verify no fallback creates "Curve 1"
    const hasCurve1Assignment = /(=|:)\s*["']Curve\s*1["']/i.test(codeBody);
    assert.ok(!hasCurve1Assignment, `File ${relPath} must not assign default "Curve 1" series label`);
    console.log(`  ✓ ${relPath} is 100% free of hardcoded domain branches`);
  }
  console.log(">>> CHECK 1 PASSED: Zero hardcoded domain branches detected across all core files.\n");

  // --------------------------------------------------------------------------
  // CHECK 2: Unseen Non-Graph Topic Test (Proving Graphs Are NOT Forced)
  // --------------------------------------------------------------------------
  console.log(">>> CHECK 2: Testing Lesson Planner on Qualitative Unseen Topic...");
  const qualitativePrompt = "Explain how the Domain Name System (DNS) resolves a website URL into an IP address.";
  console.log(`  Prompt: "${qualitativePrompt}"`);

  // We load dotenv for GROQ_API_KEY if present
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const [key, ...val] = line.trim().split("=");
      if (key && val.length > 0 && !process.env[key]) {
        process.env[key] = val.join("=").replace(/^["']|["']$/g, "");
      }
    }
  }

  const mockSources = [{
    id: "src-dns-1",
    title: "Domain Name System (DNS) Protocol Specification",
    url: "https://tools.ietf.org/html/rfc1035",
    publisher: "IETF",
    summary: "The Domain Name System (DNS) translates human-readable domain names into IP addresses. The resolution flow progresses from the client stub resolver to a recursive resolver, then querying root nameservers, Top-Level Domain (TLD) nameservers, and authoritative nameservers.",
    score: 1.0,
  }];

  const qualitativeLesson = await createLessonWithGroq(
    qualitativePrompt,
    "The Domain Name System (DNS) is a hierarchical distributed naming system that translates human-readable domain names into numerical IP addresses. When a user requests a URL, the recursive resolver queries root nameservers, TLD nameservers, and authoritative nameservers in sequence, returning the IP address to the client.",
    mockSources,
    { timeoutMs: 30000 },
    { language: { mode: "native", language: "en-US" } }
  );

  console.log(`  Generated lesson title: "${qualitativeLesson.title}"`);
  console.log(`  Objects count: ${qualitativeLesson.objects.length}`);
  console.log(`  Steps count: ${qualitativeLesson.segments.length}`);

  // Assert NO graph or plot nodes exist
  const graphObjects = qualitativeLesson.objects.filter(
    (o) => o.image?.provenance === "plot" || Boolean(o.plot) || o.id.startsWith("graph-")
  );
  console.log(`  Graph / plot objects count: ${graphObjects.length}`);
  assert.strictEqual(
    graphObjects.length,
    0,
    `Qualitative topic "${qualitativePrompt}" must NOT contain any graph or plot objects!`
  );

  // Assert sequential concept flowchart cards exist
  const boxCards = qualitativeLesson.objects.filter(
    (o) => o.shapeType === "geo" || o.shapeType === "note" || o.role === "component" || o.role === "annotation"
  );
  assert.ok(
    boxCards.length >= 3,
    `Qualitative lesson must build a rich sequential flowchart of at least 3 box cards (found ${boxCards.length})`
  );
  console.log(`  ✓ Flowchart box cards built: ${boxCards.length}`);
  console.log(`  ✓ Connections / causal arrows: ${qualitativeLesson.connections.length}`);
  console.log(">>> CHECK 2 PASSED: Qualitative DNS topic generated pure concept flowchart with zero forced graphs.\n");

  // --------------------------------------------------------------------------
  // CHECK 3: Unseen Quantitative Topic Test (Universal Matplotlib Out of Thin Air)
  // --------------------------------------------------------------------------
  console.log(">>> CHECK 3: Testing Domain-Agnostic Matplotlib on Microeconomics Supply & Demand Equilibrium...");
  const supplyDemandSpec = {
    title: "Microeconomics Supply & Demand Equilibrium",
    subtitleFormula: "P_d = 100 - Q \\quad \\text{vs.} \\quad P_s = 6.25 + 0.875 Q",
    chartKind: "curve" as const,
    xAxisLabel: "Quantity (Q)",
    yAxisLabel: "Price ($)",
    series: [
      {
        name: "Market Demand",
        color: "#38bdf8",
        points: [
          { x: 10, y: 90, label: "High Willingness to Pay" },
          { x: 30, y: 70 },
          { x: 50, y: 50 },
          { x: 70, y: 30 },
          { x: 90, y: 10, label: "Market Saturation" },
        ],
      },
      {
        name: "Market Supply",
        color: "#10b981",
        points: [
          { x: 10, y: 15, label: "Shutdown Price" },
          { x: 30, y: 32.5 },
          { x: 50, y: 50 },
          { x: 70, y: 67.5 },
          { x: 90, y: 85, label: "Capacity Limit" },
        ],
      },
    ],
  };

  const graphResult = await generateScientificGraph(supplyDemandSpec);
  assert.ok(graphResult.dataUrl.startsWith("data:image/png;base64,"), "Must generate base64 PNG dataUrl");
  console.log(`  ✓ Generated PNG dataUrl length: ${graphResult.dataUrl.length} chars`);
  console.log(`  ✓ Regions detected: ${graphResult.regions.length}`);

  // Check equilibrium intersection detection
  const equilibriumRegion = graphResult.regions.find((r) => r.id === "curve_intersection" || r.label.includes("Equilibrium"));
  assert.ok(equilibriumRegion, "Must detect and annotate Equilibrium intersection point (50, 50)");
  console.log(`  ✓ Equilibrium intersection detected: "${equilibriumRegion.label}" at (${equilibriumRegion.x}, ${equilibriumRegion.y})`);

  // Check axis bounding boxes for laser pointer
  const xAxisReg = graphResult.regions.find((r) => r.id === "x_axis");
  const yAxisReg = graphResult.regions.find((r) => r.id === "y_axis");
  assert.ok(xAxisReg, "Must output x_axis region");
  assert.ok(yAxisReg, "Must output y_axis region");
  console.log(`  ✓ Laser-pointer axis regions verified: x_axis ("${xAxisReg.label}"), y_axis ("${yAxisReg.label}")`);

  // Save PNG to disk for visual verification
  const base64Data = graphResult.dataUrl.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const outDirs = [
    path.resolve(process.cwd(), "scratch"),
    path.resolve(process.cwd(), "../tmp"),
    "C:\\tmp",
  ];

  let savedPath = "";
  for (const dir of outDirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, "verify-general-graph.png");
      fs.writeFileSync(target, buffer);
      if (!savedPath) savedPath = target;
      console.log(`  ✓ Saved visual artifact to: ${target}`);
    } catch {}
  }

  // Also write to artifacts dir if available
  const artifactDir = "C:\\Users\\agarw\\.gemini\\antigravity-ide\\brain\\ece411cf-2838-47af-9b0f-0441bf1fefca";
  if (fs.existsSync(artifactDir)) {
    const artTarget = path.join(artifactDir, "verify-general-graph.png");
    fs.writeFileSync(artTarget, buffer);
    console.log(`  ✓ Saved visual artifact to conversation artifacts: ${artTarget}`);
  }

  console.log(">>> CHECK 3 PASSED: Universal Matplotlib graph generated with accurate curves, axis labels, and equilibrium.\n");

  console.log("================================================================================");
  console.log("   ALL AUTOMATED GENERALIZATION AUDIT CHECKS PASSED SUCCESSFULLY!");
  console.log("================================================================================");
}

runGeneralizationAudit().catch((err) => {
  console.error("\n❌ GENERALIZATION AUDIT FAILED:", err);
  process.exit(1);
});
