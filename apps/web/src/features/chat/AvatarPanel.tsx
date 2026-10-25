import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import {
  AudioLines,
  Briefcase,
  Calculator,
  ChevronDown,
  FileCheck,
  MessageSquareText,
  ShieldAlert,
  User,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useElementWidth } from "../../hooks/useElementWidth";

export type OutputMode = "avatar" | "voice" | "text";
export type AgentProfile = "negotiator" | "contractor" | "analyst" | "auditor";

export interface ProfileOption {
  id: AgentProfile;
  name: string;
  role: string;
  description: string;
  badgeBg: string;
  badgeText: string;
  icon: ReactNode;
}

export const AGENT_PROFILES: ProfileOption[] = [
  {
    id: "negotiator",
    name: "Negotiator",
    role: "Rights & Claim Proxy",
    description: "Assertive, concise, focused on securing maximum compensation & waivers.",
    badgeBg: "bg-emerald-500/20",
    badgeText: "text-emerald-300",
    icon: <Briefcase size={14} className="text-emerald-400" />,
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Rules & Time Value Engine",
    description: "Calculates expected yield vs. hourly effort required to rank top claims.",
    badgeBg: "bg-indigo-500/20",
    badgeText: "text-indigo-300",
    icon: <Calculator size={14} className="text-indigo-400" />,
  },
  {
    id: "auditor",
    name: "Auditor",
    role: "Proof & Verifier",
    description: "Inspects rule matrices, citation links, and juror consensus traces.",
    badgeBg: "bg-purple-500/20",
    badgeText: "text-purple-300",
    icon: <FileCheck size={14} className="text-purple-400" />,
  },
  {
    id: "contractor",
    name: "Contractor",
    role: "Browser Execution Worker",
    description: "Navigates forms, fills fields, and stages tasks for approval.",
    badgeBg: "bg-amber-500/20",
    badgeText: "text-amber-300",
    icon: <ShieldAlert size={14} className="text-amber-400" />,
  },
];

const MODES: OutputMode[] = ["avatar", "voice", "text"];

const LABELS: Record<OutputMode, string> = {
  avatar: "Avatar",
  voice: "Voice",
  text: "Text",
};

const MODE_ICONS: Record<OutputMode, ReactNode> = {
  avatar: <User size={15} />,
  voice: <AudioLines size={15} />,
  text: <MessageSquareText size={15} />,
};

/** Precise width thresholds (px) to guarantee zero horizontal overflow */
const SHOW_CONTROLS_FROM = 60;   // Show single mode button + speaker icon
const SHOW_SLIDER_FROM = 160;     // Show slider alongside single mode button
const SHOW_FULL_BADGE_FROM = 300; // Show full 3-button switcher alongside slider & speaker

/** How long a tapped-open slider stays visible without interaction. */
const AUTO_HIDE_MS = 3000;

interface AvatarPanelProps {
  className?: string;
  onModeChange?: (mode: OutputMode) => void;
  selectedProfile?: AgentProfile;
  onProfileChange?: (profile: AgentProfile) => void;
  /** Volume from 0 to 100, owned by parent. */
  volume: number;
  onVolumeChange: (volume: number) => void;
}

function Avatar({ profile }: { profile: AgentProfile }) {
  const currentProfile = AGENT_PROFILES.find((p) => p.id === profile) || AGENT_PROFILES[0];

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 shadow-inner lg:h-32 lg:w-32">
        <svg
          viewBox="0 0 120 120"
          className="h-16 w-16 text-white lg:h-24 lg:w-24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={`${currentProfile.name} avatar`}
        >
          <circle cx="60" cy="40" r="20" />
          <path d="M20 110c0-28 18-48 40-48s40 20 40 48" />
        </svg>
      </div>

      <div className="mt-3 flex flex-col items-center gap-1">
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

const STAGE = (profile: AgentProfile): Record<OutputMode, ReactNode> => ({
  avatar: <Avatar profile={profile} />,
  voice: (
    <AudioLines
      className="h-16 w-16 max-w-full text-white lg:h-24 lg:w-24"
      strokeWidth={1.5}
      aria-label="Voice output"
    />
  ),
  text: (
    <MessageSquareText
      className="h-16 w-16 max-w-full text-white lg:h-24 lg:w-24"
      strokeWidth={1.5}
      aria-label="Text output"
    />
  ),
});

export function AvatarPanel({
  className = "",
  onModeChange,
  selectedProfile = "negotiator",
  onProfileChange,
  volume,
  onVolumeChange,
}: AvatarPanelProps) {
  const [mode, setMode] = useState<OutputMode>("avatar");
  const [profile, setProfile] = useState<AgentProfile>(selectedProfile);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [controlsRef, controlsWidth] = useElementWidth<HTMLDivElement>();

  const activeProfile = AGENT_PROFILES.find((p) => p.id === profile) || AGENT_PROFILES[0];

  const voiceOn = mode !== "text";
  const showControls = controlsWidth >= SHOW_CONTROLS_FROM;
  const fullBadge = controlsWidth >= SHOW_FULL_BADGE_FROM;
  const sliderFits = controlsWidth >= SHOW_SLIDER_FROM;
  const sliderVisible = voiceOn && sliderFits && (hovered || pinned);

  const SpeakerIcon =
    !voiceOn || volume === 0
      ? VolumeX
      : volume <= 50
      ? Volume1
      : Volume2;

  const cycleVolume = () => {
    if (!voiceOn) return;
    if (volume === 0) onVolumeChange(50);
    else if (volume <= 50) onVolumeChange(100);
    else onVolumeChange(0);
  };

  useEffect(() => {
    if (!pinned) return;
    const timer = setTimeout(() => setPinned(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [pinned, volume]);

  const selectMode = (nextMode: OutputMode) => {
    setMode(nextMode);
    onModeChange?.(nextMode);
  };

  const handleProfileSelect = (p: AgentProfile) => {
    setProfile(p);
    onProfileChange?.(p);
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
      {/* Top Profile Selector Dropdown */}
      <div className="relative z-20 w-full mb-2" onClick={(e) => e.stopPropagation()}>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
          Agent Persona
        </label>
        <div className="relative">
          <select
            value={profile}
            onChange={(e) => handleProfileSelect(e.target.value as AgentProfile)}
            className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-slate-900/90 py-1.5 pl-8 pr-8 text-xs font-medium text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            {AGENT_PROFILES.map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                {p.name} • {p.role}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
            {activeProfile.icon}
          </div>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
        </div>
      </div>

      {/* Main Avatar / Mode Stage */}
      <div className="flex min-w-0 shrink-0 items-center justify-center my-auto py-2 lg:w-full lg:flex-1">
        {STAGE(profile)[mode]}
      </div>

      {/* Controls Bar */}
      <div
        ref={controlsRef}
        className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden lg:w-full lg:flex-none lg:justify-between pt-2 border-t border-white/5"
      >
        {showControls && (
          <>
            {/* 1. Mode Switcher */}
            {fullBadge ? (
              <div
                onClick={(e) => e.stopPropagation()}
                className="relative flex h-8 w-44 shrink-0 rounded-full bg-black/40 p-1"
              >
                <div
                  className="absolute bottom-1 top-1 w-[calc(33.333%-2px)] rounded-full bg-nexus-badge transition-transform duration-200 ease-out"
                  style={{ transform: `translateX(${modeIndex * 100}%)` }}
                />

                {MODES.map((m) => {
                  const isActive = mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => selectMode(m)}
                      className={`relative z-10 flex flex-1 items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                        isActive ? "text-white" : "text-nexus-silver hover:text-white"
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
                onClick={(e) => {
                  e.stopPropagation();
                  selectMode(MODES[(modeIndex + 1) % MODES.length]);
                }}
                title={`Current Mode: ${LABELS[mode]}. Click to switch.`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-nexus-badge text-white transition-transform active:scale-95"
              >
                {MODE_ICONS[mode]}
              </button>
            )}

            {/* 2. Speaker Button */}
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
                voiceOn ? "text-white" : "text-nexus-silver"
              }`}
            >
              <SpeakerIcon size={18} />
            </button>

            {/* 3. Volume Slider */}
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
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  aria-label="Volume slider"
                  className="h-1.5 w-full min-w-0 cursor-pointer accent-white"
                />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}