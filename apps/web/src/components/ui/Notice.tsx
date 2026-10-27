import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "./Button.tsx";
import { TONE_CLASSES, type Tone } from "./Pill.tsx";
import { Spinner } from "./Spinner.tsx";

const ICONS: Record<Tone, LucideIcon> = {
  neutral: Info,
  accent: Info,
  done: CircleCheck,
  needs: TriangleAlert,
  working: Info,
  problem: CircleAlert,
};

export interface NoticeProps {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** `alert` interrupts a screen reader; use it only for something that just went wrong. */
  role?: "alert" | "status" | "note";
  className?: string;
}

/** A tinted box with an icon and words: a warning, a failure, a tip. */
export function Notice({ tone = "neutral", title, children, action, role, className }: NoticeProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={role}
      className={cn("flex items-start gap-3 rounded-field px-4 py-3 text-sub", TONE_CLASSES[tone], className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-[1.15em] shrink-0" />
      <div className="min-w-0 flex-1 text-ink">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "text-ink-2")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** "Loading your tasks…", centred, with a spinner. Announced politely. */
export function Loading({ children = "Loading…", className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex items-center justify-center gap-2 py-10 text-ink-2 text-sub", className)}
    >
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

/** A failed load, with the server's own sentence and a way to try again. */
export function ErrorNotice({
  title,
  error,
  onRetry,
  className,
}: {
  title: ReactNode;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message =
    error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong. Try again.";
  return (
    <Notice
      tone="problem"
      role="alert"
      title={title}
      className={className}
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}
