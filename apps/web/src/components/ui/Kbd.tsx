import type { ReactNode } from "react";

/** A key on the keyboard, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`inline-grid h-5 min-w-5 place-items-center rounded-md border border-white/15 bg-white/[0.06] px-1 font-sans text-[10px] font-semibold text-slate-300 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset] ${className}`}>
      {children}
    </kbd>
  );
}
