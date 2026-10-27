import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

/** A key on the keyboard, as in "press <Kbd>g</Kbd> then <Kbd>t</Kbd>". */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded-md bg-tile px-1.5 py-0.5 font-medium font-mono text-caption text-ink shadow-[inset_0_-1px_0_var(--st-hair)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
