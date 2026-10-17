"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  formatVoiceLabel,
  getBestAvailableVoice,
  getRankedVoices,
  AVATAR_VOICE_DEFAULTS,
  readAvatarVoicePreferences,
  voicePreferenceKey,
} from "@/lib/voice-selection";
import { formatNarrationForSpeech } from "@/lib/speech-formatter";
import { Check, Play, Square, Volume2, Sparkles, X } from "lucide-react";
import { AvatarChoices, avatarOptions, useAvatarStyle } from "@/components/teacher-avatar";
import { generateLocalSpeech, LOCAL_VOICES, readLocalVoice, readSpeechEngine, type SpeechEngine } from "@/lib/local-speech";
import { defaultLessonLanguage, getLanguageSample, getMatchingDeviceVoice, isEnglishLessonLanguage, LANGUAGE_OPTIONS, normalizeLessonLanguage, type LessonLanguageSettings } from "@/lib/lesson-language";
import { generateRemoteSpeech, readRemoteSpeechPreference, selectRemoteSpeechProvider, SARVAM_LANGUAGE_CODES, type RemoteSpeechPreference, type SpeechAvailability } from "@/lib/remote-speech";

interface VoiceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVoiceChange?: (voiceUri: string, rate: number) => void;
  languageSettings?: LessonLanguageSettings;
}

export function VoiceSettingsDialog({
  open,
  onOpenChange,
  onVoiceChange,
  languageSettings = defaultLessonLanguage,
}: VoiceSettingsDialogProps) {
  const language = normalizeLessonLanguage(languageSettings);
  const english = isEnglishLessonLanguage(language);
  const languageName = LANGUAGE_OPTIONS.find(option => option.code === language.language)!.label;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedUri, setSelectedUri] = useState<string>("");
  const [avatar] = useAvatarStyle();
  const teacherName = avatarOptions.find(option => option.id === avatar)!.name;
  const [speechRate, setSpeechRate] = useState(0.92);
  const [speechPitch, setSpeechPitch] = useState(1);
  const [manualUri, setManualUri] = useState<string | null>(null);
  const [sampleActive, setSampleActive] = useState(false);
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const sampleRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>("device");
  const [remotePreference, setRemotePreference] = useState<RemoteSpeechPreference>("auto");
  const [availability, setAvailability] = useState<SpeechAvailability | null>(null);
  const [localVoice, setLocalVoice] = useState("af_heart");
  const [sampleStatus, setSampleStatus] = useState("");
  const localSampleRef = useRef<{ controller: AbortController; audio?: HTMLAudioElement; url?: string } | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis?.getVoices() ?? [];
      const matching = available.filter(voice => voice.lang.toLowerCase().replaceAll("_", "-").split("-")[0] === language.language.split("-")[0]);
      {
        const ranked = getRankedVoices(matching);
        setVoices(ranked);

        const preferences = readAvatarVoicePreferences(avatar, window.localStorage);
        const best = getBestAvailableVoice(ranked, preferences.uri, avatar);
        setSelectedUri(best?.voiceURI || best?.name || "");
      }
    };

    const initialLoad = window.setTimeout(() => {
      loadVoices();
      const preferences = readAvatarVoicePreferences(avatar, window.localStorage);
      setSpeechRate(preferences.rate);
      setSpeechPitch(preferences.pitch);
      setManualUri(preferences.uri);
      const preferredEngine = readSpeechEngine();
      setEngine(english ? preferredEngine : "remote");
      setRemotePreference(readRemoteSpeechPreference());
      setLocalVoice(readLocalVoice(avatar));
      setSampleStatus("");
      setIsPlayingSample(false);
      setSampleActive(false);
    }, 0);
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    const controller = new AbortController();
    fetch("/api/speech", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then(result => {
      if (!controller.signal.aborted && result?.providers?.sarvam && result?.providers?.elevenlabs) setAvailability(result);
    }).catch(() => { /* Device voices remain available without the optional provider. */ });
    return () => {
      controller.abort();
      window.clearTimeout(initialLoad);
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
      if (sampleRef.current) { sampleRef.current = null; window.speechSynthesis.cancel(); }
      const sample = localSampleRef.current;
      localSampleRef.current = null;
      sample?.controller.abort(); sample?.audio?.pause();
      if (sample?.url) URL.revokeObjectURL(sample.url);
    };
  }, [avatar, open, english, language.language]);

  const stopSample = () => {
    const sample = localSampleRef.current;
    localSampleRef.current = null;
    sample?.controller.abort(); sample?.audio?.pause();
    if (sample?.url) URL.revokeObjectURL(sample.url);
    sampleRef.current = null;
    window.speechSynthesis?.cancel();
    setIsPlayingSample(false);
    setSampleActive(false);
    setSampleStatus("");
  };

  const savePreferences = (uri: string | null, rate: number, pitch: number) => {
    stopSample();
    setManualUri(uri); setSpeechRate(rate); setSpeechPitch(pitch);
    const best = getBestAvailableVoice(voices, uri, avatar);
    setSelectedUri(best?.voiceURI || best?.name || "");
    try { window.localStorage.setItem(voicePreferenceKey(avatar), JSON.stringify({ uri, rate, pitch })); } catch { /* Storage is optional. */ }
    onVoiceChange?.(best?.voiceURI || best?.name || "", rate);
  };

  const handleSelectVoice = (uri: string) => {
    savePreferences(uri, speechRate, speechPitch);
  };

  const handleSelectRate = (rate: number) => {
    savePreferences(manualUri, rate, speechPitch);
  };

  const playSample = async () => {
    if (sampleActive) {
      stopSample();
      return;
    }

    window.speechSynthesis?.cancel();
    const sampleText = english ? formatNarrationForSpeech(`Hi, I'm ${teacherName}. Let's take this one step at a time. Follow the board as we explore how it works together.`) : getLanguageSample(language);

    if (engine === "local" || engine === "remote") {
      const sample: NonNullable<typeof localSampleRef.current> = { controller: new AbortController() };
      localSampleRef.current = sample;
      setSampleActive(true); setSampleStatus(engine === "local" ? "Preparing your local voice…" : "Preparing your natural voice…");
      try {
        const isIndian = language.language in SARVAM_LANGUAGE_CODES || language.language.endsWith("-IN") || language.language.startsWith("en");
        const effectivePref = isIndian ? "sarvam" : remotePreference;
        const recording = engine === "remote"
          ? (await generateRemoteSpeech(sampleText, language, speechRate, sample.controller.signal, effectivePref, avatar)).audio
          : await generateLocalSpeech(sampleText, localVoice, speechRate, sample.controller.signal, message => { if (localSampleRef.current === sample) setSampleStatus(message); });
        if (localSampleRef.current !== sample) return;
        sample.url = URL.createObjectURL(recording);
        sample.audio = new Audio(sample.url);
        sample.audio.onplaying = () => { if (localSampleRef.current === sample) { setIsPlayingSample(true); setSampleStatus(engine === "remote" ? "Playing natural voice · provider audio" : "Playing locally · no speech API"); } };
        sample.audio.onended = () => { if (localSampleRef.current === sample) stopSample(); };
        sample.audio.onerror = () => { if (localSampleRef.current === sample) { stopSample(); setSampleStatus("Audio could not play. Try Preview again."); } };
        await sample.audio.play();
      } catch (error) {
        if (localSampleRef.current !== sample) return;
        stopSample(); setSampleStatus(error instanceof Error ? error.message : "Local speech failed. Try Device voice.");
      }
      return;
    }
    if (!("speechSynthesis" in window)) return;

    const utterance = new SpeechSynthesisUtterance(sampleText);
    const matchedVoice = getMatchingDeviceVoice(voices, language, selectedUri);
    if (!matchedVoice) { setSampleStatus(`No ${languageName} voice is available. Add one in your operating system, restart the browser, or use captions.`); return; }
    utterance.voice = matchedVoice;
    utterance.rate = speechRate;
    utterance.pitch = speechPitch;
    utterance.lang = matchedVoice?.lang || "en-US";

    sampleRef.current = utterance;
    utterance.onstart = () => { if (sampleRef.current === utterance) setIsPlayingSample(true); };
    const finish = () => { if (sampleRef.current === utterance) { sampleRef.current = null; setIsPlayingSample(false); setSampleActive(false); } };
    utterance.onend = finish;
    utterance.onerror = finish;
    utterance.onboundary = () => { if (sampleRef.current === utterance) window.dispatchEvent(new Event("chalkie:speech-boundary")); };

    setSampleActive(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(val) => {
      if (!val) {
        stopSample();
      }
      onOpenChange(val);
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[2147483646] bg-[#090b0d]/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={() => { if (document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement; }}
          onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }}
          className="fixed left-1/2 top-1/2 z-[2147483647] flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[500px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-[#363a40] bg-[#202327] text-[#f3f3ee] shadow-[0_28px_100px_#0008] outline-none"
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-[#363a40] px-4 py-4 sm:px-6 sm:py-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#514a65] bg-[#302c3b] text-[#c4b5fd]"><Volume2 size={19} /></span>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.16em] text-[#a9adb6]">Make it yours</p>
              <DialogPrimitive.Title className="text-base font-semibold tracking-[-.025em] sm:text-lg">Teacher & voice</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-xs leading-5 text-[#a9adb6]">Find a voice and a rhythm that help you learn.</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#a9adb6] outline-none transition hover:bg-[#30343a] hover:text-[#f3f3ee] focus-visible:ring-2 focus-visible:ring-[#c4b5fd]" aria-label="Close voice settings"><X size={18} /></DialogPrimitive.Close>
          </header>

          <div className="min-h-0 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 [scrollbar-width:thin] [scrollbar-color:#50555d_transparent]">
            <AvatarChoices speaking={isPlayingSample} />
            <fieldset>
              <legend className="mb-3 text-sm font-semibold">Voice engine</legend>
              <div className="grid grid-cols-3 gap-2">
                {([{ id: "local", name: "Local natural", detail: "Free · English" }, { id: "device", name: "Device voice", detail: "Free · no account" }, { id: "remote", name: "API natural", detail: "Optional · provider key" }] as const).map(option => <button key={option.id} type="button" disabled={option.id === "local" && !english || option.id === "remote" && (!availability || !selectRemoteSpeechProvider(language, availability))} aria-pressed={engine === option.id} onClick={() => { stopSample(); setEngine(option.id); try { localStorage.setItem("chalkie:speech-engine", option.id); } catch { /* optional storage */ } }} className={`rounded-xl border p-3 text-left text-xs focus-visible:ring-2 focus-visible:ring-[#c4b5fd] disabled:opacity-40 ${engine === option.id ? "border-[#c4b5fd] bg-[#302c3b]" : "border-[#363a40] bg-[#17191c]"}`}><span className="block font-semibold">{option.name}</span><span className="mt-1 block text-[#a9adb6]">{option.detail}</span></button>)}
              </div>
              {engine === "local" && <p className="mt-3 text-xs leading-5 text-[#a9adb6]">Kokoro runs on this device. First preview downloads about 120 MB, then your browser caches it. Speech takes device processing; slower devices may prefer Device voice. English voices; no speech is sent to an API.</p>}
              {engine === "device" && <p className="mt-3 text-xs leading-5 text-[#a9adb6]">Showing {languageName} voices only. Device voices need no provider account; some operating system voices use a network connection. {!voices.length && `Add a ${languageName} voice in your operating system and restart the browser, or continue with captions.`}</p>}
              {engine === "remote" && <label className="mt-3 block text-xs leading-5 text-[#a9adb6]">Natural voice provider
                <select aria-label="Natural voice provider" value={remotePreference} onChange={event => { stopSample(); const choice = event.target.value as RemoteSpeechPreference; setRemotePreference(choice); try { localStorage.setItem("chalkie:remote-speech-provider", choice); } catch { /* optional storage */ } }} className="mt-2 w-full rounded-lg border border-[#363a40] bg-[#17191c] p-2 text-[#f3f3ee]">
                  <option value="auto">Automatic for {languageName}</option>
                  <option value="sarvam" disabled={!availability || !selectRemoteSpeechProvider(language, availability, "sarvam")}>Sarvam · Bulbul v3</option>
                  <option value="elevenlabs" disabled={!availability || !selectRemoteSpeechProvider(language, availability, "elevenlabs")}>ElevenLabs · Flash v2.5</option>
                </select>
                Narration is sent to the configured provider. Provider usage may cost money. Keys stay on the server.
              </label>}
              {availability && !selectRemoteSpeechProvider(language, availability) && <p className="mt-3 text-xs leading-5 text-[#a9adb6]">No API voice is configured for {languageName}. Device voices and captions work without a provider account.</p>}
            </fieldset>
            <p className="text-xs leading-5 text-[#a9adb6]">Voice and pace are saved separately for {teacherName}. {avatar === "mira" ? "Mira automatically prefers a feminine voice." : avatar === "arjun" ? "Arjun automatically prefers a masculine voice." : "Chalk uses a bright, clear voice."}</p>
            <fieldset>
              <legend className="mb-3 text-sm font-semibold">Speaking pace</legend>
              <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
                {[
                  { label: "Deliberate", rate: 0.86 },
                  { label: "Teacher", rate: 0.92, popular: true },
                  { label: "Normal", rate: 1.0 },
                  { label: "Brisk", rate: 1.08 },
                ].map((item) => {
                  const isSelected = Math.abs(speechRate - item.rate) < 0.02;
                  return <button key={item.rate} type="button" aria-pressed={isSelected} onClick={() => handleSelectRate(item.rate)} className={`flex min-h-[66px] flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-[#e3daff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#202327] ${isSelected ? "border-[#c4b5fd] bg-[#c4b5fd] text-[#211d2c]" : "border-[#3c4148] bg-[#17191c] text-[#d2d4d9] hover:border-[#66606f] hover:bg-[#282c31]"}`}>
                    <span className="text-xs font-semibold">{item.label}</span><span className={`text-[11px] ${isSelected ? "text-[#494057]" : "text-[#a9adb6]"}`}>{item.rate}×</span>
                  </button>;
                })}
              </div>
            </fieldset>

            {engine === "device" && <label className="block text-sm font-semibold">Voice pitch <span className="float-right text-xs font-normal text-[#a9adb6]">{speechPitch.toFixed(2)}×</span>
              <input aria-label="Voice pitch" type="range" min="0.85" max="1.2" step="0.01" value={speechPitch} onChange={event => savePreferences(manualUri, speechRate, Number(event.target.value))} className="mt-3 w-full accent-[#c4b5fd]" />
              <span className="flex justify-between text-[11px] font-normal text-[#a9adb6]"><span>Lower</span><span>Brighter</span></span>
            </label>}

            {engine === "local" ? <label className="block text-sm font-semibold">Natural narrator
              <select aria-label="Natural narrator" value={localVoice} onChange={event => { stopSample(); setLocalVoice(event.target.value); try { localStorage.setItem(`chalkie:local-voice:${avatar}`, event.target.value); } catch { /* optional storage */ } }} className="mt-3 w-full rounded-xl border border-[#363a40] bg-[#17191c] p-3 text-xs text-[#f3f3ee]">
                {LOCAL_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.label}{voice.avatar === avatar ? " · recommended" : ""}</option>)}
              </select>
            </label> : engine === "device" ? <section aria-labelledby="voice-choice-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 id="voice-choice-heading" className="text-sm font-semibold">Narrator voice</h3><span className="inline-flex items-center gap-1.5 text-[10px] text-[#a9c9b0]"><Sparkles size={12} />Natural voices first</span></div>
              <button type="button" onClick={() => { const defaults = AVATAR_VOICE_DEFAULTS[avatar]; savePreferences(null, defaults.rate, defaults.pitch); }} className="mb-3 text-xs text-[#c4b5fd] underline underline-offset-4">Reset to {teacherName}&apos;s recommended voice</button>
              {!!voices.length && !voices.some(voice => /natural|neural|online/i.test(voice.name)) && <p className="mb-3 text-xs leading-5 text-[#a9adb6]">This browser offers classic device voices. Natural voices will appear here if your browser makes them available.</p>}
              <div className="max-h-[min(36dvh,300px)] min-h-[72px] space-y-2 overflow-y-auto overscroll-contain rounded-xl pr-1 [scrollbar-width:thin] [scrollbar-color:#50555d_transparent]">
                {!voices.length && <div className="rounded-xl border border-dashed border-[#444950] bg-[#17191c] px-4 py-5 text-center text-xs leading-5 text-[#a9adb6]">No {languageName} voice is available on this device.</div>}
                {voices.map((voice) => {
                  const isSelected = selectedUri === voice.voiceURI || selectedUri === voice.name;
                  const isNatural = /natural|neural|online/i.test(voice.name);
                  const displayLabel = formatVoiceLabel(voice);
                  return <button key={voice.voiceURI || voice.name} type="button" aria-pressed={isSelected} onClick={() => handleSelectVoice(voice.voiceURI || voice.name)} className={`flex min-h-[64px] w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#c4b5fd] ${isSelected ? "border-[#655b80] bg-[#302c3b] text-[#f0eaff]" : "border-[#363a40] bg-[#17191c] text-[#d2d4d9] hover:border-[#555b65] hover:bg-[#282c31]"}`}>
                    <div className="min-w-0 flex-1"><p className="break-words text-xs font-medium leading-5">{displayLabel}</p><div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-[10px] text-[#a9adb6]">{voice.lang}</span>{isNatural && <span className="rounded-md bg-[#2d3c32] px-1.5 py-0.5 text-[9px] font-medium text-[#b9d7c1]">Natural</span>}</div></div>
                    {isSelected ? <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#c4b5fd] text-[#211d2c]"><Check size={12} strokeWidth={2.8} /></span> : <span className="h-5 w-5 shrink-0 rounded-full border border-[#454b54]" aria-hidden="true" />}
                  </button>;
                })}
              </div>
            </section> : null}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#363a40] bg-[#282c31] px-4 py-4 sm:px-6">
            <div className="min-w-0"><p className="text-xs font-medium">Hear {teacherName}</p><p role="status" className="mt-1 text-[11px] leading-4 text-[#a9adb6]">{sampleStatus || (sampleActive ? "Playing your voice sample…" : "A little clarity before you begin.")}</p></div>
            <button type="button" disabled={engine === "device" && !voices.length} onClick={playSample} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold outline-none transition disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#eee8ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#282c31] ${sampleActive ? "bg-[#dfb3b8] text-[#302125] hover:bg-[#ebc3c7]" : "bg-[#c4b5fd] text-[#211d2c] hover:bg-[#d3c8ff]"}`}>
              {sampleActive ? <><Square size={13} fill="currentColor" />Stop</> : <><Play size={13} fill="currentColor" />Preview</>}
            </button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
