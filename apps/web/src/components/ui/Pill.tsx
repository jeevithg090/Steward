import type { ReactNode } from "react";

export function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-nexus-badge px-3 py-1 text-xs font-medium text-white">
      {children}
    </span>
  );
}