/* Runs only after the learner selects Local natural voice. No inference API. */
import { KokoroTTS, env } from "./speech-runtime/kokoro.web.js";
env.wasmPaths = new URL("./speech-runtime/", self.location.href).href;
let model;
let queue = Promise.resolve();

function wav(chunks, sampleRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { const value = Math.max(-1, Math.min(1, sample)); view.setInt16(offset, value * (value < 0 ? 32768 : 32767), true); offset += 2; }
  return new Blob([buffer], { type: "audio/wav" });
}

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, text, voice, speed } = data;
    const status = message => self.postMessage({ id, type: "progress", message });
    try {
      if (!model) {
        status("Downloading the free voice model…");
        model = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
          dtype: "q8", device: "wasm",
          progress_callback: progress => {
            if (progress.status === "progress" && progress.file?.endsWith(".onnx")) status(`Downloading voice model: ${Math.round(progress.progress)}%`);
            else if (progress.status === "done") status("Loading voice on this device…");
          },
        });
      }
      status("Loading your narrator voice…");
      const voiceUrl = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voice}.bin`;
      const voiceCache = await caches.open("kokoro-voices");
      if (!(await voiceCache.match(voiceUrl))) {
        const response = await fetch(voiceUrl, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error("Voice download failed");
        await voiceCache.put(voiceUrl, response);
      }
      const chunks = [];
      let sampleRate = 24000;
      // Bound each utterance below the model's 510-phoneme context limit.
      const phrases = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
      const parts = [];
      for (let phrase of phrases) {
        while (phrase.length > 220) {
          let cut = phrase.lastIndexOf(" ", 220);
          if (cut < 40) cut = 220;
          parts.push(phrase.slice(0, cut)); phrase = phrase.slice(cut).trim();
        }
        if (phrase.trim()) parts.push(phrase.trim());
      }
      for (const [index, part] of parts.entries()) {
        status(`Creating speech on this device… ${index + 1}/${parts.length}`);
        const audio = await model.generate(part, { voice, speed });
        chunks.push(audio.audio); sampleRate = audio.sampling_rate;
      }
      if (!chunks.length) throw new Error("No speech generated");
      self.postMessage({ id, type: "complete", audio: wav(chunks, sampleRate) });
    } catch (error) {
      self.postMessage({ id, type: "error", message: "Local voice could not run. Check your connection for the first download, or choose Device voice in Teacher & voice.", diagnostic: String(error).slice(0, 240) });
    }
  });
};
