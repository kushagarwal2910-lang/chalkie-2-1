import type { TeachingCue } from "./teaching-focus.ts";

export interface NarrationPhrase { text: string; start: number; cue?: TeachingCue }

function chunksAtPositions(text: string, positions: Map<number, TeachingCue>, maxChunks: number): NarrationPhrase[] {
  const starts = [0, ...[...positions.keys()].filter(index => index > 0).sort((a, b) => a - b)].slice(0, maxChunks);
  return starts.map((start, index) => ({ text: text.slice(start, starts[index + 1] ?? text.length), start, ...(positions.has(start) ? { cue: positions.get(start)! } : {}) }));
}

/** Use the matcher's verified spans, preserving case, punctuation, and repeated occurrences. */
export function splitNarrationAtCuePositions(text: string, matches: readonly { charIndex: number; matchedToken: string; cue?: TeachingCue }[]): NarrationPhrase[] {
  if (!text.length) return [];
  const positions = new Map<number, TeachingCue>();
  for (const match of matches) {
    if (!match.cue || !Number.isInteger(match.charIndex) || match.charIndex < 0 || !match.matchedToken.trim()
      || text.slice(match.charIndex, match.charIndex + match.matchedToken.length) !== match.matchedToken) continue;
    if (!positions.has(match.charIndex)) positions.set(match.charIndex, match.cue);
  }
  return chunksAtPositions(text, positions, 12);
}

/** Cut only at verified, literal cue phrases. Every original character is retained. */
export function splitNarrationAtCues(text: string, cues: readonly TeachingCue[] = [], options: { maxChunks?: number } = {}): NarrationPhrase[] {
  if (!text.length) return [];
  const maxChunks = Math.max(1, Math.min(12, Math.floor(options.maxChunks ?? 12) || 12));
  const positions = new Map<number, TeachingCue>();
  const previousOccurrences = new Map<string, number>();
  for (const cue of cues) {
    if (!cue.phrase.trim() || !cue.targetId) continue;
    const start = text.indexOf(cue.phrase, previousOccurrences.get(cue.phrase) ?? 0);
    if (start < 0) continue;
    previousOccurrences.set(cue.phrase, start + cue.phrase.length);
    if (!positions.has(start)) positions.set(start, cue);
  }
  return chunksAtPositions(text, positions, maxChunks);
}

export interface PhrasePlaybackOptions {
  chunks: readonly NarrationPhrase[];
  signal: AbortSignal;
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>;
  /** Actual audio starts, not synthesis completion or an estimated timer. */
  onStart?: () => void;
  onCue?: (cue: TeachingCue, chunk: NarrationPhrase) => void;
  onChunk?: (chunk: NarrationPhrase) => void;
  /** Attach the current element to the avatar analyser / parent playback ref. */
  onAudio?: (audio: HTMLAudioElement | null) => void;
  /** At most one synthesis runs at a time, including the Kokoro worker. */
  prefetch?: boolean;
  createAudio?: (url: string) => HTMLAudioElement;
}

function abortError() { return new DOMException("Speech cancelled", "AbortError"); }

/** Stop awaiting immediately even when a synthesis implementation is slow to honor abort. */
function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    if (signal.aborted) { promise.catch(() => undefined); reject(abortError()); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); if (signal.aborted) reject(abortError()); else resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

type SynthesisOutcome = { audio: Blob; error?: never } | { audio?: never; error: unknown };

/**
 * For engines without timestamps, each explicit cue is a real audio boundary.
 * The caller gates the canvas before invoking this function. No word timings
 * or intra-phrase movement are fabricated. The promise resolves after all audio.
 */
export async function playNarrationPhrases(options: PhrasePlaybackOptions): Promise<void> {
  options.signal.throwIfAborted();
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const chunks = options.chunks.filter(chunk => chunk.text.trim());
  let started = false;
  let pending: Promise<SynthesisOutcome> | null = null;
  let activeAudio: HTMLAudioElement | null = null;
  let activeUrl: string | null = null;
  const synthesize = (chunk: NarrationPhrase): Promise<SynthesisOutcome> => {
    signal.throwIfAborted();
    // A rejection is captured immediately, even if the preceding phrase is playing.
    return Promise.resolve().then(() => { signal.throwIfAborted(); return options.synthesize(chunk.text, signal); })
      .then(audio => ({ audio }), error => ({ error }));
  };
  const disposeAudio = () => {
    if (activeAudio) {
      activeAudio.onplaying = null; activeAudio.onended = null; activeAudio.onerror = null;
      activeAudio.pause(); activeAudio.removeAttribute("src"); activeAudio.load();
      activeAudio = null;
      if (!signal.aborted) options.onAudio?.(null);
    }
    if (activeUrl) { URL.revokeObjectURL(activeUrl); activeUrl = null; }
  };
  try {
    for (let index = 0; index < chunks.length; index++) {
      signal.throwIfAborted();
      const chunk = chunks[index];
      const outcome = await awaitWithAbort(pending ?? synthesize(chunk), signal);
      pending = null;
      if ("error" in outcome) throw outcome.error;
      if (!(outcome.audio instanceof Blob) || !outcome.audio.size) throw new Error("Speech synthesis returned empty audio.");
      signal.throwIfAborted();
      activeUrl = URL.createObjectURL(outcome.audio);
      const audio = (options.createAudio ?? (url => new Audio(url)))(activeUrl);
      activeAudio = audio;
      options.onAudio?.(audio);
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let announced = false;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          audio.onplaying = null; audio.onended = null; audio.onerror = null;
          if (error !== undefined) reject(error); else resolve();
        };
        const abort = () => { audio.pause(); finish(abortError()); };
        signal.addEventListener("abort", abort, { once: true });
        audio.onplaying = () => {
          if (settled || signal.aborted || announced) return;
          announced = true;
          try {
            if (!started) { started = true; options.onStart?.(); }
            if (signal.aborted) { abort(); return; }
            options.onChunk?.(chunk);
            if (signal.aborted) { abort(); return; }
            if (chunk.cue) options.onCue?.(chunk.cue, chunk);
            if (!signal.aborted && options.prefetch !== false && index + 1 < chunks.length) pending = synthesize(chunks[index + 1]);
          } catch (error) { finish(error); }
        };
        audio.onended = () => { if (!signal.aborted) finish(); else abort(); };
        audio.onerror = () => finish(new Error("Narration audio could not play. Press Play to retry this step."));
        if (signal.aborted) { abort(); return; }
        try { Promise.resolve(audio.play()).catch(error => finish(error)); }
        catch (error) { finish(error); }
      });
      disposeAudio();
    }
  } finally {
    try { disposeAudio(); }
    finally {
      // Stops any one-ahead generation if playback failed, paused, or was cancelled.
      controller.abort();
    }
  }
}

export interface DevicePhrasePlaybackOptions {
  chunks: readonly NarrationPhrase[];
  signal: AbortSignal;
  speech: SpeechSynthesis;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  onStart?: () => void;
  onCue?: (cue: TeachingCue, chunk: NarrationPhrase) => void;
  onChunk?: (chunk: NarrationPhrase) => void;
}

/** Device voices need no word-boundary support: utterance starts are exact phrase cues. */
export async function playDeviceNarrationPhrases(options: DevicePhrasePlaybackOptions): Promise<void> {
  const { signal, speech } = options;
  signal.throwIfAborted();
  let started = false;
  for (const chunk of options.chunks) {
    if (!chunk.text.trim()) continue;
    signal.throwIfAborted();
    const utterance = options.createUtterance(chunk.text);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let announced = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        utterance.onstart = utterance.onend = utterance.onerror = utterance.onboundary = null;
        if (error !== undefined) reject(error); else resolve();
      };
      const abort = () => { if (settled) return; finish(abortError()); speech.cancel(); };
      signal.addEventListener("abort", abort, { once: true });
      utterance.onstart = () => {
        if (settled || signal.aborted || announced) return;
        announced = true;
        try {
          if (!started) { started = true; options.onStart?.(); }
          if (signal.aborted) { abort(); return; }
          options.onChunk?.(chunk);
          if (signal.aborted) { abort(); return; }
          if (chunk.cue) options.onCue?.(chunk.cue, chunk);
        } catch (error) { finish(error); speech.cancel(); }
      };
      utterance.onboundary = () => {
        if (!settled && !signal.aborted && typeof window !== "undefined") window.dispatchEvent(new Event("chalkie:speech-boundary"));
      };
      utterance.onend = () => { if (signal.aborted) abort(); else finish(); };
      utterance.onerror = () => finish(new Error("Device narration could not play. Choose an installed voice in Teacher & voice."));
      if (signal.aborted) { abort(); return; }
      try { speech.speak(utterance); }
      catch (error) { finish(error); speech.cancel(); }
    });
  }
}
