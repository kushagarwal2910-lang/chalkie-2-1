import { copyFileSync, mkdirSync } from "node:fs";
const target = "public/speech-runtime";
mkdirSync(target, { recursive: true });
copyFileSync("node_modules/kokoro-js/dist/kokoro.web.js", `${target}/kokoro.web.js`);
copyFileSync("node_modules/kokoro-js/LICENSE", `${target}/KOKORO-LICENSE.txt`);
copyFileSync("public/voice-licenses/ONNX-LICENSE.txt", `${target}/ONNX-LICENSE.txt`);
// Match the backend embedded in Kokoro 1.2.1's prebundled browser module.
// Its common metadata says 1.21, but its WASM backend uses this 1.22 dev build.
for (const extension of ["mjs", "wasm"]) {
  copyFileSync(`node_modules/kokoro-ort-runtime/dist/ort-wasm-simd-threaded.jsep.${extension}`, `${target}/ort-wasm-simd-threaded.jsep.${extension}`);
}
