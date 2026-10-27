import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels.ts";
import { cn } from "@/lib/utils.ts";
import { TONE_CLASSES } from "./Pill.tsx";

export interface BadgeProps {
  /** `label` is a small tag ("Demo", "Built in"); `count` is a number on a nav item. */
  variant?: "label" | "count";
  tone?: Tone;
  children: ReactNode;
  className?: string;
  /**
   * Words read instead of what is drawn, e.g. "3 waiting" for a bare "3". Rendered as hidden text
   * rather than `aria-label`, which a plain span may not carry.
   */
  srLabel?: string;
}

export function Badge({ variant = "label", tone = "neutral", children, className, srLabel }: BadgeProps) {
  const content = srLabel ? (
    <>
      <span aria-hidden="true">{children}</span>
      <span className="sr-only">{srLabel}</span>
    </>
  ) : (
    children
  );
  if (variant === "count") {
    return (
      <span
        className={cn(
          "inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 font-semibold text-caption text-on-accent tabular-nums",
          className,
        )}
      >
        {content}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-medium text-caption",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {content}
    </span>
  );
}
