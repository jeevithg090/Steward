import type { ReactNode } from "react";
import { navFor } from "@/components/layout/nav";
import { section, useRoute } from "@/router";

/** The theme's small uppercase label above a group, with an optional right-hand slot. */
export function SectionTitle({ children, id, right, as = "h2", className = "" }: { children: ReactNode; id?: string; right?: ReactNode; as?: "h2" | "h3" | "p"; className?: string }) {
  const Tag = as;
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <Tag id={id} className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {children}
      </Tag>
      {right}
    </div>
  );
}

/** The one page heading every page has: the page's icon, its name in the display face, a lede. */
export function PageTitle({ children, lede, right }: { children: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  const entry = navFor(section(useRoute().path));
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 motion-safe:animate-fade-up">
      <div className="flex min-w-0 items-start gap-4">
        {entry && (
          <span
            aria-hidden
            className="mt-1 hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-accent-500/25 to-accent-700/10 text-accent-100 ring-1 ring-inset ring-accent-300/25 shadow-[0_12px_30px_-14px_rgb(var(--accent-600)/0.9)] sm:grid"
          >
            <entry.Icon size={22} strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-[2.35rem] leading-[1.05] text-white sm:text-5xl">{children}</h1>
          {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-400">{lede}</p>}
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}
