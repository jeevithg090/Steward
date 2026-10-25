import type { ReactNode } from "react";

export type BadgeTone = "indigo" | "emerald" | "rose" | "amber" | "purple" | "slate" | "gold";

const TONES: Record<BadgeTone, string> = {
  indigo: "bg-accent-500/[0.14] text-accent-200 ring-accent-400/25",
  emerald: "bg-emerald-500/[0.13] text-emerald-200 ring-emerald-400/25",
  rose: "bg-rose-500/[0.14] text-rose-200 ring-rose-400/25",
  amber: "bg-amber-500/[0.14] text-amber-200 ring-amber-400/25",
  purple: "bg-second-500/[0.13] text-second-200 ring-second-400/25",
  slate: "bg-white/[0.07] text-slate-300 ring-white/10",
  gold: "bg-gold-400/[0.14] text-gold-200 ring-gold-400/30",
};

const DOTS: Record<BadgeTone, string> = {
  indigo: "bg-accent-300", emerald: "bg-emerald-300", rose: "bg-rose-300", amber: "bg-amber-300",
  purple: "bg-second-300", slate: "bg-slate-400", gold: "bg-gold-300",
};

/** A small status pill: state, zone, honesty label. `dot` adds a status light in front. */
export function Badge({ tone = "slate", children, title, className = "", dot = false }: { tone?: BadgeTone; children: ReactNode; title?: string; className?: string; dot?: boolean }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.01em] ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} />}
      {children}
    </span>
  );
}
