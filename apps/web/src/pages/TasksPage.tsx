import type { Approval, Task, TaskState } from "@steward/shared";
import { CheckCheck, EyeOff, Inbox, ListChecks, Play, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ApprovalCard } from "@/components/cards/ApprovalCard.tsx";
import { TaskCard } from "@/components/cards/TaskCard.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { type TabItem, Tabs } from "@/components/ui/Tabs.tsx";
import { needsYouCount, useApprovals, usePatchTask, useStartTask, useTasks } from "@/lib/api.ts";

export type TaskView =
  | "needs_you"
  | "suggested"
  | "working"
  | "ready_for_review"
  | "needs_input"
  | "resolved";

const VIEWS: { value: TaskView; label: string; empty: { title: string; body: string } }[] = [
  {
    value: "needs_you",
    label: "Needs you",
    empty: {
      title: "Nothing needs you right now",
      body: "When Steward needs an answer or a decision, it shows up here.",
    },
  },
  {
    value: "suggested",
    label: "Suggested",
    empty: {
      title: "No suggestions right now",
      body: "Steward suggests work it finds in your mail and calendar. Start one, or hide it.",
    },
  },
  {
    value: "working",
    label: "Working",
    empty: {
      title: "Steward isn't working on anything",
      body: "Start a task and it shows up here while it runs.",
    },
  },
  {
    value: "ready_for_review",
    label: "Ready for review",
    empty: { title: "Nothing to review", body: "Finished work waits here until you mark it done." },
  },
  {
    value: "needs_input",
    label: "Needs input",
    empty: {
      title: "Nothing is waiting for your input",
      body: "When a task needs more from you, it shows up here.",
    },
  },
  {
    value: "resolved",
    label: "Resolved",
    empty: { title: "Nothing resolved yet", body: "Work you mark done is kept here." },
  },
];

/** Which task states each view lists. Tasks that could not finish need the person, so they sit in Needs you. */
const VIEW_STATES: Record<TaskView, TaskState[]> = {
  needs_you: ["needs_you", "failed"],
  suggested: ["suggested"],
  working: ["working"],
  ready_for_review: ["ready_for_review"],
  needs_input: ["needs_input"],
  resolved: ["resolved"],
};

function isView(value: string | null): value is TaskView {
  return VIEWS.some((v) => v.value === value);
}

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view: TaskView = isView(params.get("view")) ? (params.get("view") as TaskView) : "needs_you";
  const tasks = useTasks();
  const pending = useApprovals("pending");

  const all = tasks.data?.tasks ?? [];
  const pendingApprovals = (pending.data ?? []).filter((a) => a.status === "pending");
  const approvalById = new Map(pendingApprovals.map((a) => [a.id, a]));
  const linked = new Set(all.map((t) => t.approvalId).filter(Boolean));
  const looseApprovals = pendingApprovals.filter((a) => !linked.has(a.id));

  const countFor = (v: TaskView): number => {
    if (v === "needs_you") return needsYouCount(tasks.data, pending.data);
    const counts = tasks.data?.counts;
    return VIEW_STATES[v].reduce(
      (sum, state) => sum + (counts?.[state] ?? all.filter((t) => t.state === state).length),
      0,
    );
  };

  const items: TabItem<TaskView>[] = VIEWS.map((v) => ({
    value: v.value,
    label: v.label,
    count: tasks.data ? countFor(v.value) : undefined,
  }));

  const current = VIEWS.find((v) => v.value === view)!;
  const shown = all
    .filter((t) => VIEW_STATES[view].includes(t.state))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  let body: ReactNode;
  if (tasks.isPending) body = <Loading>Loading your tasks…</Loading>;
  else if (tasks.isError)
    body = (
      <ErrorNotice
        title="Couldn't load your tasks"
        error={tasks.error}
        onRetry={() => void tasks.refetch()}
      />
    );
  else {
    const loose = view === "needs_you" ? looseApprovals : [];
    body =
      shown.length === 0 && loose.length === 0 ? (
        <EmptyState icon={view === "needs_you" ? Inbox : ListChecks} title={current.empty.title}>
          {current.empty.body}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {loose.map((approval) => (
            <li key={approval.id}>
              <ApprovalCard approvalId={approval.id} initial={approval} />
            </li>
          ))}
          {shown.map((task) => (
            <li key={task.id}>
              <TaskRow
                task={task}
                approval={task.approvalId ? approvalById.get(task.approvalId) : undefined}
              />
            </li>
          ))}
        </ul>
      );
  }

  return (
    <Page
      title="Tasks"
      description="Work Steward is doing, could do, or has finished. Anything that needs your answer comes first."
    >
      <Tabs
        label="Task status"
        items={items}
        value={view}
        onValueChange={(next) => setParams(next === "needs_you" ? {} : { view: next }, { replace: true })}
      >
        {body}
      </Tabs>
    </Page>
  );
}

/** A task with the buttons that make sense for where it stands. */
function TaskRow({ task, approval }: { task: Task; approval?: Approval }) {
  const navigate = useNavigate();
  const start = useStartTask();
  const patch = usePatchTask();

  const startIt = (label: string) => (
    <Button
      variant="primary"
      icon={<Play />}
      loading={start.isPending}
      onClick={() =>
        start.mutate(
          { id: task.id },
          {
            onSuccess: ({ threadId }) => {
              toast.success("Started", { description: task.title });
              navigate(`/chat/${encodeURIComponent(threadId)}`);
            },
            onError: (error) => toast.error("Couldn't start it", { description: error.message }),
          },
        )
      }
    >
      {label}
    </Button>
  );

  const setState = (state: TaskState, label: string, icon: ReactNode, done: string) => (
    <Button
      icon={icon}
      loading={patch.isPending && patch.variables?.state === state}
      disabled={patch.isPending}
      onClick={() =>
        patch.mutate(
          { id: task.id, state },
          {
            onSuccess: () => toast.success(done, { description: task.title }),
            onError: (error) => toast.error("That didn't work", { description: error.message }),
          },
        )
      }
    >
      {label}
    </Button>
  );

  const hide = setState("hidden", "Hide", <EyeOff />, "Hidden. It won't come back.");
  const markDone = setState("resolved", "Mark done", <CheckCheck />, "Marked done");
  const reopen = setState(
    task.threadId ? "ready_for_review" : "suggested",
    "Reopen",
    <RotateCcw />,
    "Reopened",
  );

  let actions: ReactNode;
  switch (task.state) {
    case "suggested":
      actions = (
        <>
          {startIt("Start")}
          {hide}
        </>
      );
      break;
    case "needs_you":
      actions = (
        <>
          {task.threadId ? null : startIt("Start")}
          {markDone}
          {hide}
        </>
      );
      break;
    case "failed":
      actions = (
        <>
          {startIt("Try again")}
          {hide}
        </>
      );
      break;
    case "ready_for_review":
      actions = markDone;
      break;
    case "needs_input":
      actions = task.threadId ? null : startIt("Start");
      break;
    case "resolved":
      actions = reopen;
      break;
    default:
      actions = null;
  }

  return (
    <TaskCard task={task} actions={actions}>
      {approval ? (
        <ApprovalCard approvalId={approval.id} initial={approval} headingLevel={4} className="mt-2" />
      ) : null}
    </TaskCard>
  );
}
