"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, Link, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { importDocument } from "@/lib/document-import";
import { SOURCE_LIMITS, sourceMaterialSchema, sourceMaterialsSchema, type SourceMaterial } from "@/lib/source-materials";
import { loadSourceMaterials, saveSourceMaterials } from "@/lib/source-storage";

export type SourceInputProps = {
  sessionId: string;
  materials: SourceMaterial[];
  includeWebSearch: boolean;
  onMaterialsChange: (materials: SourceMaterial[]) => void;
  onIncludeWebSearchChange: (include: boolean) => void;
  onImportingChange?: (importing: boolean) => void;
  /** When supplied, the parent owns session hydration; this form must not reload it. */
  hydrated?: boolean;
  initiallyOpen?: boolean;
  label?: string;
  disabled?: boolean;
};

export function SourceInput({ sessionId, materials, includeWebSearch, onMaterialsChange, onIncludeWebSearchChange, onImportingChange, hydrated, initiallyOpen = false, label = "Lesson sources", disabled = false }: SourceInputProps) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [mode, setMode] = useState<"file" | "url" | "text">("file");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [readySession, setReadySession] = useState("");
  const inputId = useId();
  const storageReady = hydrated ?? readySession === sessionId;
  // Hydration and a user import are separate: startup generation may use a fresh session.
  useEffect(() => { onImportingChange?.(Boolean(progress)); }, [progress, onImportingChange]);
  const importRevision = useRef(0);
  useEffect(() => () => { importRevision.current++; }, [sessionId]);
  const callbacks = useRef({ onMaterialsChange, onIncludeWebSearchChange });
  useEffect(() => { callbacks.current = { onMaterialsChange, onIncludeWebSearchChange }; }, [onMaterialsChange, onIncludeWebSearchChange]);
  useEffect(() => {
    if (hydrated !== undefined) return;
    let active = true;
    loadSourceMaterials(sessionId).then(saved => {
      if (!active) return;
      if (saved) { callbacks.current.onMaterialsChange(saved.materials); callbacks.current.onIncludeWebSearchChange(saved.includeWebSearch); }
      setReadySession(sessionId);
    }).catch(() => { if (active) { setStorageError("Sources work in this tab, but browser storage is unavailable."); setReadySession(sessionId); } });
    return () => { active = false; };
  }, [sessionId, hydrated]);
  useEffect(() => {
    if (!storageReady || disabled) return;
    const timeout = setTimeout(() => {
      void saveSourceMaterials(sessionId, materials, includeWebSearch).catch(() => setStorageError("Browser storage is full. Keep this tab open to retain your sources."));
    }, 200);
    return () => clearTimeout(timeout);
  }, [sessionId, materials, includeWebSearch, storageReady, disabled]);

  const busy = Boolean(progress) || disabled || !storageReady;
  const addMaterial = (material: SourceMaterial) => {
    const parsed = sourceMaterialsSchema.safeParse([...materials, material]);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "This source exceeds the lesson limits.");
    onMaterialsChange(parsed.data);
  };

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const revision = ++importRevision.current;
    setError("");
    let next = materials;
    try {
      for (const file of Array.from(files)) {
        if (next.length >= SOURCE_LIMITS.materials) throw new Error("Use at most eight sources per lesson.");
        setProgress(`Reading ${file.name}`);
        const material = await importDocument(file, message => { if (revision === importRevision.current) setProgress(message); });
        if (revision !== importRevision.current) return;
        const remainingImages = SOURCE_LIMITS.images - next.reduce((total, value) => total + value.images.length, 0);
        material.images = material.images.slice(0, Math.max(0, remainingImages));
        next = sourceMaterialsSchema.parse([...next, material]);
        onMaterialsChange(next);
      }
    } catch (reason) { if (revision === importRevision.current) setError(reason instanceof Error ? reason.message : "The document could not be read."); }
    finally { if (revision === importRevision.current) setProgress(""); }
  }

  async function addUrl() {
    const revision = ++importRevision.current;
    setError(""); setProgress("Importing readable source text");
    try {
      const response = await fetch("/api/sources/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: sourceUrl }), signal: AbortSignal.timeout(50_000) });
      const result = await response.json() as { material?: unknown; error?: string };
      if (revision !== importRevision.current) return;
      if (!response.ok) throw new Error(result.error || "The source could not be imported.");
      addMaterial(sourceMaterialSchema.parse(result.material)); setSourceUrl("");
    } catch (reason) { if (revision === importRevision.current) setError(reason instanceof Error ? reason.message : "The source could not be imported."); }
    finally { if (revision === importRevision.current) setProgress(""); }
  }

  function addText() {
    setError("");
    try {
      const material = sourceMaterialSchema.parse({ id: crypto.randomUUID(), title: sourceTitle.trim() || "My notes / transcript", kind: "text", text: sourceText, images: [] });
      addMaterial(material); setSourceText(""); setSourceTitle("");
    } catch { setError("Enter a title and at least 20 characters of source text (up to 100,000). Use at most eight sources."); }
  }

  const fieldClass = "w-full rounded-lg border border-white/15 bg-black/15 px-3 py-2 text-xs text-inherit outline-none focus:border-blue-400";
  const buttonClass = "rounded-lg border border-white/15 px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-40";
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="rounded-xl border border-white/10 bg-white/[0.025] p-3 text-[#d3d7df]">
    <summary className="cursor-pointer select-none text-xs font-medium"><Paperclip size={13} className="mr-1 inline" />{label} {materials.length ? `(${materials.length})` : "& documents"}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-[11px] leading-4 text-[#969eac]">Your materials are prioritized and kept with this lesson on this device. Text and selected diagrams are sent to your configured teaching providers when you ask a question.</p>
      <label className="flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" checked={includeWebSearch} onChange={event => onIncludeWebSearchChange(event.target.checked)} disabled={busy} />Include Web Search</label>
      {!includeWebSearch && !materials.length && <p className="text-[11px] text-amber-300">Add a source before asking a question with web search off.</p>}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Source type">
        {([['file', 'Upload'], ['url', 'URL / YouTube'], ['text', 'Text / transcript']] as const).map(([value, label]) => <button key={value} type="button" className={`${buttonClass} ${mode === value ? "bg-white/10" : ""}`} onClick={() => setMode(value)} disabled={busy} aria-pressed={mode === value}>{label}</button>)}
      </div>
      {mode === "file" && <div className="space-y-2"><label htmlFor={inputId} className="block text-xs">PDF, DOCX, TXT, Markdown or data table</label><input id={inputId} type="file" accept=".pdf,.docx,.txt,.md,.csv,.tsv" multiple disabled={busy} className="w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-inherit" onChange={event => { void addFiles(event.target.files); event.target.value = ""; }} /><p className="text-[10px] text-[#969eac]">20 MB per file · first 40 PDF pages · 100,000 text characters per source · up to 8 diagrams total. Remove any diagram you do not want used.</p></div>}
      {mode === "url" && <div className="space-y-2"><input aria-label="Source URL" className={fieldClass} type="url" placeholder="https://…" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} disabled={busy} maxLength={2000} /><button type="button" className={buttonClass} onClick={() => void addUrl()} disabled={busy || !sourceUrl.trim()}><Link size={12} className="mr-1 inline" />Import URL</button><p className="text-[10px] text-[#969eac]">Public readable pages and available YouTube captions. Paste transcripts when a video blocks access.</p></div>}
      {mode === "text" && <div className="space-y-2"><input aria-label="Source title" className={fieldClass} placeholder="Source title (optional)" maxLength={180} value={sourceTitle} onChange={event => setSourceTitle(event.target.value)} disabled={busy} /><textarea aria-label="Source text or transcript" className={`${fieldClass} min-h-28 resize-y`} placeholder="Paste notes, a passage, a transcript, or a data table…" value={sourceText} onChange={event => setSourceText(event.target.value)} maxLength={SOURCE_LIMITS.textCharacters} disabled={busy} /><button type="button" className={buttonClass} onClick={addText} disabled={busy || sourceText.trim().length < 20}>Add text</button></div>}
      {progress && <p role="status" className="text-xs"><Loader2 className="mr-1 inline animate-spin" size={12} />{progress}</p>}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      {storageError && <p role="status" className="text-[11px] text-amber-300">{storageError}</p>}
      <ul className="space-y-2">{materials.map(material => <li key={material.id} className="rounded-lg border border-white/10 p-2">
        <div className="flex items-start gap-2"><FileText size={14} className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-xs" title={material.title}>{material.title}</span><span className="text-[10px] text-[#969eac]">{material.text.length.toLocaleString()} characters · {material.images.length} diagrams</span></span><button type="button" className="p-1 hover:text-red-300 disabled:opacity-40" aria-label={`Remove ${material.title}`} disabled={busy} onClick={() => onMaterialsChange(materials.filter(item => item.id !== material.id))}><Trash2 size={13} /></button></div>
        {material.text.length < 20 && <p className="mt-1 text-[10px] text-amber-300">Scanned pages: your vision provider inspects up to two retained pages per source (four total). Remove unwanted previews first. Add clearer pages or paste text if inspection cannot read them.</p>}
        {!!material.images.length && <div className="mt-2 grid grid-cols-3 gap-1.5">{material.images.map(image => <div key={image.id} className="relative rounded-md bg-white/5 p-1">
          {/* Uploaded raster previews are bounded data URLs; no remote optimizer needed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt={image.title} className="h-16 w-full rounded object-contain" /><span className="block truncate text-center text-[9px] text-[#969eac]">Page {image.page} · {image.kind === "page" ? "page" : "figure"}</span><button type="button" className="absolute right-0 top-0 rounded-full bg-black/80 p-0.5 disabled:opacity-40" aria-label={`Remove ${image.title}`} disabled={busy} onClick={() => onMaterialsChange(materials.map(item => item.id === material.id ? { ...item, images: item.images.filter(value => value.id !== image.id) } : item))}><X size={11} /></button>
        </div>)}</div>}
      </li>)}</ul>
    </div>
  </details>;
}
