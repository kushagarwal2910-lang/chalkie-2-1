"use client";
import Link from "next/link";
import { useState } from "react";
import { TeacherAvatar, AvatarChoices, useAvatarStyle } from "./teacher-avatar";
import { VoiceSettingsDialog } from "./voice-settings-dialog";

export function AvatarPreview() {
  const [style] = useAvatarStyle();
  const [open, setOpen] = useState(false);
  return <main className="mx-auto min-h-dvh max-w-3xl px-6 py-12 text-[#f3f3ee]">
    <Link href="/" className="text-sm text-[#a9adb6]">← Chalkie</Link>
    <p className="mt-10 text-xs uppercase tracking-widest text-[#a9c9b0]">Meet your teacher</p>
    <h1 className="mt-3 text-3xl font-medium tracking-tight">A familiar face. A clearer idea.</h1>
    <p className="mt-4 max-w-xl text-sm leading-6 text-[#a9adb6]">Choose a teacher, try a free natural voice on your device, and explore a sample lesson. The same character stays with you as you learn.</p>
    <div className="my-8 rounded-2xl border border-[#363a40] bg-[#202327] p-5"><AvatarChoices /><div className="mt-5 flex flex-wrap gap-3"><button onClick={() => setOpen(true)} className="studio-primary px-5">Preview voice & movement</button><Link href="/studio?demo=1" className="studio-secondary px-5">Try a sample lesson</Link></div></div>
    <div className="flex items-center gap-6"><TeacherAvatar style={style} className="max-w-36" /><p className="text-sm leading-6 text-[#a9adb6]">Your teacher blinks, makes occasional hand gestures, and moves their mouth during narration. Voice and speed are adjustable. Animation runs locally without model calls.</p></div>
    <VoiceSettingsDialog open={open} onOpenChange={setOpen} />
  </main>;
}
