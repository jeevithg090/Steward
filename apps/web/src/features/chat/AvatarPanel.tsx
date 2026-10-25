import { useEffect, useId, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { AudioLines, Briefcase, Calculator, ChevronDown, FileCheck, Loader2, MessageSquareText, Sparkles, User, Volume1, Volume2, VolumeX } from "lucide-react";
import { FOCUS } from "@/components/ui";
import { useElementWidth } from "@/hooks/useElementWidth";
import { useSpeech, type VisemeShape } from "@/hooks/useSpeech";
import type { Persona } from "@/lib/api";

export type OutputMode = "avatar" | "voice" | "text";
/** The voices in the chat: Tempo itself, and the three roles it plays. */
export type AgentProfile = Exclude<Persona, "contractor">;

export interface SpeechRequest {
  id: string;
  text: string;
}

export interface ProfileOption {
  id: AgentProfile;
  name: string;
  role: string;
  badgeBg: string;
  badgeText: string;
  icon: ReactNode;
}

export const AGENT_PROFILES: ProfileOption[] = [
  {
    id: "tempo",
    name: "Tempo",
    role: "The agent itself",
    badgeBg: "bg-accent-500/20",
    badgeText: "text-accent-200",
    icon: <Sparkles size={14} className="text-accent-300" aria-hidden />,
  },
  {
    id: "negotiator",
    name: "Negotiator",
    role: "Talks to the company",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-200",
    icon: <Briefcase size={14} className="text-emerald-300" aria-hidden />,
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Rules and time value",
    badgeBg: "bg-amber-500/20",
    badgeText: "text-amber-200",
    icon: <Calculator size={14} className="text-amber-300" aria-hidden />,
  },
  {
    id: "auditor",
    name: "Auditor",
    role: "Proof and verifier",
    badgeBg: "bg-second-500/20",
    badgeText: "text-second-200",
    icon: <FileCheck size={14} className="text-second-300" aria-hidden />,
  },
];

const MODES: OutputMode[] = ["avatar", "voice", "text"];
const LABELS: Record<OutputMode, string> = { avatar: "Avatar", voice: "Voice", text: "Text" };
const MODE_ICONS: Record<OutputMode, ReactNode> = {
  avatar: <User size={15} aria-hidden />,
  voice: <AudioLines size={15} aria-hidden />,
  text: <MessageSquareText size={15} aria-hidden />,
};

const SHOW_CONTROLS_FROM = 60;
const SHOW_SLIDER_FROM = 160;
const SHOW_FULL_BADGE_FROM = 300;
const AUTO_HIDE_MS = 3000;

let lastSpokenId: string | null = null;

interface AvatarPanelProps {
  className?: string;
  onModeChange?: (mode: OutputMode) => void;
  selectedProfile?: AgentProfile;
  onProfileChange?: (profile: AgentProfile) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  speech?: SpeechRequest | null;
  /** Changes when the person starts speaking: Tempo stops talking (without being muted). */
  hush?: number;
  /** A key pasted in Settings (second path, for the desktop app). */
  elevenLabsKey?: string;
  /** The Gateway's voice (`gateway.tts`), tried first when the Gateway reports it is configured. */
  tts?: (text: string, persona: Persona) => Promise<ArrayBuffer>;
  ttsAvailable?: boolean;
  /** BCP 47 tag for the browser's voice. */
  lang?: string;
  /** Phones (below `lg`): one strip at most 72px tall, so the conversation gets the screen. */
  compact?: boolean;
  /** Shown at the end of the compact strip (the chat's stream badge). */
  extra?: ReactNode;
}

/** Each voice's orb: the sphere's colours and its glow. */
const ORBS: Record<AgentProfile, { sphere: string; glow: string; ring: string }> = {
  tempo: { sphere: "conic-gradient(from 210deg, rgb(var(--accent-300)), rgb(var(--accent-600)), rgb(var(--accent-900)), #f5b544, rgb(var(--accent-300)))", glow: "bg-accent-500", ring: "border-accent-300/50" },
  negotiator: { sphere: "conic-gradient(from 210deg, #a7f3d0, #059669, #064e3b, #fcd581, #a7f3d0)", glow: "bg-emerald-500", ring: "border-emerald-300/50" },
  analyst: { sphere: "conic-gradient(from 210deg, #fde68a, #d97706, #78350f, rgb(var(--accent-300)), #fde68a)", glow: "bg-amber-500", ring: "border-amber-300/50" },
  auditor: { sphere: "conic-gradient(from 210deg, rgb(var(--second-200)), rgb(var(--second-600)), rgb(var(--second-900)), #fcd581, rgb(var(--second-200)))", glow: "bg-second-500", ring: "border-second-300/50" },
};

/** The voice bars inside the orb, one pattern per mouth shape (the lip-sync's visemes). */
const BARS: Record<VisemeShape, number[]> = {
  A: [0.25, 0.4, 0.5, 0.4, 0.25],
  B: [0.4, 0.65, 0.85, 0.65, 0.4],
  C: [0.55, 0.85, 1, 0.85, 0.55],
  D: [0.45, 0.75, 0.95, 0.75, 0.45],
  E: [0.7, 1, 0.75, 1, 0.7],
  F: [0.35, 0.7, 0.55, 0.7, 0.35],
};

/** Tempo's face (plan.md §15.2 P1): a breathing orb. It turns slowly, swells with the voice's
 * level (`--level`, set on `levelRef` by useSpeech), ripples while speaking, and its bars follow
 * the mouth shapes. Clicking it reads the last reply aloud or stops. */
function AnimatedFacialAvatar({
  profile,
  speaking,
  viseme,
  levelRef,
  onToggleSpeech,
  small = false,
}: {
  profile: AgentProfile;
  speaking: boolean;
  viseme: VisemeShape;
  levelRef: RefObject<HTMLDivElement | null>;
  onToggleSpeech?: () => void;
  /** The 44px orb of the phone strip. */
  small?: boolean;
}) {
  const currentProfile = AGENT_PROFILES.find((p) => p.id === profile) ?? AGENT_PROFILES[0]!;
  const orb = ORBS[profile] ?? ORBS.tempo;
  const bars = BARS[speaking ? viseme : "A"] ?? BARS.A;
  const size = small ? "h-11 w-11" : "h-32 w-32 lg:h-44 lg:w-44";

  return (
    <button
      type="button"
      onClick={onToggleSpeech}
      aria-label={speaking ? "Stop speaking" : `Read the last reply aloud (${currentProfile.name})`}
      title={speaking ? "Click the face to stop speaking" : "Click the face to hear the last reply"}
      className={`group/face relative flex cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 ${FOCUS}`}
    >
      <div ref={levelRef} className={`relative grid place-items-center ${size}`}>
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full ${orb.glow} ${small ? "blur-md" : "blur-3xl"} motion-reduce:transition-none`}
          style={{
            transform: `scale(calc(${speaking ? 1.1 : 0.95} + var(--level, 0) * 0.55))`,
            opacity: speaking ? 0.55 : 0.28,
            transition: "transform 90ms ease-out, opacity 300ms ease-in-out",
          }}
        />
        {speaking && !small && (
          <>
            <span aria-hidden className={`absolute inset-0 rounded-full border ${orb.ring} animate-ripple`} />
            <span aria-hidden className={`absolute inset-0 rounded-full border ${orb.ring} animate-ripple`} style={{ animationDelay: "1.2s" }} />
          </>
        )}
        <span
          aria-hidden
          className="relative h-full w-full overflow-hidden rounded-full shadow-[0_20px_60px_-20px_rgb(0_0_0/0.9),inset_0_-10px_30px_rgb(0_0_0/0.45)] transition-transform duration-300 group-hover/face:scale-[1.03] motion-safe:animate-breathe motion-reduce:transition-none"
          style={{ transform: `scale(calc(1 + var(--level, 0) * 0.06))` }}
        >
          <span className="absolute inset-[-30%] motion-safe:animate-spin-slow" style={{ background: orb.sphere }} />
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_34%_26%,rgb(255_255_255/0.6),transparent_34%)]" />
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_115%,rgb(7_7_11/0.6),transparent_62%)]" />
          <span className="absolute inset-[2px] rounded-full ring-1 ring-inset ring-white/25" />
        </span>
        <svg aria-hidden viewBox="0 0 50 30" className={`absolute ${small ? "w-6" : "w-14 lg:w-20"}`}>
          {bars.map((height, i) => (
            <rect
              key={i}
              x={3 + i * 9.5}
              y={3}
              width={5}
              height={24}
              rx={2.5}
              fill="white"
              fillOpacity={speaking ? 0.92 : 0.55}
              style={{
                transform: `scaleY(${speaking ? height : 0.18})`,
                transformOrigin: "center",
                transformBox: "fill-box",
                transition: "transform 80ms ease-out, fill-opacity 200ms",
              }}
            />
          ))}
        </svg>
      </div>
    </button>
  );
}

function Stage({
  profile,
  mode,
  speaking,
  viseme,
  levelRef,
  onToggleSpeech,
}: {
  profile: AgentProfile;
  mode: OutputMode;
  speaking: boolean;
  viseme: VisemeShape;
  levelRef: RefObject<HTMLDivElement | null>;
  onToggleSpeech?: () => void;
}) {
  const currentProfile = AGENT_PROFILES.find((p) => p.id === profile) ?? AGENT_PROFILES[0]!;

  if (mode === "avatar") {
    return (
      <div className="flex flex-col items-center text-center">
        <AnimatedFacialAvatar profile={profile} speaking={speaking} viseme={viseme} levelRef={levelRef} onToggleSpeech={onToggleSpeech} />
        <div className="mt-6 flex flex-col items-center gap-1.5">
          <span className="flex items-center gap-2 font-display text-[1.7rem] leading-none text-white">
            {currentProfile.icon}
            {currentProfile.name}
          </span>
          <span className="text-xs text-slate-400">{currentProfile.role}</span>
        </div>
      </div>
    );
  }

  if (mode === "voice") {
    return (
      <button type="button" onClick={onToggleSpeech} className={`rounded-full p-2 ${FOCUS}`} aria-label={speaking ? "Stop speaking" : "Read the last reply aloud"}>
        <div ref={levelRef} className="rounded-full">
          <AudioLines className={`h-16 w-16 max-w-full lg:h-24 lg:w-24 ${speaking ? "text-accent-300" : "text-white"}`} strokeWidth={1.5} aria-hidden />
        </div>
      </button>
    );
  }

  return <MessageSquareText className="h-16 w-16 max-w-full text-white lg:h-24 lg:w-24" strokeWidth={1.5} aria-label="Text only" role="img" />;
}

export function AvatarPanel({
  className = "",
  onModeChange,
  selectedProfile = "tempo",
  onProfileChange,
  volume,
  onVolumeChange,
  speech,
  hush = 0,
  elevenLabsKey,
  tts,
  ttsAvailable = false,
  lang = "en-GB",
  compact = false,
  extra,
}: AvatarPanelProps) {
  // Voice is on by default: the browser's own voice needs no key (plan.md §9).
  const [mode, setMode] = useState<OutputMode>("avatar");
  const [profile, setProfile] = useState<AgentProfile>(selectedProfile);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [controlsRef, controlsWidth] = useElementWidth<HTMLDivElement>();
  const selectId = useId();

  const { speak, stop, setPlaybackVolume, isLoading, isSpeaking, error, source, levelRef, currentViseme } = useSpeech({ elevenLabsKey, tts, ttsAvailable, lang });

  const activeProfile = AGENT_PROFILES.find((p) => p.id === profile) ?? AGENT_PROFILES[0]!;
  const voiceOn = mode !== "text";
  const showControls = controlsWidth >= SHOW_CONTROLS_FROM;
  const fullBadge = controlsWidth >= SHOW_FULL_BADGE_FROM;
  const sliderFits = controlsWidth >= SHOW_SLIDER_FROM;
  const sliderVisible = voiceOn && sliderFits && (hovered || pinned);

  const SpeakerIcon = !voiceOn || volume === 0 ? VolumeX : volume <= 50 ? Volume1 : Volume2;

  const handleVolumeInput = (newVol: number) => {
    onVolumeChange(newVol);
    setPlaybackVolume(newVol);
  };

  const cycleVolume = () => {
    if (!voiceOn) return;
    if (volume === 0) handleVolumeInput(50);
    else if (volume <= 50) handleVolumeInput(100);
    else handleVolumeInput(0);
  };

  const handleToggleSpeech = () => {
    if (isSpeaking) stop();
    else if (speech?.text) void speak(speech.text, activeProfile.id, volume);
  };

  useEffect(() => {
    if (!pinned) return;
    const timer = setTimeout(() => setPinned(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [pinned, volume]);

  useEffect(() => {
    if (!speech || speech.id === lastSpokenId) return;
    lastSpokenId = speech.id;
    if (mode === "text" || volume === 0) return;
    void speak(speech.text, activeProfile.id, volume);
  }, [speech?.id, speech?.text, speech, mode, volume, activeProfile.id, speak]);

  useEffect(() => {
    if (mode === "text" || volume === 0) stop();
  }, [mode, volume, stop]);

  useEffect(() => {
    if (hush) stop();
  }, [hush, stop]);

  useEffect(() => {
    setPlaybackVolume(volume);
  }, [volume, setPlaybackVolume]);

  const selectMode = (nextMode: OutputMode) => {
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  const modeIndex = MODES.indexOf(mode);
  const onEnter = (e: PointerEvent) => e.pointerType === "mouse" && setHovered(true);
  const onLeave = (e: PointerEvent) => e.pointerType === "mouse" && setHovered(false);
  const voiceWords = source === "gateway" ? "Tempo's voice" : source === "elevenlabs" ? "your ElevenLabs key" : source === "browser" ? "this browser's voice" : ttsAvailable ? "Tempo's voice" : elevenLabsKey?.trim() ? "your ElevenLabs key" : "this browser's voice";
  const nextMode = MODES[(modeIndex + 1) % MODES.length]!;

  if (compact) {
    // The phone strip: the face (its mouth still moves), who is speaking, how replies come, the speaker.
    const line = !voiceOn ? "Voice off: text only" : isLoading ? "Preparing voice…" : isSpeaking ? "Speaking…" : error ? error : `Voice: ${voiceWords}`;
    return (
      <aside aria-label="Tempo's voice and face" className={`surface flex h-[60px] min-w-0 items-center gap-2 rounded-2xl px-2 ${className}`}>
        <div className="shrink-0">
          {mode === "avatar" ? (
            <AnimatedFacialAvatar profile={profile} speaking={isSpeaking} viseme={currentViseme} levelRef={levelRef} onToggleSpeech={handleToggleSpeech} small />
          ) : (
            <button
              type="button"
              onClick={handleToggleSpeech}
              disabled={!voiceOn}
              aria-label={isSpeaking ? "Stop speaking" : "Read the last reply aloud"}
              className={`flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-slate-900/90 text-white disabled:opacity-60 ${FOCUS}`}
            >
              <div ref={levelRef} className="flex items-center justify-center">
                {mode === "voice" ? <AudioLines size={22} className={isSpeaking ? "text-accent-300" : ""} aria-hidden /> : <MessageSquareText size={22} aria-hidden />}
              </div>
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-1 text-sm font-semibold ${activeProfile.badgeText}`}>
            {activeProfile.icon}
            <span className="truncate">{activeProfile.name}</span>
          </p>
          <p role="status" aria-live="polite" className={`truncate text-[11px] ${error && voiceOn && !isLoading && !isSpeaking ? "text-rose-300" : "text-slate-400"}`}>
            {line}
          </p>
        </div>
        <button
          type="button"
          onClick={() => selectMode(nextMode)}
          aria-label={`Reply mode: ${LABELS[mode]}. Tap for ${LABELS[nextMode]}.`}
          title={`Reply mode: ${LABELS[mode]}`}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-accent-100 ring-1 ring-inset ring-accent-300/25 active:scale-95 motion-reduce:transform-none ${FOCUS}`}
        >
          {MODE_ICONS[mode]}
        </button>
        <button
          type="button"
          disabled={!voiceOn}
          onClick={cycleVolume}
          aria-label={`Volume: ${voiceOn ? volume : 0}%. Tap to change`}
          title={`Volume: ${volume}%`}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 ${FOCUS} ${voiceOn ? "text-white" : "cursor-not-allowed text-nexus-silver opacity-40"}`}
        >
          <SpeakerIcon size={20} aria-hidden />
        </button>
        {extra && <div className="shrink-0">{extra}</div>}
      </aside>
    );
  }

  return (
    <aside
      aria-label="Tempo's voice and face"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={() => setPinned((p) => !p)}
      className={`surface group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-3xl p-4 lg:p-5 ${className}`}
    >
      <div className="relative z-20 mb-2 flex w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <label htmlFor={selectId} className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Who is speaking
        </label>
        <div className="relative w-full">
          <select
            id={selectId}
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value as AgentProfile);
              onProfileChange?.(e.target.value as AgentProfile);
            }}
            className={`h-10 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-8 text-[13px] font-medium text-slate-100 transition-colors hover:border-white/20 ${FOCUS}`}
          >
            {AGENT_PROFILES.map((p) => (
              <option key={p.id} value={p.id} className="bg-ink-800 text-slate-100">
                {p.name} · {p.role}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">{activeProfile.icon}</div>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        </div>
      </div>

      <div className="my-auto flex min-w-0 shrink-0 flex-col items-center justify-center gap-2 py-2 lg:w-full lg:flex-1">
        <Stage profile={profile} mode={mode} speaking={isSpeaking} viseme={currentViseme} levelRef={levelRef} onToggleSpeech={handleToggleSpeech} />

        <div className="flex min-h-5 items-center gap-2 text-[11px]" onClick={(e) => e.stopPropagation()} role="status" aria-live="polite">
          {voiceOn && isLoading && (
            <span className="flex items-center gap-1.5 text-slate-300">
              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> Preparing voice…
            </span>
          )}
          {voiceOn && error && !isLoading && !isSpeaking && <span className="max-w-full truncate text-rose-300">{error}</span>}
          {voiceOn && !isLoading && !error && <span className="max-w-full truncate text-slate-500">Speaking with {voiceWords}</span>}
          {!voiceOn && <span className="text-slate-500">Voice off: replies are text only</span>}
        </div>
      </div>

      <div ref={controlsRef} className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden border-t border-white/5 pt-2 lg:w-full lg:flex-none lg:justify-between">
        {showControls && (
          <>
            {fullBadge ? (
              <div onClick={(e) => e.stopPropagation()} role="group" aria-label="How Tempo replies" className="relative flex h-9 w-48 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
                <div className="absolute bottom-1 top-1 w-[calc(33.333%-2px)] rounded-full bg-gradient-to-b from-accent-500/45 to-accent-700/40 shadow-[0_1px_0_0_rgb(255_255_255/0.12)_inset] ring-1 ring-inset ring-accent-300/25 transition-transform duration-200 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${modeIndex * 100}%)` }} aria-hidden />
                {MODES.map((m) => {
                  const isActive = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => selectMode(m)}
                      className={`relative z-10 flex flex-1 items-center justify-center gap-1 rounded-full text-[11px] font-medium transition-colors motion-reduce:transition-none ${FOCUS} ${isActive ? "text-white" : "text-nexus-silver hover:text-white"}`}
                    >
                      {MODE_ICONS[m]}
                      <span className="truncate">{LABELS[m]}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectMode(MODES[(modeIndex + 1) % MODES.length]!);
                }}
                aria-label={`Reply mode: ${LABELS[mode]}. Click to switch.`}
                title={`Reply mode: ${LABELS[mode]}. Click to switch.`}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-accent-100 ring-1 ring-inset ring-accent-300/25 transition-transform active:scale-95 motion-reduce:transition-none ${FOCUS}`}
              >
                {MODE_ICONS[mode]}
              </button>
            )}

            <button
              type="button"
              disabled={!voiceOn}
              onClick={(e) => {
                e.stopPropagation();
                cycleVolume();
              }}
              title={`Volume: ${volume}%. Click to cycle levels.`}
              aria-label={`Volume: ${volume}%. Click to cycle levels`}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 motion-reduce:transition-none ${FOCUS} ${voiceOn ? "text-white" : "cursor-not-allowed text-nexus-silver opacity-40"}`}
            >
              <SpeakerIcon size={18} aria-hidden />
            </button>

            {sliderFits && (
              <div
                onClick={(e) => e.stopPropagation()}
                className={`flex min-w-0 flex-1 items-center transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none ${sliderVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
              >
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  disabled={!voiceOn}
                  onInput={(e) => handleVolumeInput(Number((e.target as HTMLInputElement).value))}
                  onChange={(e) => handleVolumeInput(Number(e.target.value))}
                  aria-label="Volume"
                  className="h-1.5 w-full min-w-0 cursor-pointer accent-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
                />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

export default AvatarPanel;
