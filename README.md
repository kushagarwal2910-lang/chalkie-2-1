# Chalkie 2.0

Visual lessons with Excalidraw, retrieved diagrams, deterministic graphs, document sources, and speech-linked teaching gestures.

## Run

Use Node 22.13+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The sample at `/studio?demo=1`, local graphs, document parsing, and device voices work without provider accounts. Try **Plot y=x^2 from -5 to 5** or **Chart January: 12, February: 18, March: 9** for a fully local graph lesson.

General lesson planning, image inspection, and multilingual narration text use the existing Groq credentials. Live web research additionally uses Tavily. Add those keys in provider settings or configure `GROQ_API_KEY` and `TAVILY_API_KEY` on the server. Uploaded materials with **Include Web Search** off do not require Tavily. No new image or speech provider is required for these features.

For production, set a persistent `BYOK_ENCRYPTION_SECRET` of at least 32 characters to save provider keys securely. Development generates an ignored local secret. No service is deployed by this change.

## Visual selection and graphs

- Anatomy, biology, chemistry, hardware, and geography first use diagrams from the user's supplied documents, then Commons/Openverse. Vision checks suitability before a public reference is displayed. Attribution and permitted license metadata remain attached.
- Stories, real-world cases, and physical analogies request generated conceptual illustrations. Canonical searches can also fall back to generation when retrieval finds no suitable match. Without an image provider or local model, Chalkie uses the remaining board and shows the reason in Sources. Generated images are labeled as illustrations, never documentary evidence.
- Numerical data, curves, force vectors, and timelines use `lib/plot-tool.ts`, a deterministic TypeScript SVG compiler. It supports bar, line, scatter, curve, force, and timeline specifications. ELK handles causal chains and flowcharts. The renderer makes no AI or external API calls.

General-language requests still use the planner to select a plot and structure its data. Explicit supported formulas and label/value pairs bypass the planner entirely. Arithmetic expressions use a restricted parser, never JavaScript evaluation. Numerical graphs preserve their data, units, provenance, and source IDs. The planner must use supplied evidence for measured data; hypothetical values are labeled illustrative. Source identity is validated, but semantic accuracy of model-extracted values still needs review.

## Documents and research

Expand **Lesson sources & documents** in Sources to import PDFs, DOCX, TXT, Markdown, CSV/TSV, public URLs, raw text, or available YouTube transcripts. Turn **Include Web Search** off to use only supplied material. Blocked YouTube transcripts can be pasted manually.

PDF/DOCX parsing runs in the browser. PDFs retain readable text plus embedded images and rendered diagram pages; remove unwanted diagram previews before asking. Limits: eight sources, 20 MB per file, first 40 PDF pages, 100,000 text characters per source, and eight diagrams total. Scanned PDFs can use bounded vision transcription of up to two retained pages per source, four total. Unreadable scans produce a clear evidence error instead of fabricated text.

User chunks enter the existing lexical/semantic retrieval pool with priority and source score `1.0`. This indicates user priority, not factual certification. Public URL imports validate DNS addresses and redirects, pin the public address, and enforce type, size, and time limits. Private-network URLs are rejected.

Materials persist per lesson in IndexedDB and restore when reopening that lesson. Imported text and selected diagrams are sent to configured teaching providers when generating an explanation. User diagrams and generated images are not placed in the shared public-image cache. The research index remains process-local; multi-instance deployment needs shared storage. Existing Drive backup is retained, but source-document storage is device-local.

## Teaching focus, camera, and speech

Narration is finalized after images and graphs exist. The model receives their actual region IDs, descriptions, graph values, axes, units, and research evidence. Each cue quotes a phrase in the spoken narration and names a validated target. Unknown targets and unsupported arrows are discarded.

The camera follows the active object or image region. Whole images occupy roughly 70% of the available viewport; inspected subregions use a bounded close-up. Cards receive their own framing. Manual panning/zooming suspends following until **Follow teacher camera** is selected. Reduced-motion preferences are respected.

Circles, brackets, and curved dashed chalk arrows appear at spoken cues. Intra-image arrows require two located regions in the same image. Overlays follow the live Excalidraw position, scale, rotation, and flip. Image regions remain approximate vision predictions; missing or uncertain geometry does not get an invented pointer location. Graph targets come directly from the renderer's geometry.

Timing uses device word boundaries or provider alignment when available. Engines without alignment speak bounded phrase chunks so explicit gestures begin with actual phrase audio rather than estimated character timing. The avatar's mouth movement is approximate, not phoneme-level lip synchronization.

## Languages and voices

The Guide offers **Native mode** (board and narration in the selected language) and **Classroom mode** (English labels and scientific terms with conversational regional narration, including Hinglish, Tanglish, and Teluglish). Stable object IDs, formulas, numeric data, and units stay unchanged. Saved segments retain their own language when a later follow-up uses a different setting.

**Local natural** is the English default: Kokoro runs in a Web Worker without an account or per-call fee. First use downloads about 120 MB; browser caches retain available model assets. **Device voice** avoids the download and uses an installed voice matching the narration language. If no matching regional voice exists, the UI explains how to add one and keeps captions available. It does not substitute an English voice for regional text.

Optional server-side providers:

```dotenv
# Optional image generation: choose a hosted provider OR an existing local server.
FAL_KEY=your-key
CHALKIE_IMAGE_MODEL=z-image-turbo
# Alternative: CHALKIE_IMAGE_MODEL=flux-schnell
# LOCAL_IMAGE_ENDPOINT=http://127.0.0.1:8188/your-compatible-endpoint

# Optional Indian-language speech.
SARVAM_API_KEY=your-key
SARVAM_SPEAKER=shubh

# Optional multilingual speech with alignment.
ELEVENLABS_API_KEY=your-key
ELEVENLABS_VOICE_ID=your-voice-id
```

The local image endpoint must already be running and accept the adapter's fal-compatible JSON request, returning an `images` array with inline raster `url` data. Chalkie does not install or start an image model. Hosted generation supports [Z-Image Turbo](https://fal.ai/models/fal-ai/z-image/turbo/api) and [FLUX Schnell](https://fal.ai/models/fal-ai/flux/schnell/api); speech supports Sarvam Bulbul v3 and ElevenLabs Flash v2.5. Secrets stay on the server. Gemini TTS is not integrated. Cloud speech returns bounded phrase audio, not a continuous streaming transport. Actual latency depends on the provider, hardware, and network; 1.5-second image generation and 75-millisecond speech are not guaranteed.

## Validation

```sh
npm run typecheck
node --experimental-strip-types --test lib/*.test.ts scratch/test-playback-sync.mjs
node --experimental-strip-types scripts/test-source-ingestion.mjs
node --experimental-strip-types scripts/test-document-parsers.mjs
node --experimental-strip-types scripts/test-grounded-narration.mjs
npm run build
```

Tests use fixtures and mocked providers. Document tests exercise real DOCX extraction and PDF text/vector rendering. The build copies PDF and speech runtime assets and verifies compiled styles. Excalidraw fonts are copied by postinstall. `npm run dev:next -- --webpack` is available when the local Turbopack process cannot start; the custom server remains the default for WebSocket status updates.

Existing live checks (`scripts/test-live-research.mjs`, `scripts/test-followup-images.mjs`, `scripts/test-teaching-live.mjs`) are opt-in through `RUN_LIVE_TESTS=1` and consume provider quota. New hosted image/voice adapters have offline contract tests; no latency or naturalness claims are established by those tests.
