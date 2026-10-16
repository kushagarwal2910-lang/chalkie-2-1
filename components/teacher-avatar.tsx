"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export const avatarOptions = [
  { id: "mira", name: "Mira", description: "Warm, illustrated teacher" },
  { id: "arjun", name: "Arjun", description: "Relaxed, expressive tutor" },
  { id: "chalk", name: "Chalk", description: "A little classroom robot" },
] as const;
export type AvatarStyle = typeof avatarOptions[number]["id"];
const preferenceKey = "chalkie:avatar";
const subscribe = (callback: () => void) => { window.addEventListener("chalkie:avatar-change", callback); window.addEventListener("storage", callback); return () => { window.removeEventListener("chalkie:avatar-change", callback); window.removeEventListener("storage", callback); }; };
function snapshot(): AvatarStyle {
  try { const value = localStorage.getItem(preferenceKey); return avatarOptions.find(o => o.id === value)?.id ?? "mira"; } catch { return "mira"; }
}
export function useAvatarStyle() {
  const style = useSyncExternalStore(subscribe, snapshot, () => "mira" as AvatarStyle);
  return [style, (value: AvatarStyle) => { try { localStorage.setItem(preferenceKey, value); } catch { /* optional */ } window.dispatchEvent(new Event("chalkie:avatar-change")); }] as const;
}

export function TeacherAvatar({ style = "mira", speaking = false, listening = false, pointing = false, className = "" }: { style?: AvatarStyle; speaking?: boolean; listening?: boolean; pointing?: boolean; className?: string }) {
  const [blink, setBlink] = useState(false);
  const [gesture, setGesture] = useState(0);
  const [mouth, setMouth] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let blinkTimer: ReturnType<typeof setTimeout>, openTimer: ReturnType<typeof setTimeout>, gestureTimer: ReturnType<typeof setTimeout>;
    const blinkAgain = () => { blinkTimer = setTimeout(() => { if (!document.hidden && !reduced.matches) { setBlink(true); openTimer = setTimeout(() => setBlink(false), 145); } blinkAgain(); }, 2500 + Math.random() * 4200); };
    const gestureAgain = () => { gestureTimer = setTimeout(() => { if (!document.hidden && !reduced.matches) setGesture(speaking ? 1 + Math.floor(Math.random() * 3) : 0); gestureAgain(); }, 1400 + Math.random() * 2200); };
    blinkAgain(); gestureAgain();
    return () => { clearTimeout(blinkTimer); clearTimeout(openTimer); clearTimeout(gestureTimer); };
  }, [speaking]);
  useEffect(() => {
    if (!speaking) return;
    const timer = setInterval(() => { if (!document.hidden) setMouth(1 + Math.floor(Math.random() * 3)); }, 155);
    const boundary = () => setMouth(1 + Math.floor(Math.random() * 3));
    window.addEventListener("chalkie:speech-boundary", boundary);
    return () => { clearInterval(timer); window.removeEventListener("chalkie:speech-boundary", boundary); };
  }, [speaking]);
  const robot = style === "chalk", male = style === "arjun";
  const skin = robot ? "#d8d4ed" : male ? "#bf855f" : "#edb791";
  const coat = robot ? "#9bc6b0" : male ? "#92afa8" : "#b7a8dc";
  const pose = speaking ? gesture : 0;
  return <svg viewBox="0 0 220 210" role="img" aria-label={`${avatarOptions.find(o => o.id === style)?.name}, ${speaking ? "speaking" : listening ? "listening" : "ready to teach"}`} className={`teacher-avatar ${speaking ? "is-talking" : ""} ${className}`}>
    <ellipse cx="110" cy="199" rx="72" ry="7" fill="#ffffff09" />
    <g className="avatar-body">
      {!robot && !male && <path d="M68 65Q66 22 110 20Q156 20 153 70L160 130Q137 150 60 120Z" fill="#473837" />}
      <path d="M73 122Q110 108 147 122L162 196H58Z" fill={coat} />
      <path d="M92 119L110 138L128 119" fill="none" stroke="#ffffff60" strokeWidth="3" />
      <path d="M97 97V120Q110 132 123 120V97" fill={skin} />
      <g className="avatar-arm" style={{ transform: `rotate(${pointing && speaking ? 48 : pose === 1 ? 38 : pose === 3 ? 20 : 0}deg)`, transformOrigin: "73px 127px" }}>
        <path d="M74 130Q58 142 52 169" stroke={coat} strokeWidth="22" strokeLinecap="round" fill="none" />
        <path d="M52 163L44 174M52 166L50 180M57 167L56 179M48 168L39 169" stroke={skin} strokeWidth="6" strokeLinecap="round" />
      </g>
      <g className="avatar-arm" style={{ transform: `rotate(${pose === 2 ? -42 : pose === 3 ? -25 : 0}deg)`, transformOrigin: "147px 127px" }}>
        <path d="M146 130Q162 142 168 169" stroke={coat} strokeWidth="22" strokeLinecap="round" fill="none" />
        <path d="M168 163L176 174M168 166L170 180M163 167L164 179M172 168L181 169" stroke={skin} strokeWidth="6" strokeLinecap="round" />
      </g>
      <g className="avatar-head" style={{ transform: `rotate(${listening ? -7 : pose === 2 ? 3 : -2}deg)`, transformOrigin: "110px 110px" }}>
        {robot && <><path d="M110 27V15" stroke={coat} strokeWidth="4" /><circle cx="110" cy="12" r="5" fill="#e7ce91" /><rect x="62" y="55" width="14" height="29" rx="6" fill={coat} /><rect x="145" y="55" width="14" height="29" rx="6" fill={coat} /></>}
        {!robot && <><ellipse cx="73" cy="75" rx="7" ry="11" fill={skin} /><ellipse cx="147" cy="75" rx="7" ry="11" fill={skin} /></>}
        <rect x="74" y="29" width="72" height="85" rx={robot ? 23 : 33} fill={skin} />
        {robot && <rect x="81" y="45" width="58" height="46" rx="13" fill="#30343a" />}
        {!robot && (male ? <path d="M73 60Q63 29 87 26Q87 14 105 24Q130 10 145 31L147 59Q132 48 126 39Q106 57 80 48Z" fill="#302c2c" /> : <path d="M72 64Q65 26 105 24Q151 17 149 66Q130 54 126 37Q107 58 75 54Z" fill="#473837" />)}
        {!robot && <g fill="none" stroke="#63463e" strokeWidth="2" strokeLinecap="round"><path d="M84 61Q90 58 97 61M123 61Q130 58 136 62" /></g>}
        <g stroke={robot ? "#c4b5fd" : "#372d31"} strokeWidth={robot ? 4 : 3} strokeLinecap="round" fill="none">
          {blink ? <path d="M85 73H96M124 73H135" /> : <><path d="M91 69V75M129 69V75" />{!robot && <><circle cx="92" cy="69" r=".8" fill="#fff" stroke="none" /><circle cx="130" cy="69" r=".8" fill="#fff" stroke="none" /></>}</>}
        </g>
        {!robot && <><path d="M109 74L106 85H113" stroke="#ac755f" strokeWidth="1.5" fill="none" strokeLinecap="round" /><ellipse cx="85" cy="85" rx="6" ry="3" fill="#d8837c" opacity=".4" /><ellipse cx="136" cy="85" rx="6" ry="3" fill="#d8837c" opacity=".4" /></>}
        {speaking ? <g><ellipse cx="110" cy={robot ? 101 : 96} rx={mouth === 2 ? 4 : 8} ry={mouth === 1 ? 3 : 6} fill="#52393f" /><path d={robot ? "M105 98H115" : "M105 93H115"} stroke="#fff4e9" strokeWidth="2" /></g> : <path d={robot ? "M102 100Q110 107 118 100" : "M102 94Q110 101 118 94"} stroke="#67414a" strokeWidth="2" fill="none" strokeLinecap="round" />}
        {male && <g stroke="#574442" fill="none" strokeWidth="2"><rect x="81" y="65" width="21" height="15" rx="5" /><rect x="118" y="65" width="21" height="15" rx="5" /><path d="M102 70H118" /></g>}
      </g>
      <rect x="124" y="146" width="18" height="24" rx="3" fill="#ffffff28" /><path d="M128 150H138M128 156H135" stroke="#fff9" strokeWidth="2" />
    </g>
  </svg>;
}

export function AvatarChoices({ speaking = false }: { speaking?: boolean }) {
  const [selected, select] = useAvatarStyle();
  return <fieldset><legend className="mb-3 text-sm font-semibold">Your teacher</legend><div className="avatar-options">
    {avatarOptions.map(option => <button key={option.id} type="button" aria-pressed={selected === option.id} onClick={() => select(option.id)} className="avatar-option"><TeacherAvatar style={option.id} speaking={speaking && selected === option.id} /><strong>{option.name}</strong><span>{option.description}</span></button>)}
  </div><p className="mt-3 text-xs leading-5 text-[#a9adb6]">All three blink, speak, and gesture. Choose a style and a free voice, then press Preview.</p></fieldset>;
}
