import type { ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";

/** Text for screen readers only: present in the accessibility tree, invisible on screen. */
export function VisuallyHidden({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("sr-only", className)} {...props} />;
}
