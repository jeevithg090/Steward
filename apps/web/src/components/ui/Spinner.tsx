import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils.ts";

export interface SpinnerProps {
  /** Read to screen readers. Omit when the surrounding text already says what is loading. */
  label?: string;
  className?: string;
}

/** A turning circle. It stops turning when the person asks for less motion; the label stays. */
export function Spinner({ label, className }: SpinnerProps) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <LoaderCircle aria-hidden="true" className="size-[1.125em] animate-spin" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
