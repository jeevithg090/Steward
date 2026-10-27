import { CircleAlert, CircleCheck, CircleX, Clock, type LucideIcon, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels.ts";
import { cn } from "@/lib/utils.ts";

export type { Tone };

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-tile text-ink-2",
  accent: "bg-accent-soft text-accent",
  done: "bg-done-soft text-done",
  needs: "bg-needs-soft text-needs",
  working: "bg-working-soft text-working",
  problem: "bg-problem-soft text-problem",
};

const DEFAULT_ICONS: Partial<Record<Tone, LucideIcon>> = {
  accent: Sparkles,
  done: CircleCheck,
  needs: CircleAlert,
  working: Clock,
  problem: CircleX,
};

export interface PillProps {
  tone?: Tone;
  /** Overrides the tone's icon; `null` draws none. Colour never carries meaning alone: a word always does. */
  icon?: LucideIcon | null;
  children: ReactNode;
  className?: string;
}

/** A status word on a soft tone, with an icon, so status never depends on colour alone. */
export function Pill({ tone = "neutral", icon, children, className }: PillProps) {
  const Icon = icon === null ? undefined : (icon ?? DEFAULT_ICONS[tone]);
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold text-caption",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-[1.05em] shrink-0" /> : null}
      {children}
    </span>
  );
}
