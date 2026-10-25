import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-violet-500/30 to-violet-600/20 px-3 py-1 text-xs font-medium text-violet-50 ring-1 ring-inset ring-violet-300/25">
      {children}
    </span>
  );
}
