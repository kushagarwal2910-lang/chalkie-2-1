import { copyFileSync, mkdirSync } from "node:fs";
const target = "public/document-runtime";
mkdirSync(target, { recursive: true });
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `${target}/pdf.worker.min.mjs`);
copyFileSync("node_modules/pdfjs-dist/LICENSE", `${target}/PDFJS-LICENSE.txt`);
