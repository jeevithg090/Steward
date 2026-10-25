import { useEffect, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  AudioLines,
  Briefcase,
  Calculator,
  ChevronDown,
  FileCheck,
  Loader2,
  MessageSquareText,
  ShieldAlert,
  User,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useSpeech, type VisemeShape } from "../../hooks/useSpeech";

export type OutputMode = "avatar" | "voice" | "text";
export type AgentProfile = "negotiator" | "contractor" | "analyst" | "auditor";

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
    id: "negotiator",
    name: "Negotiator",
    role: "Rights & Claim Proxy",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    icon: <Briefcase size={14} className="text-emerald-400" />,
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Rules & Time Value Engine",
    badgeBg: "bg-indigo-500/20",
    badgeText: "text-indigo-300",
    icon: <Calculator size={14} className="text-indigo-400" />,
  },
  {
    id: "auditor",
    name: "Auditor",
    role: "Proof & Verifier",
    badgeBg: "bg-purple-500/20",
    badgeText: "text-purple-300",
    icon: <FileCheck size={14} className="text-purple-400" />,
  },
  {
    id: "contractor",
    name: "Contractor",
    role: "Browser Execution Worker",
    badgeBg: "bg-amber-500/20",
    badgeText: "text-amber-300",
    icon: <ShieldAlert size={14} className="text-amber-400" />,
  },
];

const MODES: OutputMode[] = ["avatar", "voice", "text"];
const LABELS: Record<OutputMode, string> = { avatar: "Avatar", voice: "Voice", text: "Text" };
const MODE_ICONS: Record<OutputMode, ReactNode> = {
  avatar: <User size={15} />,
  voice: <AudioLines size={15} />,
  text: <MessageSquareText size={15} />,
};

const VISEME_PATHS: Record<VisemeShape, string> = {
  A: "M53 53 Q60 53.5 67 53 Q60 54 53 53 Z",
  B: "M53 52.5 Q60 55 67 52.5 Q60 56 53 52.5 Z",
  C: "M52 51.5 Q60 57.5 68 51.5 Q60 58.5 52 51.5 Z",
  D: "M51 51.5 Q60 56 69 51.5 Q60 54 51 51.5 Z",
  E: "M55 51 Q60 57.5 65 51 Q60 57 55 51 Z",
  F: "M53 52 Q60 53.5 67 52 Q60 56.5 53 52 Z",
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
  elevenLabsKey?: string;
  apiBaseUrl?: string;
  apiToken?: string;
}

function AnimatedFacialAvatar({
  profile,
  speaking,
  viseme,
  levelRef,
  onToggleSpeech,
}: {
  profile: AgentProfile;
  speaking: boolean;
  viseme: VisemeShape;
  levelRef: RefObject<HTMLDivElement | null>;
  onToggleSpeech?: () => void;
}) {
  const currentProfile = AGENT_PROFILES.find((p) => p.id === profile) || AGENT_PROFILES[0];
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 150);
    }, 3800);
    return () => clearInterval(blinkInterval);
  }, []);

  return (
    <button
      type="button"
      onClick={onToggleSpeech}
      aria-label={speaking ? "Stop speaking" : `${currentProfile.name} avatar`}
      title={speaking ? "Click face to stop speaking" : "Avatar"}
      className="group/face relative flex cursor-pointer items-center justify-center border-none bg-transparent p-0 outline-none focus:outline-none"
    >
      <div
        style={{
          transform: "scale(calc(1 + var(--level, 0) * 0.25))",
          opacity: speaking ? 0.6 : 0.15,
          transition: "transform 80ms ease-out, opacity 120ms ease-in-out",
        }}
        className="absolute h-24 w-24 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 blur-xl lg:h-36 lg:w-36"
      />
      <div
        ref={levelRef}
        className={`relative z-10 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border bg-slate-900/90 shadow-2xl transition-all group-hover/face:border-indigo-400 group-hover/face:scale-105 lg:h-36 lg:w-36 ${
          speaking ? "border-indigo-400 shadow-indigo-500/30" : "border-white/10"
        }`}
      >
        <svg
          viewBox="0 0 120 120"
          className="h-20 w-20 text-indigo-100 lg:h-32 lg:w-32"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={`${currentProfile.name} animated avatar`}
        >
          <circle cx="60" cy="60" r="50" className="fill-indigo-950/40 stroke-none" />
          <circle cx="60" cy="42" r="22" strokeWidth="2.5" className="stroke-slate-200" />
          <path d="M18 110c0-26 18-44 42-44s42 18 42 44" strokeWidth="2.5" className="stroke-slate-300" />
          
          {isBlinking ? (
            <>
              <line x1="48" y1="38" x2="54" y2="38" strokeWidth="2.2" className="stroke-indigo-300" />
              <line x1="66" y1="38" x2="72" y2="38" strokeWidth="2.2" className="stroke-indigo-300" />
            </>
          ) : (
            <>
              <circle cx="51" cy="38" r="2.2" className="fill-indigo-300 stroke-none" />
              <circle cx="69" cy="38" r="2.2" className="fill-indigo-300 stroke-none" />
            </>
          )}

          <path
            d={VISEME_PATHS[viseme] || VISEME_PATHS.A}
            className={speaking ? "fill-indigo-400/25 stroke-indigo-300" : "fill-slate-400/10 stroke-slate-400"}
            strokeWidth="1.8"
            style={{ transition: "d 60ms ease-out" }}
          />
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
  const currentProfile = AGENT_PROFILES.find((p) => p.id === profile) || AGENT_PROFILES[0];

  if (mode === "avatar") {
    return (
      <div className="flex flex-col items-center text-center">
        <AnimatedFacialAvatar
          profile={profile}
          speaking={speaking}
          viseme={viseme}
          levelRef={levelRef}
          onToggleSpeech={onToggleSpeech}
        />
        <div className="mt-4 flex flex-col items-center gap-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${currentProfile.badgeBg} ${currentProfile.badgeText}`}
          >
            {currentProfile.icon}
            {currentProfile.name}
          </span>
          <span className="text-[10px] text-slate-400">{currentProfile.role}</span>
        </div>
      </div>
    );
  }

  if (mode === "voice") {
    return (
      <button
        type="button"
        onClick={onToggleSpeech}
        className="rounded-full p-2 outline-none focus:outline-none"
        aria-label={speaking ? "Stop speaking" : "Voice output"}
      >
        <div ref={levelRef} className="rounded-full">
          <AudioLines
            className={`h-16 w-16 max-w-full text-white lg:h-24 lg:w-24 ${speaking ? "text-indigo-300" : ""}`}
            strokeWidth={1.5}
          />
        </div>
      </button>
    );
  }

  return (
    <MessageSquareText
      className="h-16 w-16 max-w-full text-white lg:h-24 lg:w-24"
      strokeWidth={1.5}
      aria-label="Text output"
    />
  );
}

export function AvatarPanel({
  className = "",
  onModeChange,
  selectedProfile = "negotiator",
  onProfileChange,
  volume,
  onVolumeChange,
  speech,
  elevenLabsKey,
  apiBaseUrl,
  apiToken,
}: AvatarPanelProps) {
  const hasValidElevenLabsKey = Boolean(elevenLabsKey && elevenLabsKey.trim().length > 0);

  const [mode, setMode] = useState<OutputMode>(hasValidElevenLabsKey ? "avatar" : "text");
  const [profile, setProfile] = useState<AgentProfile>(selectedProfile);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [controlsRef, controlsWidth] = useElementWidth<HTMLDivElement>();

  useEffect(() => {
    if (!hasValidElevenLabsKey && mode !== "text") {
      setMode("text");
      onModeChange?.("text");
    }
  }, [hasValidElevenLabsKey, mode, onModeChange]);

  const { speak, stop, setPlaybackVolume, isLoading, isSpeaking, error, levelRef, currentViseme } = useSpeech({
    apiBaseUrl,
    apiToken,
    elevenLabsKey,
  });

  const activeProfile = AGENT_PROFILES.find((p) => p.id === profile) || AGENT_PROFILES[0];
  const voiceOn = hasValidElevenLabsKey && mode !== "text";
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
    if (isSpeaking) {
      stop();
    } else if (speech?.text) {
      void speak(speech.text, activeProfile.id, volume);
    }
  };

  useEffect(() => {
    if (!pinned) return;
    const timer = setTimeout(() => setPinned(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [pinned, volume]);

  useEffect(() => {
    if (!speech || speech.id === lastSpokenId) return;
    lastSpokenId = speech.id;
    if (!hasValidElevenLabsKey || mode === "text" || volume === 0) return;
    void speak(speech.text, activeProfile.id, volume);
  }, [speech?.id, speech?.text, hasValidElevenLabsKey, mode, volume, activeProfile.id, speak]);

  useEffect(() => {
    if (!hasValidElevenLabsKey || mode === "text" || volume === 0) stop();
  }, [hasValidElevenLabsKey, mode, volume, stop]);

  // Keep volume synchronized with parent component state
  useEffect(() => {
    setPlaybackVolume(volume);
  }, [volume, setPlaybackVolume]);

  const selectMode = (nextMode: OutputMode) => {
    if (!hasValidElevenLabsKey && nextMode !== "text") return;
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  const modeIndex = MODES.indexOf(mode);
  const onEnter = (e: PointerEvent) => e.pointerType === "mouse" && setHovered(true);
  const onLeave = (e: PointerEvent) => e.pointerType === "mouse" && setHovered(false);

  return (
    <aside
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={() => setPinned((p) => !p)}
      className={`group flex min-w-0 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl bg-nexus-card p-4 lg:p-5 ${className}`}
    >
      <div className="relative z-20 flex w-full flex-col gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Agent Persona
        </label>

        <div className="relative w-full">
          <select
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value as AgentProfile);
              onProfileChange?.(e.target.value as AgentProfile);
            }}
            className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-slate-900/90 py-1.5 pl-8 pr-7 text-xs font-medium text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            {AGENT_PROFILES.map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                {p.name} ({p.role})
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
            {activeProfile.icon}
          </div>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      <div className="my-auto flex min-w-0 shrink-0 flex-col items-center justify-center gap-2 py-2 lg:w-full lg:flex-1">
        <Stage
          profile={profile}
          mode={mode}
          speaking={isSpeaking}
          viseme={currentViseme}
          levelRef={levelRef}
          onToggleSpeech={handleToggleSpeech}
        />

        {voiceOn && (isLoading || error) && (
          <div className="flex min-h-5 items-center gap-2 text-[11px]" onClick={(e) => e.stopPropagation()} role="status">
            {isLoading && (
              <span className="flex items-center gap-1.5 text-slate-300">
                <Loader2 size={12} className="animate-spin" /> Preparing voice…
              </span>
            )}
            {error && !isLoading && !isSpeaking && <span className="max-w-full truncate text-red-400">{error}</span>}
          </div>
        )}
      </div>

      <div
        ref={controlsRef}
        className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden lg:w-full lg:flex-none lg:justify-between pt-2 border-t border-white/5"
      >
        {showControls && (
          <>
            {fullBadge ? (
              <div onClick={(e) => e.stopPropagation()} className="relative flex h-8 w-44 shrink-0 rounded-full bg-black/40 p-1">
                <div
                  className="absolute bottom-1 top-1 w-[calc(33.333%-2px)] rounded-full bg-nexus-badge transition-transform duration-200 ease-out"
                  style={{ transform: `translateX(${modeIndex * 100}%)` }}
                />

                {MODES.map((m) => {
                  const isActive = mode === m;
                  const isDisabled = !hasValidElevenLabsKey && m !== "text";
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => selectMode(m)}
                      title={isDisabled ? "Requires ElevenLabs API key for audio output" : ""}
                      className={`relative z-10 flex flex-1 items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                        isDisabled ? "cursor-not-allowed opacity-40 text-slate-500" : isActive ? "text-white" : "text-nexus-silver hover:text-white"
                      }`}
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
                disabled={!hasValidElevenLabsKey}
                onClick={(e) => {
                  e.stopPropagation();
                  selectMode(MODES[(modeIndex + 1) % MODES.length]);
                }}
                title={!hasValidElevenLabsKey ? "Audio options disabled: valid ElevenLabs API key required" : `Current Mode: ${LABELS[mode]}. Click to switch.`}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nexus-badge text-white transition-transform ${
                  !hasValidElevenLabsKey ? "cursor-not-allowed opacity-40" : "active:scale-95"
                }`}
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
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 ${
                voiceOn ? "text-white" : "text-nexus-silver opacity-40 cursor-not-allowed"
              }`}
            >
              <SpeakerIcon size={18} />
            </button>

            {sliderFits && (
              <div
                onClick={(e) => e.stopPropagation()}
                className={`flex min-w-0 flex-1 items-center transition-opacity duration-150 motion-reduce:transition-none group-focus-within:pointer-events-auto group-focus-within:opacity-100 ${
                  sliderVisible ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
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
                  aria-label="Volume slider"
                  className="h-1.5 w-full min-w-0 cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-40"
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