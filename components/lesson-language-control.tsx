"use client";

import { useEffect, useId, useState } from "react";
import { getMatchingDeviceVoice, isEnglishLessonLanguage, LANGUAGE_OPTIONS, normalizeLessonLanguage, saveLessonLanguage, type LessonLanguageSettings } from "@/lib/lesson-language";
import { selectRemoteSpeechProvider, type SpeechAvailability } from "@/lib/remote-speech";

interface LessonLanguageControlProps {
  value: LessonLanguageSettings;
  onChange: (settings: LessonLanguageSettings) => void;
  disabled?: boolean;
}

export function LessonLanguageControl({ value, onChange, disabled }: LessonLanguageControlProps) {
  const id = useId();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [availability, setAvailability] = useState<SpeechAvailability | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    const timer = window.setTimeout(load, 0);
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    const controller = new AbortController();
    fetch("/api/speech", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => {
      if (!controller.signal.aborted) { if (result?.providers?.sarvam && result?.providers?.elevenlabs) setAvailability(result); setChecked(true); }
    }).catch(() => { if (!controller.signal.aborted) setChecked(true); });
    return () => { clearTimeout(timer); controller.abort(); window.speechSynthesis?.removeEventListener("voiceschanged", load); };
  }, []);
  const normalized = normalizeLessonLanguage(value);
  const selected = LANGUAGE_OPTIONS.find(option => option.code === normalized.language)!;
  const deviceVoice = getMatchingDeviceVoice(voices, normalized);
  const remote = availability && selectRemoteSpeechProvider(normalized, availability);
  const english = isEnglishLessonLanguage(normalized);
  const update = (next: LessonLanguageSettings) => { const settings = normalizeLessonLanguage(next); saveLessonLanguage(settings); onChange(settings); };
  const mixedLabel = "mixedName" in selected ? selected.mixedName : `${selected.label} + English`;
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-[#363a40] bg-[#17191c] p-3 text-[#f3f3ee] disabled:opacity-60">
    <legend className="px-1 text-xs font-semibold">Lesson language</legend>
    <label htmlFor={`${id}-language`} className="block text-xs text-[#a9adb6]">Teaching language</label>
    <select id={`${id}-language`} value={normalized.language} onChange={event => update({ ...normalized, language: event.target.value })} className="w-full rounded-lg border border-[#454b54] bg-[#202327] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd]">
      {LANGUAGE_OPTIONS.map(option => <option key={option.code} value={option.code}>{option.label}{option.nativeName !== option.label ? ` · ${option.nativeName}` : ""}</option>)}
    </select>
    {!english && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className={`flex gap-2 rounded-lg border p-2.5 text-xs ${normalized.mode === "native" ? "border-[#c4b5fd] bg-[#302c3b]" : "border-[#363a40]"}`}>
        <input className="mt-0.5 accent-[#c4b5fd]" type="radio" name={`${id}-mode`} value="native" checked={normalized.mode === "native"} onChange={() => update({ ...normalized, mode: "native" })} />
        <span><span className="block font-semibold">Native mode</span><span className="mt-1 block leading-5 text-[#a9adb6]">Cards and narration in {selected.label}.</span></span>
      </label>
      <label className={`flex gap-2 rounded-lg border p-2.5 text-xs ${normalized.mode === "code-switch" ? "border-[#c4b5fd] bg-[#302c3b]" : "border-[#363a40]"}`}>
        <input className="mt-0.5 accent-[#c4b5fd]" type="radio" name={`${id}-mode`} value="code-switch" checked={normalized.mode === "code-switch"} onChange={() => update({ ...normalized, mode: "code-switch" })} />
        <span><span className="block font-semibold">Classroom · {mixedLabel}</span><span className="mt-1 block leading-5 text-[#a9adb6]">English cards; conversational {selected.label} narration with English terms.</span></span>
      </label>
    </div>}
    <p role="status" className="text-[11px] leading-5 text-[#a9adb6]">{english
      ? "English works with free local Kokoro or a device voice. No provider account needed."
      : deviceVoice ? `${selected.label} device voice available · no account needed. Preview it in Teacher & voice.`
        : remote ? `Optional ${remote === "sarvam" ? "Sarvam" : "ElevenLabs"} natural voice is configured. Select it in Teacher & voice; provider usage may cost money.`
          : checked ? `No ${selected.label} device voice is available yet. Add a ${selected.label} voice in your operating system and restart the browser, or use captions. No provider account is required.`
            : "Checking voices available on this device…"}</p>
  </fieldset>;
}
