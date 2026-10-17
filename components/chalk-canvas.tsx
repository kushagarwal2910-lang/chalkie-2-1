"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements, restoreElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFileData, AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { LessonPlan, LessonSegment } from "@/lib/lesson-schema";
import type { CanvasPlaybackState } from "@/lib/playback-sync";
import { getProgressiveVisibleObjects, getProgressiveScene } from "@/lib/progressive-scene";
import { loadImageBlob } from "@/lib/image-cache";
import { boundsForPoints, cameraForTarget, interactionCurve, resolveTeachingTarget, type TeachingCue, type TeachingTarget, type Point } from "@/lib/teaching-focus";
import { boardFontSize, boardTextLines } from "@/lib/teaching-layout";
import { compileImageAnnotationSkeletons } from "@/lib/image-annotations";

import { routeOrthogonalConnector } from "@/lib/connector-routing";
import { formatCardMathForCanvas } from "@/lib/math-formatter";
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
        const textObj = updated as unknown as { width: number; x: number; textAlign: string; verticalAlign: string; text?: string; fontSize?: number };
        const lines = (textObj.text || "").split("\n");
        const longestLineLength = Math.max(...lines.map(l => l.length), 0);
        const fSize = textObj.fontSize || 20;
        const estimatedTextWidth = Math.max(textObj.width, longestLineLength * fSize * 0.62);
        const maxInnerWidth = Math.max(40, container.width - 48); // 24px padding on each side
        const textWidth = Math.min(estimatedTextWidth, maxInnerWidth);
        textObj.width = textWidth;
        textObj.textAlign = "center";
        textObj.verticalAlign = "middle";
        // Clamp x so first character NEVER starts at or left of container.x + 20 and has >= 20px margin
        textObj.x = Math.max(container.x + 20, container.x + (container.width - textWidth) / 2);
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
        { type: "text", id: `${o.id}-caption`, x: o.x, y: o.y + height + 14, fontFamily: /[^\u0000-\u024f]/.test(o.label) ? 2 : 5, text: formatCardMathForCanvas(o.image.provenance === "generated" ? `${o.label}\nAI-generated illustration` : o.label), fontSize: 20, strokeColor: "#f1f5f9", width: o.width }
      ];
      // Do NOT generate external margin callout arrows on generated plots
      if (o.annotations && o.annotations.length > 0 && o.image.provenance !== "plot") {
        skeleton.push(...compileImageAnnotationSkeletons(o, o.annotations));
      }
    } else if (o.shapeType === "note" || o.shapeType === "image") {
      skeleton = [{
        ...common,
        type: "rectangle",
        roundness: { type: 3 },
        strokeWidth: 1.5,
        label: {
          fontFamily: /[^\u0000-\u024f]/.test(o.label) ? 2 : 5,
          text: boardTextLines(o).join("\n"),
          fontSize: 20,
          strokeColor: "#f1f5f9",
          textAlign: "center",
          verticalAlign: "middle",
        }
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
        label: {
          text: boardTextLines(o).join("\n"),
          fontSize: 20,
          strokeColor: "#f1f5f9",
          textAlign: "center",
          verticalAlign: "middle",
        }
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

export function ChalkCanvas({ lesson, activeSegment, activeStep, isPresenting, isSpeaking = false, activeTargetId = null, activeCue = null, revealedStep = null, playbackRequest = 0, onPlaybackState }: {
  lesson?: LessonPlan | null; activeSegment?: LessonSegment | null; activeStep: number; isPresenting: boolean; isSpeaking?: boolean; activeTargetId?: string | null; activeCue?: TeachingCue | null; revealedStep?: number | null; playbackRequest?: number; onPlaybackState?: (state: CanvasPlaybackState) => void;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [ready, setReady] = useState<LessonPlan | null>(null);
  const [imageNotice, setImageNotice] = useState("");
  const [pausedCameraRequest, setPausedCameraRequest] = useState<string | null>(null);
  const cameraRequest = `${lesson?.id}:${playbackRequest}`;
  const cameraPaused = pausedCameraRequest === cameraRequest;
  const [reducedMotion, setReducedMotion] = useState(false);
  const [overlaySnapshot, setOverlay] = useState<{
    lessonId: string;
    target: TeachingTarget; destination: TeachingTarget | null;
    zoom: number; scrollX: number; scrollY: number; width: number; height: number;
  } | null>(null);
  const markerId = useId().replace(/:/g, "");
  const sceneRef = useRef<ExcalidrawElement[]>([]);
  const programmatic = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cameraAnimation = useRef(0);
  const queueCameraFrame = useRef<(() => void) | null>(null);
  const editorViewport = useRef<{ width: number; height: number } | null>(null);
  const activeTarget = activeCue?.targetId ?? activeTargetId ?? activeSegment?.targetIds?.[0] ?? null;
  const overlay = isSpeaking && ready === lesson && overlaySnapshot?.lessonId === lesson?.id && overlaySnapshot?.target.id === activeTarget ? overlaySnapshot : null;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const pauseCamera = useCallback(() => {
    cancelAnimationFrame(cameraAnimation.current);
    setPausedCameraRequest(cameraRequest);
  }, [cameraRequest]);

  // Focus is attached to the live image transform, including user resize/rotation/flip.
  // There is no wandering cursor and no fallback to an unrelated object's center.
  useEffect(() => {
    if (!api || ready !== lesson || !lesson || !isSpeaking) return;
    let frame = 0;
    let lastSnapshot = "";
    const update = () => {
      const elements = api.getSceneElements();
      const target = resolveTeachingTarget(activeTarget, lesson.objects, lesson.connections, elements);
      let destination: TeachingTarget | null = null;
      if (activeCue?.toTargetId) {
        destination = resolveTeachingTarget(activeCue.toTargetId, lesson.objects, lesson.connections, elements);
      } else if (activeSegment?.targetIds && activeSegment.targetIds.length >= 2) {
        const t0 = activeSegment.targetIds[0];
        const t1 = activeSegment.targetIds[1];
        if (t0 && t1 && t0.includes("#") && t1.includes("#")) {
          const [img0] = t0.split("#");
          const [img1] = t1.split("#");
          if (img0 === img1 && (activeTarget === t0 || activeTarget === img0)) {
            destination = resolveTeachingTarget(t1, lesson.objects, lesson.connections, elements);
          }
        }
      }
      const state = api.getAppState();
      const snapshot = JSON.stringify([target, destination, state.zoom.value, state.scrollX, state.scrollY, state.width, state.height]);
      if (snapshot !== lastSnapshot) {
        setOverlay(target ? { lessonId: lesson.id, target, destination, zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY, width: state.width, height: state.height } : null);
        lastSnapshot = snapshot;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [api, ready, lesson, isSpeaking, activeTarget, activeCue?.toTargetId, activeSegment?.targetIds]);

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
          if (blob.type.split(";")[0] === "image/svg+xml") {
            if (typeof Image !== "undefined") {
              const objectUrl = URL.createObjectURL(blob);
              try {
                const image = new Image();
                image.src = objectUrl;
                if (typeof image.decode === "function") {
                  await image.decode().catch(() => undefined);
                }
              } catch {
                // validation is optional
              } finally {
                URL.revokeObjectURL(objectUrl);
              }
            }
          } else if (typeof createImageBitmap === "function") {
            const bitmap = await createImageBitmap(blob);
            bitmap.close();
          }
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
          const isAnnotationEl = (id: string, data?: ExcalidrawElement["customData"]) =>
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
    const isProgressive = isPresenting || revealedStep !== null;
    const currentStep = revealedStep !== null ? Math.max(activeStep, revealedStep) : (isPresenting ? activeStep : lesson.segments.length - 1);
    const { visibleObjectIds, visibleConnectionIds, newlyRevealedIds } = getProgressiveScene(lesson, currentStep, isProgressive);
    const elements = sceneRef.current.filter(el => {
      const data = el.customData;
      if (!data?.chalkieId) return true;
      const chalkieId = String(data.chalkieId);
      if (visibleObjectIds.has(chalkieId)) return true;
      if (data.from && data.to) {
        return visibleConnectionIds.has(chalkieId) || (visibleObjectIds.has(String(data.from)) && visibleObjectIds.has(String(data.to)));
      }
      return false;
    }).map(el => {
      const data = el.customData;
      const chalkieId = data?.chalkieId ? String(data.chalkieId) : el.id;
      if (newlyRevealedIds.has(chalkieId)) {
        if (el.type === "rectangle" || el.type === "ellipse") {
          return {
            ...el,
            strokeColor: "#a78bfa",
            backgroundColor: "rgba(167, 139, 250, 0.22)",
            strokeWidth: 2.5,
          };
        }
        if (el.type === "arrow") {
          return {
            ...el,
            strokeColor: "#a78bfa",
            strokeWidth: 2.5,
          };
        }
      }
      return el;
    });
    programmatic.current = true;
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    programmatic.current = false;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      // updateScene commits asynchronously; frame the restored scene after its actual first paint.
      queueCameraFrame.current?.();
      onPlaybackState?.({ status: "ready", request: playbackRequest });
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [api, ready, lesson, activeStep, revealedStep, isPresenting, playbackRequest, onPlaybackState]);

  useEffect(() => {
    cancelAnimationFrame(cameraAnimation.current);
    if (!api || ready !== lesson || !lesson || cameraPaused) return;
    const container = document.getElementById(`chalkie-canvas-${markerId}`);
    let pendingFrame = 0;
    let settledFrame = 0;
    let disposed = false;
    const frameCamera = () => {
      cancelAnimationFrame(cameraAnimation.current);
      const width = container?.clientWidth ?? 0, height = container?.clientHeight ?? 0;
      if (width < 2 || height < 2) return; // Hidden/resizing panels do not define a usable viewport.
      const elements = api.getSceneElements();
      let target = resolveTeachingTarget(activeTarget, lesson.objects, lesson.connections, elements);
      if (!target && !isPresenting && activeTarget) target = resolveTeachingTarget(activeTarget.split("#")[0], lesson.objects, lesson.connections, elements);
      if (!target && (!activeSegment || !isPresenting)) {
        const targets = lesson.objects.map(o => resolveTeachingTarget(o.id, lesson.objects, lesson.connections, elements)).filter((t): t is TeachingTarget => !!t);
        if (targets.length) {
          const bounds = boundsForPoints(targets.flatMap(t => t.polygon));
          target = { ...targets[0], kind: "card", bounds, center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } };
        }
      }
      if (!target) return;
      let intraDest: TeachingTarget | null = null;
      if (activeCue?.toTargetId) {
        intraDest = resolveTeachingTarget(activeCue.toTargetId, lesson.objects, lesson.connections, elements);
      } else if (activeSegment?.targetIds && activeSegment.targetIds.length >= 2) {
        const t0 = activeSegment.targetIds[0];
        const t1 = activeSegment.targetIds[1];
        if (t0 && t1 && t0.includes("#") && t1.includes("#")) {
          const [img0] = t0.split("#");
          const [img1] = t1.split("#");
          if (img0 === img1 && (activeTarget === t0 || activeTarget === img0)) {
            intraDest = resolveTeachingTarget(t1, lesson.objects, lesson.connections, elements);
          }
        }
      }
      if (intraDest && target && interactionCurve(target, intraDest)) {
        const bounds = boundsForPoints([...target.polygon, ...intraDest.polygon]);
        target = { ...target, bounds, center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } };
      }
      const state = api.getAppState();
      // The editor's state dimensions can lag a responsive panel resize by a React commit.
      // Fit to the actual drawable container instead of persisting that transient stale frame.
      const desired = cameraForTarget(target, { width, height });
      const start = { x: width / (2 * state.zoom.value) - state.scrollX, y: height / (2 * state.zoom.value) - state.scrollY, zoom: state.zoom.value };
      const end = { x: width / (2 * desired.zoom) - desired.scrollX, y: height / (2 * desired.zoom) - desired.scrollY };
      const startedAt = performance.now();
      const duration = reducedMotion ? 0 : 550;
      const animate = (now: number) => {
        const progress = duration ? Math.min(1, (now - startedAt) / duration) : 1;
        const eased = progress * progress * (3 - 2 * progress);
        const zoom = Math.exp(Math.log(start.zoom) + (Math.log(desired.zoom) - Math.log(start.zoom)) * eased);
        programmatic.current = true;
        api.updateScene({ appState: {
          zoom: { value: zoom as AppState["zoom"]["value"] },
          scrollX: width / (2 * zoom) - (start.x + (end.x - start.x) * eased),
          scrollY: height / (2 * zoom) - (start.y + (end.y - start.y) * eased),
        }, captureUpdate: CaptureUpdateAction.NEVER });
        programmatic.current = false;
        if (progress < 1) cameraAnimation.current = requestAnimationFrame(animate);
      };
      cameraAnimation.current = requestAnimationFrame(animate);
    };
    const scheduleFrame = () => {
      cancelAnimationFrame(pendingFrame);
      cancelAnimationFrame(settledFrame);
      let retries = 0;
      const settle = () => {
        if (disposed) return;
        const state = api.getAppState();
        const width = container?.clientWidth ?? 0, height = container?.clientHeight ?? 0;
        if (width < 2 || height < 2) return;
        const dimensionsReady = Math.abs(state.width - width) <= 2 && Math.abs(state.height - height) <= 2;
        const sceneReady = api.getSceneElements().length > 0;
        if ((!dimensionsReady || !sceneReady) && retries++ < 12) { settledFrame = requestAnimationFrame(settle); return; }
        if (sceneReady) frameCamera();
      };
      pendingFrame = requestAnimationFrame(() => { settledFrame = requestAnimationFrame(settle); });
    };
    queueCameraFrame.current = scheduleFrame;
    scheduleFrame();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleFrame) : null;
    if (container) observer?.observe(container);
    return () => {
      disposed = true;
      if (queueCameraFrame.current === scheduleFrame) queueCameraFrame.current = null;
      cancelAnimationFrame(pendingFrame); cancelAnimationFrame(settledFrame); cancelAnimationFrame(cameraAnimation.current); observer?.disconnect();
    };
  }, [api, ready, lesson, activeSegment, activeTarget, activeCue?.kind, activeCue?.toTargetId, isPresenting, cameraPaused, reducedMotion, markerId]);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], state: AppState) => {
    if (editorViewport.current?.width !== state.width || editorViewport.current?.height !== state.height) {
      editorViewport.current = { width: state.width, height: state.height };
      queueCameraFrame.current?.();
    }
    if (!programmatic.current && ready && !isPresenting) {
      const updates = new Map(elements.map(el => [el.id, el]));
      sceneRef.current = sceneRef.current.map(el => updates.get(el.id) || el);
      for (const el of elements) if (!sceneRef.current.some(known => known.id === el.id)) sceneRef.current.push(el);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { try { localStorage.setItem(`chalkie:scene-v2:${ready.id}`, JSON.stringify(sceneRef.current)); } catch { /* quota */ } }, 600);
    }
  }, [ready, isPresenting]);

  const screen = (point: Point): Point => overlay ? { x: (point.x + overlay.scrollX) * overlay.zoom, y: (point.y + overlay.scrollY) * overlay.zoom } : point;
  const screenPoints = overlay?.target.polygon.map(screen) ?? [];
  const pointer = overlay ? screen(overlay.target.center) : null;
  const curve = overlay?.destination ? interactionCurve(overlay.target, overlay.destination) : null;
  const curvePath = curve ? (() => { const a = screen(curve.start), b = screen(curve.control), c = screen(curve.end); return `M ${a.x} ${a.y} Q ${b.x} ${b.y} ${c.x} ${c.y}`; })() : null;
  const focusPath = screenPoints.length ? `M ${screenPoints.map(p => `${p.x} ${p.y}`).join(" L ")} Z` : "";
  const mixPoint = (p: Point, q: Point, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const regionEllipsePath = (screenPoints.length === 4 && overlay?.target.kind === "region") ? (() => {
    const [a, b, c, d] = screenPoints;
    const center = mixPoint(a, c, 0.5);
    const pts = Array.from({ length: 49 }, (_, i) => {
      const angle = (i / 48) * Math.PI * 2;
      return {
        x: center.x + ((b.x - a.x) / 2) * Math.cos(angle) + ((d.x - a.x) / 2) * Math.sin(angle),
        y: center.y + ((b.y - a.y) / 2) * Math.cos(angle) + ((d.y - a.y) / 2) * Math.sin(angle),
      };
    });
    return `M ${pts.map(p => `${p.x} ${p.y}`).join(" L ")} Z`;
  })() : "";
  let drawingPath = "";
  if (screenPoints.length === 4 && overlay?.target.kind === "region") {
    const [a, b, c, d] = screenPoints;
    if (activeCue?.kind === "circle") {
      drawingPath = regionEllipsePath;
    } else if (activeCue?.kind === "bracket") {
      const points = [mixPoint(a, b, 0.18), a, d, mixPoint(d, c, 0.18), mixPoint(b, a, 0.18), b, c, mixPoint(c, d, 0.18)];
      drawingPath = points.map((p, i) => `${i === 0 || i === 4 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    }
  }
  const drawingKey = `${activeSegment?.id}-${activeCue?.phrase}-${activeCue?.kind}-${activeCue?.targetId}-${activeCue?.toTargetId}`;

  return <div id={`chalkie-canvas-${markerId}`} className={`excalidraw-shell relative h-full w-full ${isPresenting ? "is-teaching" : ""} ${showTools ? "with-tools" : ""}`} aria-label="Interactive teaching whiteboard"
    onWheelCapture={pauseCamera}
    onPointerDownCapture={event => { if (!(event.target as Element).closest("button")) pauseCamera(); }}
    onKeyDownCapture={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)) pauseCamera(); }}>
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
    {cameraPaused && isPresenting && <button type="button" onClick={() => setPausedCameraRequest(null)} className="absolute right-3 top-3 z-30 rounded-lg border border-cyan-700 bg-slate-950/95 px-3 py-2 text-xs text-cyan-100">Follow teacher camera</button>}
    {overlay && pointer && (
      <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-hidden" aria-hidden="true">
        <defs>
          <marker id={`${markerId}-arrow`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 10 6 L 1 11" fill="none" stroke="#67e8f9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></marker>
          {curvePath && <mask id={`${markerId}-reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width={overlay.width} height={overlay.height}>
            <path key={drawingKey} d={curvePath} fill="none" stroke="white" strokeWidth="32" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset="0">
              {!reducedMotion && <animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.65s" fill="freeze" />}
            </path>
          </mask>}
        </defs>
        {overlay.target.kind === "region" && <path d={regionEllipsePath || focusPath} fill="#67e8f9" fillOpacity="0.12" stroke="#67e8f9" strokeOpacity="0.85" strokeWidth="2" strokeDasharray="6 4" />}
        {overlay.target.kind === "card" && <path d={focusPath} fill="#a78bfa" fillOpacity="0.06" stroke="#a78bfa" strokeOpacity="0.85" strokeWidth="2.5" strokeDasharray="8 5" />}
        {curvePath && (activeCue?.kind === "arrow" || (overlay.target.kind === "region" && overlay.destination?.kind === "region")) && <path d={curvePath} fill="none" stroke="#67e8f9" strokeWidth="3" strokeDasharray="8 6" strokeLinecap="round" markerEnd={`url(#${markerId}-arrow)`} mask={`url(#${markerId}-reveal)`} />}
        {drawingPath && <path key={drawingKey} d={drawingPath} fill="none" stroke="#fef08a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset="0">
          {!reducedMotion && <animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.55s" fill="freeze" />}
        </path>}
        <circle cx={pointer.x} cy={pointer.y} r="8" fill="#fb7185" fillOpacity="0.18" />
        <circle cx={pointer.x} cy={pointer.y} r="3.5" fill="#fda4af" stroke="white" strokeWidth="1" />
        <g transform={`translate(${Math.max(8, Math.min(overlay.width - Math.min(280, overlay.target.label.length * 7 + 22) - 8, pointer.x + 16))}, ${Math.max(28, Math.min(overlay.height - 16, pointer.y - 18))})`}>
          <rect x="0" y="-18" width={Math.min(280, overlay.target.label.length * 7 + 22)} height="27" rx="8" fill="#0f172a" fillOpacity="0.95" stroke="#67e8f9" strokeOpacity="0.6" />
          <text x="10" y="0" fill="#f1f5f9" fontSize="12" fontFamily="system-ui, sans-serif"><title>{overlay.target.label}</title>{overlay.target.label.length > 36 ? `${overlay.target.label.slice(0, 35)}…` : overlay.target.label}</text>
        </g>
      </svg>
    )}
    {imageNotice && <p role="status" className="absolute bottom-12 left-3 right-3 rounded-lg bg-[#24272d] px-3 py-2 text-xs text-[#e9bd92]">{imageNotice}</p>}
  </div>;
}
