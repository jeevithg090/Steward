import type { ReactNode } from "react";

/** The theme's small uppercase label above a group, with an optional right-hand slot. */
export function SectionTitle({ children, id, right, as = "h2", className = "" }: { children: ReactNode; id?: string; right?: ReactNode; as?: "h2" | "h3" | "p"; className?: string }) {
  const Tag = as;
  return (
    <div className={`mb-2 flex items-center justify-between gap-3 ${className}`}>
      <Tag id={id} className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {children}
      </Tag>
      {right}
    </div>
  );
}

/** The one page heading every page has. */
export function PageTitle({ children, lede, right }: { children: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{children}</h1>
        {lede && <p className="mt-1 max-w-2xl text-sm text-slate-400">{lede}</p>}
      </div>
      {right}
    </header>
  );
}
