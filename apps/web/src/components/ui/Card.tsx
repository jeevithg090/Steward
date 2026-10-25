import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** `tight` for list rows, `default` for panels. */
  padding?: "tight" | "default" | "none";
  /** Render as a landmark section (with aria-labelledby) rather than a div. */
  as?: "div" | "section" | "article" | "li";
  tone?: "default" | "indigo" | "emerald" | "rose" | "amber";
}

const TONES: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "border-white/10 bg-nexus-card",
  indigo: "border-indigo-500/30 bg-indigo-950/30",
  emerald: "border-emerald-500/30 bg-emerald-950/20",
  rose: "border-rose-500/30 bg-rose-950/20",
  amber: "border-amber-500/30 bg-amber-950/20",
};

/** The theme's panel: charcoal, rounded-2xl, a hairline border (plan.md §4.7). */
export function Card({ children, padding = "default", as = "div", tone = "default", className = "", ...rest }: CardProps) {
  const Tag = as;
  const pad = padding === "none" ? "" : padding === "tight" ? "px-4 py-3" : "p-4 lg:p-5";
  return (
    <Tag className={`rounded-2xl border ${TONES[tone]} ${pad} text-slate-200 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
