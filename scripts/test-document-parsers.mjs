// Real parser smoke tests with tiny in-memory files; no API calls or user files.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { validateDocxArchive } from "../lib/document-safety.ts";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const mammoth = require("mammoth");

const archive = new JSZip();
archive.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
archive.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Mitochondrial matrix: the citric acid cycle produces reducing equivalents.</w:t></w:r></w:p></w:body></w:document>');
const docx = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
validateDocxArchive(docx.buffer.slice(docx.byteOffset, docx.byteOffset + docx.byteLength));
const extracted = await mammoth.extractRawText({ buffer: docx });
assert.match(extracted.value, /Mitochondrial matrix/);
assert.match(extracted.value, /citric acid cycle/);

const { createCanvas, DOMMatrix, ImageData, Path2D } = require("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const drawing = "BT /F1 18 Tf 40 700 Td (Mitochondrial matrix and ATP synthesis) Tj ET\n0 0 1 RG 40 600 120 60 re S\n";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}endstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, value] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; }
const startXref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
const task = getDocument({ data: new Uint8Array(Buffer.from(pdf)), useSystemFonts: true, enableXfa: false });
try {
  const document = await task.promise;
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  assert.match(content.items.filter(item => "str" in item).map(item => item.str).join(" "), /Mitochondrial matrix/);
  const ops = await page.getOperatorList();
  assert.ok(ops.fnArray.includes(OPS.constructPath), "Vector diagrams remain available for page rendering.");
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
  const png = canvas.toBuffer("image/png");
  assert.ok(png.byteLength > 2000, "PDF page with text and a vector diagram renders successfully.");
  console.log(`Real DOCX text extraction and PDF text/vector rendering passed (${png.byteLength} rendered bytes).`);
} finally { await task.destroy(); }
