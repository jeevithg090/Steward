// The shared look of a mission (docs/design-system.md): the skill's icon tile, the state's colour
// on a rail, a ring or a glow, and the word under an amount. Status is never colour alone: every
// colour here sits next to the state's own words.
import type { ReactNode } from "react";
import { Sparkles, TrainFront, Wrench } from "lucide-react";
import type { BadgeTone } from "@/components/ui";
import type { MissionState } from "@/lib/api";
import { isLive } from "./words";

/** The 3-px rail down a card's left edge, and its soft glow. */
export const RAIL: Record<BadgeTone, string> = {
  emerald: "bg-emerald-400 shadow-[0_0_14px_1px_rgb(52_211_153/0.55)]",
  amber: "bg-amber-400 shadow-[0_0_14px_1px_rgb(251_191_36/0.5)]",
  rose: "bg-rose-400 shadow-[0_0_14px_1px_rgb(251_113_133/0.5)]",
  indigo: "bg-accent-400 shadow-[0_0_14px_1px_rgb(var(--accent-400)/0.6)]",
  purple: "bg-second-400 shadow-[0_0_14px_1px_rgb(var(--second-400)/0.5)]",
  slate: "bg-slate-500",
  gold: "bg-gold-400 shadow-[0_0_14px_1px_rgb(245_181_68/0.55)]",
};

/** A hairline in the state's colour, fading out at both ends (under the sticky state bar). */
export const GLOW_LINE: Record<BadgeTone, string> = {
  emerald: "via-emerald-400/70",
  amber: "via-amber-400/70",
  rose: "via-rose-400/70",
  indigo: "via-accent-400/80",
  purple: "via-second-400/70",
  slate: "via-white/20",
  gold: "via-gold-400/70",
};

const SKILL_ICON = { rail: TrainFront, ofcom: Wrench, other: Sparkles } as const;

/** The skill's icon on a small glass tile (decorative: the skill is always said in words beside it). */
export function SkillIcon({ skillId, size = "md" }: { skillId: string | null | undefined; size?: "sm" | "md" }) {
  const id = skillId ?? "";
  const Icon = SKILL_ICON[id.includes("rail") ? "rail" : id.includes("ofcom") ? "ofcom" : "other"];
  const box = size === "sm" ? "h-9 w-9 rounded-xl" : "h-11 w-11 rounded-2xl";
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center bg-gradient-to-b from-white/[0.09] to-white/[0.02] text-accent-200 shadow-[0_1px_0_0_rgb(255_255_255/0.08)_inset] ring-1 ring-inset ring-white/10 ${box}`}
    >
      <Icon size={size === "sm" ? 16 : 19} strokeWidth={1.75} />
    </span>
  );
}

/** The word under a mission's amount: what that money is, so gold is never the only signal. */
export function amountWord(state: MissionState): string {
  if (state === "verified") return "paid";
  if (state === "completed") return "resolved";
  return isLive(state) ? "to claim" : "not claimed";
}

/** The amount's colour: gold once it arrived, white while it is still being claimed, struck when stopped. */
export function amountTone(state: MissionState): string {
  if (state === "verified") return "text-gold";
  if (state === "completed") return "text-white";
  return isLive(state) ? "text-white" : "text-slate-400 line-through decoration-slate-500/70";
}

/**
 * A detail card's heading: an icon on a glass tile, the card title (15 px, white), an optional
 * line under it and a right-hand slot for a status badge.
 */
export function PanelHeading({
  id,
  icon,
  title,
  sub,
  right,
  as = "h3",
  className = "mb-5",
}: {
  id: string;
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  const Tag = as;
  return (
    <div className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-white/[0.09] to-white/[0.02] text-accent-200 shadow-[0_1px_0_0_rgb(255_255_255/0.08)_inset] ring-1 ring-inset ring-white/10"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <Tag id={id} className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white">
            {title}
          </Tag>
          {sub && <p className="mt-1 text-xs leading-snug text-slate-400">{sub}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2 pt-1">{right}</div>}
    </div>
  );
}
