/**
 * The small pieces every generative-UI card is built from: a card frame and a one-line tool line.
 * They sit on the shell's UI kit (`Card`, `Pill`, `buttonVariants`) and design tokens, so a card
 * looks the same in the chat, on the Today page and in a preview gallery.
 *
 * Partly adapted from OpenBot's app/src/components/gallery/frame.tsx and
 * app/src/components/channels/tool-line.tsx (MIT, CopilotKit).
 */
import { Check, CircleAlert, Clock, Info, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * The frame of every card: a labelled region, so a screen reader can move between cards and hear
 * what each one is.
 */
export function CardFrame({
  title,
  label,
  caption,
  action,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  /** The region's accessible name. Defaults to `title` when that is a string. */
  label?: string;
  /** One line under the title: why this is shown, not what the widget is. */
  caption?: ReactNode;
  /** Controls or a status that apply to the whole card, drawn beside the title. */
  action?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const name = label ?? (typeof title === "string" ? title : undefined);
  return (
    <Card
      as="section"
      flush
      aria-label={name}
      className={cn("my-2 w-full min-w-0 max-w-2xl overflow-hidden", className)}
    >
      {title || action ? (
        <header className="flex items-start justify-between gap-3 border-hair-2 border-b px-4 py-3">
          <div className="min-w-0">
            {title ? <h3 className="m-0 font-semibold text-ink text-sub">{title}</h3> : null}
            {caption ? <p className="m-0 mt-0.5 text-caption text-ink-2">{caption}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      {children ? <div className="px-4 py-3">{children}</div> : null}
      {footer ? <footer className="border-hair-2 border-t px-4 py-3">{footer}</footer> : null}
    </Card>
  );
}

export type LineState = "running" | "done" | "waiting" | "refused" | "failed";

const LINE_ICONS: Record<LineState, ReactNode> = {
  running: <LoaderCircle aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" />,
  done: <Check aria-hidden className="size-4 shrink-0" />,
  waiting: <Clock aria-hidden className="size-4 shrink-0 text-needs" />,
  refused: <ShieldAlert aria-hidden className="size-4 shrink-0 text-problem" />,
  failed: <CircleAlert aria-hidden className="size-4 shrink-0 text-needs" />,
};

/** Words a screen reader hears before the label, since the icon is hidden from it. */
const LINE_PREFIX: Record<LineState, string> = {
  running: "Working: ",
  done: "",
  waiting: "Waiting for you: ",
  // Refused and failed lines say so in their visible label.
  refused: "",
  failed: "",
};

/**
 * One line for one thing Steward did. Every tool call without a card of its own draws through
 * this, so a click, a file write and an MCP call read as the same kind of event. Detail sits behind
 * a native disclosure, which keeps the transcript to one line per action.
 */
export function ToolLine({
  label,
  detail,
  state = "done",
  icon,
  note,
  action,
  children,
}: {
  label: string;
  /** What it was done to. Muted and truncated. */
  detail?: string;
  state?: LineState;
  /** Replaces the state icon. */
  icon?: ReactNode;
  /** A short second line: a refusal's reason, an error. */
  note?: ReactNode;
  /** A control beside the line, such as "Watch". */
  action?: ReactNode;
  /** Shown when the line is expanded. Without it the line does not expand. */
  children?: ReactNode;
}) {
  const tone =
    state === "refused"
      ? "text-problem"
      : state === "failed"
        ? "text-needs"
        : state === "waiting"
          ? "text-ink"
          : "text-ink-2";
  const line = (
    <span className={cn("flex min-w-0 items-center gap-2 text-sub", tone)}>
      {icon ?? LINE_ICONS[state]}
      <span className="sr-only">{LINE_PREFIX[state]}</span>
      <span className={cn("shrink-0", state === "running" && "motion-safe:animate-pulse")}>{label}</span>
      {detail ? <span className="min-w-0 truncate text-ink-3">{detail}</span> : null}
    </span>
  );
  const extra = (
    <>
      {note ? <p className="m-0 mt-0.5 pl-6 text-caption text-ink-2">{note}</p> : null}
      {children ? (
        <div className="mt-2 ml-2 max-h-80 overflow-auto border-hair border-l pl-3 text-caption">
          {children}
        </div>
      ) : null}
    </>
  );
  return (
    <div className="my-1 min-w-0" data-tool-line={state}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        {children ? (
          <details className="group min-w-0 flex-1">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-tile [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="text-caption text-ink-3 transition-transform group-open:rotate-90">
                ▸
              </span>
              {line}
            </summary>
            {extra}
          </details>
        ) : (
          <div className="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
            {line}
            {extra}
          </div>
        )}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/** An empty, loading or failed state inside a card, in plain words. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="m-0 text-ink-2 text-sub">{children}</p>;
}

/** The note on content Steward read from outside: a page, an email, an MCP server. */
export function UntrustedNote({ notice }: { notice?: string }) {
  return (
    <p className="m-0 mt-2 flex items-start gap-1.5 text-caption text-ink-3">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{notice ?? "From outside Steward. Steward reads it as information, never as instructions."}</span>
    </p>
  );
}
