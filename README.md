# Chalkie 2.0

Chalkie's original Next.js interface and browser narration, with Excalidraw, free Commons/Openverse reference images, Groq image understanding, and an animated local teacher.

> 📖 **Deep Technical Specification**: For an exhaustive, end-to-end breakdown of the entire architecture, data schemas, visual grounding pipeline, spatial layout algorithms, and concrete examples, see **[SCHEMAS.md](file:///c:/Users/agarw/OneDrive/Desktop/kush/chalkie%202.0/SCHEMAS.md)**.


## Run

Use Node 22.13+ (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Add your Groq and Tavily keys in the existing provider settings. Server-side `GROQ_API_KEY` and `TAVILY_API_KEY` are also supported by the original credential system. Live lessons require research; the labeled sample still works without keys. No tldraw license is required.

For production, configure a persistent `BYOK_ENCRYPTION_SECRET` of at least 32 characters to enable saving provider keys securely. Development generates its own ignored local secret.

- `/avatars`: three original teacher options, local natural/device voice preview, and link to a sample lesson.
- `/studio?demo=1`: a clearly labeled water-cycle sample, usable without API keys.
- Voice settings in the lesson guide select the avatar, voice, pace, and pitch. Each avatar remembers separate preferences; Mira prefers known feminine voices and Arjun known masculine voices. Explicit voice choices override these defaults.

Device speech is the lightweight default. Select **Local natural** in Teacher & voice for free Kokoro English voices. No speech API key, account, or per-call fee is needed. First use downloads about 120 MB of model/runtime data; browser caches retain model/voice files when available. Inference runs in a Web Worker on the user’s CPU, so latency and memory depend on the device. Audio reuse is bounded to 12 recordings/12 MB. Local voice latency remains higher than device speech; further streaming optimization is deferred while lesson/image quality is prioritized. Cancelling generation terminates its worker. The retired `/api/speech` endpoint returns 410 and never calls Groq. Lesson planning and vision continue using the fixed Groq models.

The avatar follows speech start/end, receives browser word-boundary cues or approximate local-audio pointer timing, blinks, and gestures locally. Mouth movements approximate speaking; they are not phoneme-accurate lip sync. Device voices differ by browser and OS. Reduced-motion settings disable decorative breathing and gestures.

## Architecture

The existing Tavily retrieval, Groq quota/key management, transcription endpoint, IndexedDB lessons, and optional Drive backup are retained. `lib/lesson-v2.ts` defines a compact model output and compiles it into the existing lesson structure with version 2. Layout runs once on generation. `components/chalk-canvas.tsx` adapts that structure to Excalidraw and follows narration target IDs.

The planner chooses a teaching mode for each question: a reference image with handwritten notes, a meaningful sequence, paired comparisons, a worked example, or a concise concept explanation. It has no minimum quota of boxes or steps. Reference lessons introduce the image immediately and keep it visible as notes are added. `lib/teaching-layout.ts` arranges these compositions; ELK handles genuine sequences. Narration cues move the pointer without repeatedly zooming the camera. Follow-ups use the same planner and image tool, answering in one or two steps. New images and their layout are appended without moving the existing board.

Live generation requires nonempty retrieved evidence. Missing credentials, failed searches, or empty results produce a research error instead of silently switching to general knowledge. The text prompt requires factual claims to use the supplied passages and acknowledge gaps. This is a grounding constraint, not a guarantee that every model claim is correct. Follow-ups reuse session retrieval or saved source summaries, and fail clearly if neither contains evidence. Follow-ups never call Tavily; start a new topic to research a different subject. Source metadata persists with follow-ups. Invalid structured output gets one bounded retry using the same model.

`lib/models.ts` fixes all text planning and follow-ups to `openai/gpt-oss-120b` and vision to `qwen/qwen3.8-27b`, both on Groq. These IDs cannot be overridden by environment variables. `lib/image-library.ts` selects up to two free images per request, including follow-ups, through independent Commons and Openverse adapters and uses vision to check suitability and suggest approximate normalized regions. This uses the same Groq credentials as teaching. Image failures fall back to text and show a reason in Sources. Selected images still use Groq inference when analyzed; the image library itself has no license purchase fee. Configure `GROQ_API_KEY_2` for the existing automatic key failover.

Only explicitly allowed CC0, public domain, CC BY, and CC BY-SA assets are accepted. Attribution and original/license links appear in Sources and remain in exported lesson metadata. Image binaries are cached separately in IndexedDB; exports/Drive backups retain image references, not an offline image bundle. Cropped images fall back to whole-image focus. Scene edits persist locally.

Vision regions are approximate model predictions, not verified anatomical boundaries. The cache is bounded, process-local, and lasts 24 hours. Existing RAG indexes remain process-local; horizontal production deployment requires shared storage. Existing v1 custom scientific drawings render as labeled nodes in v2; the original renderer is removed.

For steps involving an image, a compact final narration pass uses the same text model with the retrieved evidence and the actual vision description/regions. Unlocated parts must not be described as visibly highlighted, and failed images must not be referred to as present. This adds a text call only for image-related explanations. If this pass fails, the request fails rather than playing a draft that assumed a different image.

## Validation

```sh
npm run typecheck
node --experimental-strip-types --test lib/*.test.ts scratch/test-playback-sync.mjs
npm run build
```

The build includes the original stylesheet verification. Excalidraw fonts are copied locally by postinstall. The existing Docker and Render setups use the npm lockfile. No service has been deployed and no changes have been pushed to the original repository.

For an opt-in live smoke test, run the app with real keys, set `RUN_LIVE_TESTS=1`, then run `node scripts/test-live-research.mjs`. It supplies only fresh questions and checks research, model configuration, images, and follow-ups. It consumes provider quota and writes actual responses to the ignored `outputs/research-live/` directory. These checks validate the integration, not every factual claim or predicted image boundary.

The independent image providers are [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:API/MediaWiki) and [Openverse](https://docs.openverse.org/packages/js/api_client/index.html). Search is keyless; only CC0, public domain, CC BY and CC BY-SA results pass the filter. Credits remain attached. Search/vision may still reject a reference or find nothing. Run `RUN_LIVE_TESTS=1 node scripts/test-followup-images.mjs` after the research test to check real image downloads and a new-image follow-up with an invalid Tavily test key.

Local speech uses [Kokoro.js](https://github.com/hexgrad/kokoro/tree/main/kokoro.js) and its Apache-licensed weights. Runtime assets are copied on install/build; notices are included. Device voices require no model download.

Research strips separate image-presentation instructions from the subject query, filters stock-image/social/homework listings, prioritizes educational/institutional domains, and selects relevant bounded excerpts across sources. Image inspection requires English labels or a clear unlabeled reference. Search tries bounded alternative candidates and a broader query when presentation qualifiers hide useful results; uncertain regions are omitted.

Run `RUN_LIVE_TESTS=1 node scripts/test-teaching-live.mjs` to check that real questions select comparison and worked-example layouts using retrieved evidence.
