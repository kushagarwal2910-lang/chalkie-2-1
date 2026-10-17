"use client";

import { SOURCE_LIMITS, sourceMaterialSchema, type SourceImage, type SourceMaterial } from "./source-materials";
import { validateDocxArchive } from "./document-safety";

type ImportProgress = (message: string) => void;

function boundedImage(canvas: HTMLCanvasElement, properties: Omit<SourceImage, "dataUrl" | "width" | "height">): SourceImage | null {
  let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  if (dataUrl.length > SOURCE_LIMITS.imageCharacters) dataUrl = canvas.toDataURL("image/jpeg", 0.55);
  if (dataUrl.length > SOURCE_LIMITS.imageCharacters) return null;
  return { ...properties, dataUrl, width: canvas.width, height: canvas.height };
}

async function readPdf(file: File, onProgress?: ImportProgress): Promise<SourceMaterial> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/document-runtime/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false, useSystemFonts: true, stopAtErrors: true, maxImageSize: 16_000_000 });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void task.destroy(); }, 90_000);
  try {
    const pdf = await task.promise;
    const id = crypto.randomUUID();
    const pages = Math.min(pdf.numPages, SOURCE_LIMITS.pdfPages);
    const textParts: string[] = [];
    const images: SourceImage[] = [];
    let textLength = 0;
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      onProgress?.(`Reading PDF page ${pageNumber} of ${pages}${pdf.numPages > pages ? ` (first ${pages} pages)` : ""}`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").trim();
      if (pageText && textLength < SOURCE_LIMITS.textCharacters) {
        const chunk = `[Page ${pageNumber}]\n${pageText}`.slice(0, SOURCE_LIMITS.textCharacters - textLength);
        textParts.push(chunk); textLength += chunk.length + 2;
      }
      if (images.length < SOURCE_LIMITS.images) {
        const operators = await page.getOperatorList();
        const embeddedImageNames: string[] = [];
        let vectorPaths = 0;
        operators.fnArray.forEach((operation, index) => {
          if (operation === pdfjs.OPS.paintImageXObject && typeof operators.argsArray[index]?.[0] === "string") embeddedImageNames.push(operators.argsArray[index][0]);
          if (operation === pdfjs.OPS.constructPath) vectorPaths += 1;
        });
        // Rasterize pages with graphics too: PDF diagrams are often vectors rather
        // than embedded bitmaps, and their labels must stay beside the figure.
        if (embeddedImageNames.length || vectorPaths >= 6 || !pageText) {
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(1.8, 1400 / Math.max(natural.width, natural.height)) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
          const context = canvas.getContext("2d");
          if (context) {
            await page.render({ canvas, canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;
            const pageImage = boundedImage(canvas, { id: `${id}-p${pageNumber}`, title: `${file.name} · page ${pageNumber}`.slice(0, 180), page: pageNumber, kind: "page" });
            if (pageImage) images.push(pageImage);
            // Retain a substantial bitmap separately when it is available. Small
            // logos and tiny decorative assets are intentionally ignored.
            for (const name of [...new Set(embeddedImageNames)].slice(0, 4)) {
              if (images.length >= SOURCE_LIMITS.images || !page.objs.has(name)) break;
              const image = page.objs.get(name) as { width?: number; height?: number; bitmap?: ImageBitmap; data?: Uint8ClampedArray; kind?: number } | null;
              if (!image?.width || !image.height || image.width < 180 || image.height < 140 || image.width * image.height > 8_000_000) continue;
              const raw = document.createElement("canvas"); raw.width = image.width; raw.height = image.height;
              const rawContext = raw.getContext("2d");
              if (!rawContext) continue;
              if (image.bitmap) rawContext.drawImage(image.bitmap, 0, 0);
              else if (image.data && (image.kind === 2 || image.kind === 3)) {
                const rgba = new Uint8ClampedArray(image.width * image.height * 4);
                const stride = image.kind === 3 ? 4 : 3;
                for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
                  rgba[pixel * 4] = image.data[pixel * stride]; rgba[pixel * 4 + 1] = image.data[pixel * stride + 1]; rgba[pixel * 4 + 2] = image.data[pixel * stride + 2]; rgba[pixel * 4 + 3] = stride === 4 ? image.data[pixel * stride + 3] : 255;
                }
                rawContext.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
              } else continue;
              const output = document.createElement("canvas");
              const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
              output.width = Math.max(1, Math.round(image.width * scale)); output.height = Math.max(1, Math.round(image.height * scale));
              output.getContext("2d")?.drawImage(raw, 0, 0, output.width, output.height);
              const extracted = boundedImage(output, { id: `${id}-p${pageNumber}-figure-${images.length}`, title: `${file.name} · page ${pageNumber} figure`.slice(0, 180), page: pageNumber, kind: "embedded" });
              if (extracted) images.push(extracted);
              raw.width = 0; raw.height = 0; output.width = 0; output.height = 0;
            }
          }
          canvas.width = 0; canvas.height = 0;
        }
      }
      page.cleanup();
    }
    if (timedOut) throw new Error("The PDF took too long to parse. Try a smaller excerpt.");
    return sourceMaterialSchema.parse({ id, title: file.name.slice(0, 180), kind: "pdf", text: textParts.join("\n\n").slice(0, SOURCE_LIMITS.textCharacters), images });
  } finally { clearTimeout(timeout); await task.destroy(); }
}

export async function importDocument(file: File, onProgress?: ImportProgress): Promise<SourceMaterial> {
  if (file.size > SOURCE_LIMITS.fileBytes) throw new Error("Use a document smaller than 20 MB.");
  if (/\.pdf$/i.test(file.name)) return readPdf(file, onProgress);
  if (/\.docx$/i.test(file.name)) {
    onProgress?.("Reading document text");
    const arrayBuffer = await file.arrayBuffer();
    validateDocxArchive(arrayBuffer);
    const mammoth = await import("mammoth");
    // Extract text only: uploaded Office HTML and scripts never enter the DOM.
    const result = await mammoth.extractRawText({ arrayBuffer });
    return sourceMaterialSchema.parse({ id: crypto.randomUUID(), title: file.name.slice(0, 180), kind: "docx", text: result.value.slice(0, SOURCE_LIMITS.textCharacters), images: [] });
  }
  if (/\.(?:txt|md|csv|tsv)$/i.test(file.name)) {
    return sourceMaterialSchema.parse({ id: crypto.randomUUID(), title: file.name.slice(0, 180), kind: "text", text: (await file.text()).slice(0, SOURCE_LIMITS.textCharacters), images: [] });
  }
  throw new Error("Choose a PDF, DOCX, TXT, Markdown, CSV, or TSV file.");
}
