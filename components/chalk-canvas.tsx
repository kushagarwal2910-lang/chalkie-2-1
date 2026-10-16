"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements, restoreElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFileData, AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { LessonPlan, LessonSegment } from "@/lib/lesson-schema";
import type { CanvasPlaybackState } from "@/lib/playback-sync";
import { getProgressiveVisibleObjects } from "@/lib/progressive-scene";
import { loadImageBlob } from "@/lib/image-cache";
import { projectImageRegion, getRegionCenter } from "@/lib/image-coordinates";
import { boardFontSize, boardTextLines, teachingFrameIds } from "@/lib/teaching-layout";
import { compileImageAnnotationSkeletons } from "@/lib/image-annotations";

import { routeOrthogonalConnector } from "@/lib/connector-routing";
import { PenTool, EyeOff } from "lucide-react";

declare global { interface Window { EXCALIDRAW_ASSET_PATH?: string } }
if (typeof window !== "undefined") window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";

const INITIAL_DATA = { appState: { viewBackgroundColor: "#121212" } };
const UI_OPTIONS = { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, changeViewBackgroundColor: false } } as const;

function convertStable(skeleton: ExcalidrawElementSkeleton[], owner: string): ExcalidrawElement[] {
  const elements = convertToExcalidrawElements(skeleton, { regenerateIds: false });
  const ids = new Map(elements.map((el, index) => {
    if (el.id === owner) return [el.id, owner];
    if (el.id && (el.id.startsWith("ann-") || el.id.startsWith(`${owner}-`))) return [el.id, el.id];
    return [el.id, `${owner}-part-${index}`];
  }));
  return elements.map(el => {
    const updated: ExcalidrawElement = {
      ...el,
      id: ids.get(el.id) ?? el.id,
      boundElements: el.boundElements?.map(bound => ({ ...bound, id: ids.get(bound.id) ?? bound.id })) ?? null,
      ...(el.type === "text" ? { containerId: el.containerId ? ids.get(el.containerId) ?? el.containerId : null } : {}),
    };
    if (updated.type === "text" && updated.containerId) {
      const container = elements.find(c => (ids.get(c.id) ?? c.id) === updated.containerId || c.id === updated.containerId);
      if (container && Number.isFinite(container.width)) {
        const maxInnerWidth = Math.max(40, container.width - 36);
        const textWidth = Math.min(updated.width, maxInnerWidth);
        const textObj = updated as unknown as { width: number; x: number; textAlign: string; verticalAlign: string };
        textObj.width = textWidth;
        textObj.textAlign = "center";
        textObj.verticalAlign = "middle";
        textObj.x = container.x + (container.width - textWidth) / 2;
      }
    }
    return updated;
  });
}

function sceneFor(lesson: LessonPlan, images: Set<string>) {
  const scene: ExcalidrawElement[] = [];
  for (const o of lesson.objects) {
    const isSubject = o.role === "subject";
    const common = {
      id: o.id,
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      strokeColor: isSubject ? "#a78bfa" : "#64748b",
      backgroundColor: isSubject ? "rgba(79, 70, 229, 0.22)" : "rgba(30, 41, 59, 0.55)",
      fillStyle: "solid" as const,
      roughness: 1,
      strokeWidth: 2,
    };
    let skeleton: ExcalidrawElementSkeleton[];
    if (o.image && images.has(o.image.id)) {
      const height = o.width * o.image.height / o.image.width;
      skeleton = [
        { ...common, type: "image", height, fileId: o.image.id as FileId, status: "saved", scale: [1, 1] },
        { type: "text", id: `${o.id}-caption`, x: o.x, y: o.y + height + 14, text: o.label, fontSize: 20, strokeColor: "#f1f5f9", width: o.width }
      ];
      if (o.annotations && o.annotations.length > 0) {
        skeleton.push(...compileImageAnnotationSkeletons(o, o.annotations));
      }
    } else if (o.shapeType === "note" || o.shapeType === "image") {
      skeleton = [{
        ...common,
        type: "rectangle",
        roundness: { type: 3 },
        strokeWidth: 1.5,
        label: { text: boardTextLines(o).join("\n"), fontSize: boardFontSize(o), strokeColor: "#f1f5f9", textAlign: "center", verticalAlign: "middle" }
      }];
    } else {
      const geoStroke = isSubject ? "#a78bfa" : "#38bdf8";
      const geoFill = isSubject ? "rgba(79, 70, 229, 0.22)" : "rgba(14, 116, 144, 0.25)";
      skeleton = [{
        ...common,
        type: o.geo === "ellipse" ? "ellipse" : "rectangle",
        roundness: o.geo === "ellipse" ? null : { type: 3 },
        strokeColor: geoStroke,
        backgroundColor: geoFill,
        label: { text: boardTextLines(o).join("\n"), fontSize: 22, strokeColor: "#f1f5f9", textAlign: "center", verticalAlign: "middle" }
      }];
    }
    scene.push(...convertStable(skeleton, o.id).map(el => ({ ...el, groupIds: [`group-${o.id}`], customData: { chalkieId: o.id, ...el.customData } })));
  }
  for (const connection of lesson.connections) {
    const from = lesson.objects.find(o => o.id === connection.from), to = lesson.objects.find(o => o.id === connection.to);
    if (!from || !to) continue;
    let points = connection.points;
    if (!points || !points.length) {
      const dx = to.x + to.width / 2 - from.x - from.width / 2;
      const dy = to.y + to.height / 2 - from.y - from.height / 2;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const fromAnchor = horizontal ? dx >= 0 ? "right" as const : "left" as const : dy >= 0 ? "bottom" as const : "top" as const;
      const toAnchor = horizontal ? dx >= 0 ? "left" as const : "right" as const : dy >= 0 ? "top" as const : "bottom" as const;
      const port = (obj: typeof from, side: string) => ({
        x: obj.x + (side === "left" ? 0 : side === "right" ? obj.width : obj.width / 2),
        y: obj.y + (side === "top" ? 0 : side === "bottom" ? obj.height : obj.height / 2)
      });
      points = routeOrthogonalConnector({
        start: port(from, fromAnchor),
        end: port(to, toAnchor),
        startDirection: fromAnchor,
        endDirection: toAnchor,
        obstacles: lesson.objects,
        startId: from.id,
        endId: to.id
      });
    }
    const start = points[0] ?? { x: from.x + from.width, y: from.y + from.height / 2 };
    scene.push(...convertStable([{
      type: "arrow",
      id: connection.id,
      x: start.x,
      y: start.y,
      points: points.map(p => [p.x - start.x, p.y - start.y]),
      strokeColor: "#34d399",
      strokeWidth: 2,
      roughness: 1,
      roundness: null,
      endArrowhead: "arrow",
      label: connection.label ? { text: connection.label, fontSize: 16, strokeColor: "#a7f3d0" } : undefined
    }], connection.id).map(el => ({ ...el, customData: { chalkieId: connection.id, from: connection.from, to: connection.to } })));
  }
  return scene.map(element => {
    const connection = lesson.connections.find(c => c.id === element.id);
    if (element.type === "arrow" && connection) {
      return {
        ...element,
        elbowed: true,
        startBinding: null,
        endBinding: null,
      };
    }
    return element;
  });
}

export function ChalkCanvas({ lesson, activeSegment, activeStep, isPresenting, isSpeaking = false, activeTargetId = null, revealedStep = null, playbackRequest = 0, onPlaybackState }: {
  lesson?: LessonPlan | null; activeSegment?: LessonSegment | null; activeStep: number; isPresenting: boolean; isSpeaking?: boolean; activeTargetId?: string | null; revealedStep?: number | null; playbackRequest?: number; onPlaybackState?: (state: CanvasPlaybackState) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [ready, setReady] = useState<LessonPlan | null>(null);
  const [imageNotice, setImageNotice] = useState("");
  const [regionBadge, setRegionBadge] = useState<string | null>(null);
  const [laserPos, setLaserPos] = useState<{ x: number; y: number } | null>(null);
  const currentLaserRef = useRef<{ x: number; y: number } | null>(null);
  const sceneRef = useRef<ExcalidrawElement[]>([]);
  const programmatic = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const targetRef = useRef<string | null>(null);
  const lessonRef = useRef(lesson);

  useEffect(() => {
    targetRef.current = activeTargetId || activeSegment?.targetIds?.[0] || null;
    lessonRef.current = lesson;
  }, [activeTargetId, activeSegment, lesson]);

  const resolveWorldTarget = useCallback((): { x: number; y: number; label?: string } | null => {
    let target = targetRef.current;
    if (!target) {
      target = activeSegment?.targetIds?.[0]
        ?? lessonRef.current?.objects.find(o => o.role === "subject" || o.shapeType === "image" || o.image)?.id
        ?? lessonRef.current?.objects[0]?.id
        ?? null;
    }
    if (!target && !lessonRef.current?.objects.length) return null;

    const [id, subId] = (target ?? "").split("#");
    const obj = lessonRef.current?.objects.find(o => o.id === id);

    if (obj) {
      const imgW = obj.width;
      const imgH = obj.image ? obj.width * (obj.image.height / obj.image.width) : obj.height;

      if (subId !== undefined) {
        const numIdx = Number(subId);

        // 1. Try annotation match
        const foundAnn = (!isNaN(numIdx) && obj.annotations?.[numIdx])
          || obj.annotations?.find(a => a.id === subId || a.regionLabel.toLowerCase() === subId.toLowerCase());
        if (foundAnn) {
          const center = getRegionCenter({ x: obj.x, y: obj.y, width: imgW, height: imgH }, foundAnn.normalized);
          return { x: center.x, y: center.y, label: foundAnn.calloutText || foundAnn.regionLabel };
        }

        // 2. Try region match from VLM detection
        const foundReg = (!isNaN(numIdx) && obj.image?.regions?.[numIdx])
          || obj.image?.regions?.find(r => r.label.toLowerCase() === subId.toLowerCase());
        if (foundReg) {
          const center = getRegionCenter({ x: obj.x, y: obj.y, width: imgW, height: imgH }, foundReg);
          return { x: center.x, y: center.y, label: foundReg.label };
        }

        // 3. Try card parts (bullet lines inside a flowchart card)
        const foundPart = (!isNaN(numIdx) && obj.parts?.[numIdx])
          || obj.parts?.find(p => (p.text || "").toLowerCase() === subId.toLowerCase());
        if (foundPart) {
          const pIdx = (!isNaN(numIdx) && obj.parts?.[numIdx]) ? numIdx : obj.parts.indexOf(foundPart);
          const partCount = Math.max(1, obj.parts.length);
          const py = obj.y + ((pIdx + 0.5) / partCount) * obj.height;
          return { x: obj.x + obj.width * 0.5, y: py, label: foundPart.text || obj.label };
        }
      }

      // Default to center of object
      return {
        x: obj.x + obj.width * 0.5,
        y: obj.y + (obj.image ? imgH * 0.5 : obj.height * 0.5),
        label: obj.label || activeSegment?.title
      };
    }

    // Check if target is an annotation across all objects
    for (const o of lessonRef.current?.objects ?? []) {
      const ann = o.annotations?.find(a => a.id === id || a.regionLabel.toLowerCase() === id.toLowerCase());
      if (ann) {
        const imgW = o.width;
        const imgH = o.image ? o.width * (o.image.height / o.image.width) : o.height;
        const center = getRegionCenter({ x: o.x, y: o.y, width: imgW, height: imgH }, ann.normalized);
        return { x: center.x, y: center.y, label: ann.calloutText || ann.regionLabel };
      }
    }

    // Check if target is a flowchart transition connector
    const conn = lessonRef.current?.connections.find(c => c.id === id || c.label.toLowerCase() === id.toLowerCase());
    if (conn) {
      const fromObj = lessonRef.current?.objects.find(o => o.id === conn.from);
      const toObj = lessonRef.current?.objects.find(o => o.id === conn.to);
      if (fromObj && toObj) {
        return {
          x: (fromObj.x + fromObj.width / 2 + toObj.x + toObj.width / 2) / 2,
          y: (fromObj.y + fromObj.height / 2 + toObj.y + toObj.height / 2) / 2,
          label: conn.label || "Flowchart Transition"
        };
      }
    }

    // Try scene elements
    const el = sceneRef.current.find(e => e.id === id || e.customData?.chalkieId === id || e.customData?.annotationId === id);
    if (el) {
      return {
        x: el.x + el.width * 0.5,
        y: el.y + el.height * 0.5,
        label: activeSegment?.title || (el.customData as any)?.regionLabel
      };
    }

    // Fallback to first object in lesson
    const first = lessonRef.current?.objects[0];
    if (first) {
      const firstH = first.image ? first.width * (first.image.height / first.image.width) : first.height;
      return {
        x: first.x + first.width * 0.5,
        y: first.y + firstH * 0.5,
        label: first.label || activeSegment?.title
      };
    }

    return null;
  }, [activeSegment]);

  useEffect(() => {
    let animId: number;
    let wanderTick = 0;

    const animateLaser = () => {
      if (!api || !ready) {
        animId = requestAnimationFrame(animateLaser);
        return;
      }

      const worldTarget = resolveWorldTarget();
      if (!worldTarget) {
        currentLaserRef.current = null;
        setLaserPos(null);
        setRegionBadge(null);
        animId = requestAnimationFrame(animateLaser);
        return;
      }

      const state = api.getAppState();
      if (!state) {
        animId = requestAnimationFrame(animateLaser);
        return;
      }

      // Project the world target directly using live scrollX, scrollY, and zoom
      const targetScreenX = (worldTarget.x + state.scrollX) * state.zoom.value;
      const targetScreenY = (worldTarget.y + state.scrollY) * state.zoom.value;

      wanderTick += 0.03;
      // Precise organic micro-breathing (under 0.8px) so the tip stays 100% locked on target
      const wanderX = Math.sin(wanderTick * 1.6) * 0.6;
      const wanderY = Math.cos(wanderTick * 1.9) * 0.5;

      const destX = targetScreenX + wanderX;
      const destY = targetScreenY + wanderY;

      const cur = currentLaserRef.current ?? { x: destX, y: destY };
      const dx = destX - cur.x;
      const dy = destY - cur.y;

      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        cur.x += dx * 0.25;
        cur.y += dy * 0.25;
        currentLaserRef.current = { ...cur };
        setLaserPos({ ...cur });
      } else {
        currentLaserRef.current = { x: destX, y: destY };
        setLaserPos({ x: destX, y: destY });
      }

      setRegionBadge(worldTarget.label ?? activeSegment?.title ?? null);
      animId = requestAnimationFrame(animateLaser);
    };

    animId = requestAnimationFrame(animateLaser);
    return () => cancelAnimationFrame(animId);
  }, [api, ready, isSpeaking, resolveWorldTarget, activeSegment]);

  useEffect(() => {
    if (!api || !lesson) return;
    const controller = new AbortController();
    const load = async () => {
      const loaded = new Set<string>();
      const files: BinaryFileData[] = [];
      let failedImage = false;
      await Promise.all(lesson.objects.filter(o => o.image).map(async o => {
        const asset = o.image!;
        try {
          const blob = await loadImageBlob(asset.id, asset.url, controller.signal);
          const bitmap = await createImageBitmap(blob); bitmap.close();
          const dataURL = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
          files.push({ id: asset.id as FileId, dataURL: dataURL as BinaryFileData["dataURL"], mimeType: blob.type as BinaryFileData["mimeType"], created: Date.now() }); loaded.add(asset.id);
        } catch { if (!controller.signal.aborted) failedImage = true; }
      }));
      if (controller.signal.aborted) return;
      if (files.length) api.addFiles(files);
      sceneRef.current = sceneFor(lesson, loaded);
      try {
        const saved = JSON.parse(localStorage.getItem(`chalkie:scene-v2:${lesson.id}`) || "null");
        if (Array.isArray(saved)) {
          // Never restore old/stale annotation elements (arrows, badges, shade/contour boxes) from localStorage
          const isAnnotationEl = (id: string, data?: any) =>
            id.startsWith("ann-") ||
            id.endsWith("-arrow") ||
            id.endsWith("-badge") ||
            id.endsWith("-shade") ||
            id.endsWith("-contour") ||
            Boolean(data?.annotationId);

          const byId = new Map(saved.filter((el: ExcalidrawElement) => !isAnnotationEl(el.id, el.customData)).map((el: ExcalidrawElement) => [el.id, el]));
          sceneRef.current = sceneRef.current.map(el => {
            if (isAnnotationEl(el.id, el.customData)) return el; // Keep freshly calculated annotations!
            return byId.get(el.id)?.type === el.type ? { ...el, ...byId.get(el.id), boundElements: el.boundElements, customData: el.customData, isDeleted: false, ...(el.type === "text" ? { containerId: el.containerId } : {}) } : el;
          });
          const generatedIds = new Set(sceneRef.current.map(el => el.id));
          sceneRef.current.push(...saved.filter((el: ExcalidrawElement) => !el.customData?.chalkieId && !isAnnotationEl(el.id, el.customData) && !el.isDeleted && !generatedIds.has(el.id)));
        }
      } catch { /* storage is optional */ }
      // Normalize imported and saved arrow points before the editor reads them.
      sceneRef.current = restoreElements(sceneRef.current, null, { repairBindings: true });
      setImageNotice(failedImage ? "A reference image could not load. The explanation is still available." : "");
      setReady(lesson);
    };
    void load().catch(() => { if (!controller.signal.aborted) onPlaybackState?.({ status: "error", request: playbackRequest, message: "The board could not load. Reload to try again." }); });
    return () => { controller.abort(); clearTimeout(saveTimer.current); };
    // Reload assets only when the lesson/editor changes, not at each narration cue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, lesson]);

  useEffect(() => {
    if (!api || ready !== lesson || !lesson) { onPlaybackState?.({ status: "loading", request: playbackRequest }); return; }
    const step = revealedStep === null ? activeStep : Math.max(activeStep, revealedStep);
    const visible = new Set(getProgressiveVisibleObjects(lesson, step, revealedStep !== null).map(o => o.id));
    const elements = sceneRef.current.filter(el => {
      const data = el.customData;
      return !data?.chalkieId || visible.has(String(data.chalkieId)) || (data.from && visible.has(String(data.from)) && visible.has(String(data.to)));
    });
    programmatic.current = true;
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    programmatic.current = false;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => onPlaybackState?.({ status: "ready", request: playbackRequest })); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [api, ready, lesson, activeStep, revealedStep, playbackRequest, onPlaybackState]);

  useEffect(() => {
    if (!api || ready !== lesson) return;
    if (!lesson) return;
    const targets = teachingFrameIds(lesson, activeSegment?.targetIds ?? []);
    const elements = api.getSceneElements();
    const focused = targets.size ? elements.filter(el => targets.has(String(el.customData?.chalkieId))) : elements;
    if (focused.length) api.scrollToContent(focused, { fitToContent: true, animate: isPresenting, duration: 350 });
  }, [api, ready, lesson, activeSegment, isPresenting]);

  useEffect(() => {
    if (!api || ready !== lesson || !lesson) return;
    const handleResize = () => {
      const targets = teachingFrameIds(lesson, activeSegment?.targetIds ?? []);
      const elements = api.getSceneElements();
      const focused = targets.size ? elements.filter(el => targets.has(String(el.customData?.chalkieId))) : elements;
      if (focused.length) api.scrollToContent(focused, { fitToContent: true, animate: false });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [api, ready, lesson, activeSegment]);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], _state: AppState) => {
    if (!programmatic.current && ready && !isPresenting) {
      const updates = new Map(elements.map(el => [el.id, el]));
      sceneRef.current = sceneRef.current.map(el => updates.get(el.id) || el);
      for (const el of elements) if (!sceneRef.current.some(known => known.id === el.id)) sceneRef.current.push(el);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { try { localStorage.setItem(`chalkie:scene-v2:${ready.id}`, JSON.stringify(sceneRef.current)); } catch { /* quota */ } }, 600);
    }
  }, [ready, isPresenting]);

  return <div className={`excalidraw-shell relative h-full w-full ${isPresenting ? "is-teaching" : ""} ${showTools ? "with-tools" : ""}`} aria-label="Interactive teaching whiteboard">
    <Excalidraw excalidrawAPI={setApi} theme="dark" viewModeEnabled={isPresenting || !showTools} initialData={INITIAL_DATA} UIOptions={UI_OPTIONS} onChange={handleChange} />
    {!isPresenting && (
      <button
        type="button"
        onClick={() => setShowTools(current => !current)}
        className="absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-lg border border-[#3b3f46] bg-[#202327]/90 px-2.5 py-1.5 text-xs font-medium text-[#c4b5fd] shadow-sm backdrop-blur transition hover:border-[#8a7aab] hover:bg-[#282c32] hover:text-[#f3f3ee]"
        aria-label={showTools ? "Hide whiteboard tools" : "Show whiteboard tools"}
        title={showTools ? "Hide whiteboard tools" : "Show whiteboard tools"}
      >
        {showTools ? (
          <>
            <EyeOff size={13} />
            <span>Hide tools</span>
          </>
        ) : (
          <>
            <PenTool size={13} />
            <span>Show tools</span>
          </>
        )}
      </button>
    )}
    {laserPos && (
      <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-hidden" aria-hidden="true">
        <defs>
          <filter id="laser-dot-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#ff1744" floodOpacity="0.95" />
            <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#ff0033" floodOpacity="0.75" />
          </filter>
        </defs>

        {/* Sleek Teacher Pointer Cursor with Glowing Laser Tip */}
        <g transform={`translate(${laserPos.x}, ${laserPos.y})`}>
          {/* Concentric pulsing ripples radiating from the pointer tip */}
          <circle cx="0" cy="0" r="18" fill="none" stroke="#ff1744" strokeWidth="1.4">
            <animate attributeName="r" values="4;22;4" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.85;0.05;0.85" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="0" cy="0" r="10" fill="none" stroke="#ff5252" strokeWidth="1.2">
            <animate attributeName="r" values="3;13;3" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1.8s" repeatCount="indefinite" />
          </circle>

          {/* Teacher Cursor Pointer Arrow (pointing directly with tip at 0, 0) */}
          <path
            d="M 0 0 L 0 17 L 4.5 12.5 L 8.5 21 L 11.5 19.5 L 7.5 11 L 13.5 11 Z"
            fill="#0f1117"
            stroke="#ff1744"
            strokeWidth="1.6"
            strokeLinejoin="round"
            filter="drop-shadow(0 2px 8px rgba(0, 0, 0, 0.75))"
          />
          {/* Inner cursor highlight */}
          <path
            d="M 1.5 2.5 L 1.5 14 L 4.5 11 L 8.5 18.5 L 9.8 17.8 L 6.2 10 L 11 10 Z"
            fill="#ffffff"
            opacity="0.9"
          />

          {/* High-intensity Ruby Laser Dot at the exact pointer tip */}
          <circle cx="0" cy="0" r="6" fill="#ff1744" opacity="0.5" filter="url(#laser-dot-glow)" />
          <circle cx="0" cy="0" r="3.8" fill="#ff0033" filter="url(#laser-dot-glow)" />
          <circle cx="0" cy="0" r="1.6" fill="#ffffff" />
        </g>

        {/* Floating Live Guide Pill - informs the user what is currently being explained */}
        {regionBadge && (
          <g transform={`translate(${Math.round(laserPos.x + 20)}, ${Math.round(laserPos.y - 18)})`}>
            <rect
              x="0"
              y="-13"
              width={Math.max(92, regionBadge.length * 7.5 + 32)}
              height="26"
              rx="13"
              fill="rgba(15, 17, 23, 0.94)"
              stroke="#ff1744"
              strokeWidth="1.4"
              filter="drop-shadow(0 2px 8px rgba(255, 23, 68, 0.45))"
            />
            {/* Pulsing red live tracking dot */}
            <circle cx="12" cy="0" r="3.5" fill="#ff1744">
              <animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />
            </circle>
            <text
              x="22"
              y="4"
              fill="#ffffff"
              fontSize="11"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontWeight="600"
              letterSpacing="0.02em"
            >
              {regionBadge}
            </text>
          </g>
        )}
      </svg>
    )}
    {imageNotice && <p role="status" className="absolute bottom-12 left-3 right-3 rounded-lg bg-[#24272d] px-3 py-2 text-xs text-[#e9bd92]">{imageNotice}</p>}
  </div>;
}
