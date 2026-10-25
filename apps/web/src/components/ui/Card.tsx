import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** `tight` for list rows, `default` for panels. */
  padding?: "tight" | "default" | "none";
  /** Render as a landmark section (with aria-labelledby) rather than a div. */
  as?: "div" | "section" | "article" | "li";
  tone?: "default" | "indigo" | "emerald" | "rose" | "amber" | "gold";
  /** Lifts and glows on hover, for cards that are themselves a link or button. */
  interactive?: boolean;
}

const TONES: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "surface",
  indigo: "border border-violet-400/25 bg-gradient-to-b from-violet-500/[0.12] to-violet-500/[0.03] shadow-glass",
  emerald: "border border-emerald-400/25 bg-gradient-to-b from-emerald-500/[0.1] to-emerald-500/[0.02] shadow-glass",
  rose: "border border-rose-400/25 bg-gradient-to-b from-rose-500/[0.1] to-rose-500/[0.02] shadow-glass",
  amber: "border border-amber-400/25 bg-gradient-to-b from-amber-500/[0.1] to-amber-500/[0.02] shadow-glass",
  gold: "border border-gold-400/30 bg-gradient-to-b from-gold-400/[0.12] to-gold-400/[0.02] shadow-glass",
};

/** The theme's panel (plan.md §15.1): a glass surface with a hairline border. */
export function Card({ children, padding = "default", as = "div", tone = "default", interactive = false, className = "", ...rest }: CardProps) {
  const Tag = as;
  const pad = padding === "none" ? "" : padding === "tight" ? "px-4 py-3" : "p-5 lg:p-6";
  const lift = interactive
    ? "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    : "";
  return (
    <Tag className={`rounded-3xl ${TONES[tone]} ${pad} ${lift} text-slate-200 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
