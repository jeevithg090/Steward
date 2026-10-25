import type { ReactNode } from "react";

export type BadgeTone = "indigo" | "emerald" | "rose" | "amber" | "purple" | "slate";

const TONES: Record<BadgeTone, string> = {
  indigo: "bg-indigo-500/20 text-indigo-200",
  emerald: "bg-emerald-500/20 text-emerald-200",
  rose: "bg-rose-500/20 text-rose-200",
  amber: "bg-amber-500/20 text-amber-200",
  purple: "bg-purple-500/20 text-purple-200",
  slate: "bg-white/10 text-slate-300",
};

/** A small status pill: state, zone, honesty label. */
export function Badge({ tone = "slate", children, title, className = "" }: { tone?: BadgeTone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
