import type { Task } from "@steward/shared";
import { ArrowRight, CircleX, EyeOff, Inbox, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { TASK_STATES } from "@/lib/labels.ts";
import { cn, relativeTime } from "@/lib/utils.ts";

const SOURCE_LABELS: Record<Task["source"], string> = {
  triage: "From your inbox",
  suggestion: "Suggested by Steward",
  chat: "You asked",
  routine: "From a routine",
  approval: "Waiting on an answer",
  person: "You added it",
};

export interface TaskCardProps {
  task: Task;
  /** Buttons for this task (Start, Hide, Mark done…). The Tasks page supplies them. */
  actions?: ReactNode;
  /** Drawn under the task, e.g. the approval it waits on. */
  children?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** One piece of work: where it stands (a pill with an icon and words), what it is, what comes next. */
export function TaskCard({ task, actions, children, headingLevel = 3, className }: TaskCardProps) {
  const state = TASK_STATES[task.state];
  const Heading = `h${headingLevel}` as const;
  const icon = task.state === "needs_input" ? Inbox : task.state === "hidden" ? EyeOff : undefined;
  return (
    <Card as="article" className={cn("flex flex-col gap-2", className)} aria-label={task.title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill tone={state.tone} icon={icon}>
          {state.label}
        </Pill>
        <span className="text-caption text-ink-2">{SOURCE_LABELS[task.source] ?? task.source}</span>
        <span className="text-caption text-ink-3">
          · Updated <time dateTime={task.updatedAt}>{relativeTime(task.updatedAt)}</time>
        </span>
      </div>
      <Heading className="font-semibold text-body text-ink">{task.title}</Heading>
      {task.detail ? <p className="measure text-ink-2 text-sub">{task.detail}</p> : null}
      {task.state === "failed" && task.error ? (
        <p className="flex items-start gap-2 text-problem text-sub">
          <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>Couldn't finish: {task.error}</span>
        </p>
      ) : null}
      {task.nextStep && task.state !== "resolved" ? (
        <p className="flex items-start gap-2 text-ink text-sub">
          <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-2" />
          <span>
            <span className="font-medium">Next: </span>
            {task.nextStep}
          </span>
        </p>
      ) : null}
      {children}
      {actions || task.threadId ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {actions}
          {task.threadId ? (
            <Link
              to={`/chat/${encodeURIComponent(task.threadId)}`}
              className="inline-flex min-h-target items-center gap-1.5 px-1 text-accent text-sub underline underline-offset-4"
            >
              <MessageSquare aria-hidden="true" className="size-4" />
              Open the conversation<span className="sr-only">: {task.title}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
