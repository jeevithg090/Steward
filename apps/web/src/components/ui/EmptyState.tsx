import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  /** A button or link that fills the emptiness. */
  action?: ReactNode;
  className?: string;
  /** Heading level in the page outline. */
  level?: 2 | 3;
}

/** What a list says when there is nothing in it: what would be here, and how to get some. */
export function EmptyState({ icon: Icon, title, children, action, className, level = 2 }: EmptyStateProps) {
  const Heading = `h${level}` as const;
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-card border border-hair border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-1 grid size-12 place-items-center rounded-tile bg-tile text-ink-2">
          <Icon aria-hidden="true" className="size-6" />
        </span>
      ) : null}
      <Heading className="font-semibold text-body text-ink">{title}</Heading>
      {children ? <div className="measure text-ink-2 text-sub">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
