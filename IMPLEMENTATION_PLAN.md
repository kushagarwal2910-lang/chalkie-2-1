# Implementation Plan: Visual Routing, ELK.js Spatial Engine & Laser-Guided Canvas Agent

## 1. Overview & Objective
Transform Chalkie into an **Autonomous Multimodal Teaching Agent** that:
- **Autonomously Routes Visual Intent**: Intelligently decides whether to deep-dive into an image already on canvas (Route A), source a new image from open libraries (Route B), or focus on concept cards (Route C)—without requiring explicit user commands.
- **Draws Directly on Excalidraw Images**: Activates Groq Vision (`qwen/qwen3.8-27b`) to detect micro-features and renders native Excalidraw elements directly on the image (semi-transparent chalk shading, contour borders, arrows, and callouts).
- **Lays Out Boards Deterministically with ELK.js**: Prevents card overlaps and tangled arrows using Eclipse Layout Kernel hierarchical DAG ranking and obstacle-avoiding orthogonal routing.
- **Synchronizes a Virtual Laser Pointer with Voiceover**: Glides an illuminated glowing laser pointer across the whiteboard in real time as the teacher avatar speaks, pinpointing the exact word, card, or shaded image feature.
- **Enforces Pydantic-Style Structured Modeling**: Uses Zod in Next.js/TypeScript to enforce strict runtime type safety, field constraints, discriminated unions, and Groq JSON schemas.

---

## 2. Autonomous Visual Agent Routing

```
                       ┌─────────────────────────────────┐
                       │   Learner Prompt / Doubt        │
                       └────────────────┬────────────────┘
                                        ▼
                       ┌─────────────────────────────────┐
                       │   Visual Agent Intent Router    │
                       │     (Groq: openai/gpt-oss-120b) │
                       └────────────────┬────────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
  [Existing Canvas Target]      [New Visual Required]        [Concept / Quick Doubt]
           │                            │                            │
           ▼                            ▼                            ▼
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ Route A: In-Place Image │  │ Route B: Open Library   │  │ Route C: Concept Focus  │
│ Drawing & Deep Dive     │  │ Sourcing & Append       │  │ (Existing Card Focus)   │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ • Dense VLM Inspection  │  │ • Search Commons/       │  │ • Re-frame active step  │
│   on current canvas img │  │   Openverse (CC assets) │  │ • Move laser pointer    │
│ • Generate Excalidraw   │  │ • VLM Candidate Verify  │  │ • Spoken explanation    │
│   shading + callouts    │  │ • ELK.js cluster layout │  │   without new visual   │
│ • Spoken narration      │  │ • Append right (x_offset)│  │                         │
│   referencing shading   │  │ • Draw annotations on   │  │                         │
│ • Laser guides vision   │  │   newly appended image  │  │                         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

### Route Selection Matrix
| Route | Trigger Condition | Visual Canvas Action | Tools Activated |
| :--- | :--- | :--- | :--- |
| **Route A (In-Place Draw)** | User asks about a detail/part of an image already visible on the board. | **Draws directly on existing image**: semi-transparent shading hatch, contour outline, chalk arrow, and label badge. | `vlm_dense_inspection`<br>`excalidraw_annotation_builder` |
| **Route B (Open Library)** | User asks about a new physical structure, mechanism, or comparison not yet on canvas. | **Fetches new CC image**, inspects with VLM, lays out cluster with ELK.js, appends to the right ($x_{\text{offset}}$), and draws annotations. | `open_image_search`<br>`vlm_grounding`<br>`elk_spatial_layout`<br>`excalidraw_annotation_builder` |
| **Route C (Concept Focus)** | User asks a high-level conceptual or clarifying question. | **Laser pointer focus** on existing card without cluttering the board with new drawings. | `canvas_laser_focus` |

---

## 3. Pydantic-Style Structured Schemas (`lib/visual-agent-schema.ts`)

```typescript
import { z } from "zod";

// Discriminated union on `action` for strict type safety
export const inPlaceAnnotationPlanSchema = z.object({
  action: z.literal("in_place_image_annotation"),
  rationale: z.string().describe("Why this existing image answers the question"),
  targetImageId: z.string().describe("ID of VisualObject holding the image"),
  targetFeatureQuery: z.string().describe("Sub-component to locate and highlight"),
  shadingColor: z.enum(["amber", "violet", "cyan", "yellow", "emerald"]).default("amber"),
  drawStyle: z.enum(["shade", "contour", "callout_arrow", "full_annotation"]).default("full_annotation"),
  calloutLabel: z.string().max(40).describe("Handwritten callout badge text"),
});

export const openLibrarySearchPlanSchema = z.object({
  action: z.literal("open_library_search"),
  rationale: z.string().describe("Why a new visual reference is required"),
  imageQuery: z.string().min(3).max(120).describe("2-4 search keywords for Commons/Openverse"),
  regionsToLocate: z.array(z.string()).min(1).max(8).describe("Anatomical/mechanical parts to locate"),
  teachingMode: z.enum(["reference", "sequence", "comparison", "worked-example", "concept"]).default("reference"),
});

export const canvasConceptFocusPlanSchema = z.object({
  action: z.literal("canvas_concept_focus"),
  rationale: z.string().describe("Why existing cards answer the doubt without new visual"),
  targetObjectIds: z.array(z.string()).min(1).max(6).describe("Objects to focus with laser"),
});

export const visualAgentDecisionSchema = z.discriminatedUnion("action", [
  inPlaceAnnotationPlanSchema,
  openLibrarySearchPlanSchema,
  canvasConceptFocusPlanSchema,
]);

export type VisualAgentDecision = z.infer<typeof visualAgentDecisionSchema>;

// Native Image Annotation Primitive
export const imageAnnotationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,56}$/),
  targetImageId: z.string(),
  regionLabel: z.string(),
  normalized: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
  color: z.enum(["amber", "violet", "cyan", "yellow", "emerald"]).default("amber"),
  drawStyle: z.enum(["shade", "contour", "callout_arrow", "full_annotation"]).default("full_annotation"),
  calloutText: z.string().max(60).optional(),
});

export type ImageAnnotation = z.infer<typeof imageAnnotationSchema>;
```

---

## 4. ELK.js Deterministic Spatial Layout Engine

Chalkie prevents LLM geometric hallucinations by delegating all 2D placement and routing to **ELK.js** (`elkjs`):

```
                   ┌─────────────────────────────────────────┐
                   │ Pedagogical Plan (Nodes, Images, Links) │
                   └────────────────────┬────────────────────┘
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │    ELK.js Layered DAG Layout Engine     │
                   │    - Direction: RIGHT (Process) / DOWN  │
                   │    - Node Spacing: 48px, Layers: 72px   │
                   │    - Crossing Minimization: LAYER_SWEEP │
                   │    - Node Placement: BRANDES_KOEPF      │
                   └────────────────────┬────────────────────┘
                                        ▼
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
┌───────────────────────────────┐             ┌─────────────────────────────────┐
│ Card & Image Placement Bounds │             │ A* Orthogonal Connector Routing │
│ (No overlap, variable sizes)  │             │ (90° elbow lines around cards)  │
└───────────────────────────────┘             └─────────────────────────────────┘
```

### ELK.js Execution Pipeline
1. **Graph Construction (`ElkNode` Hierarchy)**:
   - Heterogeneous node sizing: Image cards ($480 \times 330\text{px}$), core concept boxes ($260 \times 130\text{px}$), and text notes.
   - Container and compound frame awareness: Enclosing boxes (`parentId`) are assigned automatically via `assignParents`.
2. **Layered Layout Dispatch (`lib/elk-spatial-layout.ts`)**:
   - `elk.algorithm`: `"layered"`
   - `elk.direction`: `"RIGHT"` for chronological flows/cycles, `"DOWN"` for hierarchical breakdowns.
   - `elk.spacing.nodeNode`: $48\text{px}$, `elk.layered.spacing.nodeNodeBetweenLayers`: $72\text{px}$.
   - `elk.layered.crossingMinimization.strategy`: `"LAYER_SWEEP"` (minimizes arrow crossings).
   - `elk.layered.nodePlacement.strategy`: `"BRANDES_KOEPF"` (aligns connected nodes).
3. **Follow-Up Non-Destructive Extension**:
   - New visual clusters from follow-ups are laid out in a clean local ELK frame.
   - Merged onto the canvas using a horizontal rightward offset without disturbing old nodes:
     $$x_{\text{offset}} = \max(x_{\text{existing}} + w_{\text{existing}}) + 180\text{px} - \min(x_{\text{new}})$$
   - Cross-connectors between existing cards and new nodes are routed orthogonally around all obstacles.

---

## 5. Synchronized Virtual Laser Pointer & Voiceover Avatar

A glowing virtual laser pointer dynamically guides the learner's eyes, locked to what the teacher avatar speaks:

```
┌─────────────────────────────────┐       ┌───────────────────────────────────┐
│ Speech Synthesizer              │       │ Teacher Avatar (Mira / Arjun)     │
│ (Kokoro.js / Web Speech API)    │       │ - Blinks & gestures               │
│ - Fires `onTarget(targetId)`    │       │ - Points arm toward laser target  │
│ - Emits `speech-boundary`       │       │ - Mouth moves with speech tempo   │
└────────────────┬────────────────┘       └─────────────────┬─────────────────┘
                 │                                          │
                 └────────────────────┬─────────────────────┘
                                      ▼
                 ┌──────────────────────────────────────────┐
                 │ Dynamic Glowing Virtual Laser Pointer    │
                 │ 1. Core Laser Dot (#e7ce91 / #ef4444)    │
                 │ 2. Concentric Pulsing Ripples (r: 6..18) │
                 │ 3. Soft Radial Spotlight on Canvas Target│
                 │ 4. Smooth Spring Gliding (x(t), y(t))    │
                 └──────────────────────────────────────────┘
```

### Laser Pointer Specifications
1. **Real-Time Word & Region Tracking**:
   - `computeTargetPositions` maps narration phrases to specific visual target IDs (e.g., `card-1`, `heart-img`, `heart-img#mitral-valve`).
   - The speech engine triggers boundary events that update `activeTargetId`.
2. **Smooth Physics-Based Gliding**:
   - When the active target moves (e.g. from the aorta to the left ventricle), the laser smoothly glides across the whiteboard using `requestAnimationFrame` interpolation rather than teleporting.
3. **Visual Aesthetics on Canvas**:
   - **Core Point**: High-intensity glowing dot with SVG drop-shadow filter.
   - **Pulsing Ripple**: Concentric expanding rings ($\Delta r = 6\text{px} \rightarrow 18\text{px}$) indicating active focus.
   - **Spotlight Glow**: Highlights the specific shaded region or text card being narrated.
   - **Avatar Arm Link**: `TeacherAvatar` sets `pointing={true}` and angles its arm toward the laser position.

---

## 6. Native Excalidraw Drawing & Shading on Images

When an image object contains annotations, native Excalidraw elements are rendered directly over the image in [`components/chalk-canvas.tsx`](file:///c:/Users/agarw/OneDrive/Desktop/kush/chalkie%202.0/components/chalk-canvas.tsx):

1. **World Coordinate Projection**:
   $$X_{\text{world}} = X_{\text{image}} + (x_{\text{norm}} \times W_{\text{image}})$$
   $$Y_{\text{world}} = Y_{\text{image}} + (y_{\text{norm}} \times H_{\text{image}})$$
   $$W_{\text{world}} = w_{\text{norm}} \times W_{\text{image}}$$
   $$H_{\text{world}} = h_{\text{norm}} \times H_{\text{image}}$$

2. **Native Excalidraw Elements Injected**:
   - **Shading Mask**: `type: "rectangle"`, `backgroundColor: "rgba(245, 158, 11, 0.22)"`, `fillStyle: "cross-hatch"`, `strokeColor: "#f59e0b"`, `strokeWidth: 2`.
   - **Contour Border**: `type: "rectangle"`, `strokeColor: "#fde047"`, `strokeWidth: 2.5`, `strokeDasharray: [7, 5]`.
   - **Callout Arrow**: `type: "arrow"`, starts at center $(X + W/2, Y + H/2)$ and points outward to note.
   - **Callout Badge**: `type: "text"`, handwritten font, `fontSize: 16`, `strokeColor: "#f8fafc"`.
   - **Group Lock**: Annotation elements share `groupIds: ["group-" + imageId]` so they remain locked to the image during camera pan and zoom.

---

## 7. Step-by-Step Implementation Roadmap

### Phase 1: Schemas & Types
- Create [`lib/visual-agent-schema.ts`](file:///c:/Users/agarw/OneDrive/Desktop/kush/chalkie%202.0/lib/visual-agent-schema.ts) with Pydantic-style Zod models (`visualAgentDecisionSchema`, `imageAnnotationSchema`).
- Extend `VisualObject` in [`lib/lesson-schema.ts`](file:///c:/Users/agarw/OneDrive/Desktop/kush/chalkie%202.0/lib/lesson-schema.ts) with `annotations?: ImageAnnotation[]`.

### Phase 2: Visual Agent Router (`lib/visual-agent.ts`)
- Implement `routeVisualIntent(question, currentLesson, sessionResearch, options)` using `openai/gpt-oss-120b` with strict JSON schema.
- Autonomously selects Route A (existing image draw), Route B (open library search), or Route C (concept focus).

### Phase 3: Dense VLM Feature Grounding (`lib/image-library.ts`)
- Implement `denseGroundExistingImage(asset, featureQuery, options)` using `qwen/qwen3.8-27b`.
- Returns high-precision bounding boxes for requested sub-mechanisms.

### Phase 4: ELK.js Spatial Layout Integration (`lib/elk-spatial-layout.ts`)
- Ensure ELK lays out new visual clusters with layered ranking, heterogeneous node sizing, and orthogonal obstacle routing.
- Integrate seamless horizontal offset ($x_{\text{offset}}$) for non-destructive follow-up expansion.

### Phase 5: Excalidraw Image Drawing Generator (`lib/image-annotations.ts`)
- Implement builder mapping `ImageAnnotation` into native Excalidraw skeletons (`rectangle` with cross-hatch shading, arrows, text badges).
- Update `sceneFor` in [`components/chalk-canvas.tsx`](file:///c:/Users/agarw/OneDrive/Desktop/kush/chalkie%202.0/components/chalk-canvas.tsx) to inject annotations with group locks.

### Phase 6: Synchronized Virtual Laser Pointer (`components/chalk-canvas.tsx`)
- Enhance the canvas overlay with an illuminated glowing laser pointer (core dot, ripple pulse, soft spotlight).
- Add smooth interpolation gliding between target coordinates as speech boundaries update.
- Ensure avatar arm and mouth track speech boundaries synchronously.

### Phase 7: Validation & Verification
- Run `npm run typecheck` to verify all Zod schemas, types, and compiler interfaces.
- Unit test ELK layout and coordinate projection math.
- Live test:
  1. Deep-dive into heart diagram $\rightarrow$ verify in-place shading of valves.
  2. Ask for new concept (lungs) $\rightarrow$ verify library search, ELK layout, and laser tracking.
