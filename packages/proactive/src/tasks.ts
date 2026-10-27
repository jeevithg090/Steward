import type { Db } from "@steward/db";
import type { Approval, ApprovalStatus, EventBus, Task, TaskState, TaskStore } from "@steward/shared";
import { newId } from "@steward/shared";
import { ProactiveError, requireText } from "./errors.ts";

export const TASK_STATES: readonly TaskState[] = [
  "needs_you",
  "suggested",
  "working",
  "ready_for_review",
  "needs_input",
  "resolved",
  "failed",
  "hidden",
];

const TASK_SOURCES: readonly Task["source"][] = [
  "triage",
  "suggestion",
  "chat",
  "routine",
  "approval",
  "person",
];

/** Where a new task starts when the caller does not say. */
const DEFAULT_STATE: Record<Task["source"], TaskState> = {
  triage: "needs_you",
  approval: "needs_you",
  suggestion: "suggested",
  person: "suggested",
  chat: "working",
  routine: "working",
};

const TITLE_MAX = 200;
const DETAIL_MAX = 2000;
const NEXT_STEP_MAX = 400;
const ERROR_MAX = 400;

interface TaskRow {
  id: string;
  title: string;
  detail: string;
  state: string;
  source: string;
  thread_id: string | null;
  approval_id: string | null;
  email_id: string | null;
  next_step: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskStoreOptions {
  db: Db;
  bus?: EventBus;
  now: () => Date;
  /** The gateway's approvals, when wired. Without it the store falls back to what the bus told it. */
  approvals?: { get(id: string): Pick<Approval, "status"> | undefined };
}

function isTaskState(value: unknown): value is TaskState {
  return typeof value === "string" && (TASK_STATES as readonly string[]).includes(value);
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Tasks: the work Steward suggests, does or waits on.
 *
 * THE ONE DERIVED RULE. The stored `state` is what was last set. When a task is linked to an
 * approval that is still pending, every read reports it as `needs_you`, whatever was stored, because
 * the work cannot move until the person answers. Once the approval is decided the stored state
 * shows again. Deriving it on read (OpenDuet's lesson) means an expired or answered approval can
 * never leave a task stuck on "needs you". Hidden tasks stay hidden: the approval itself still
 * reaches the person through the approvals list.
 *
 * Links are made from the bus: when the gateway announces an approval in a task's conversation,
 * the task is linked to it and `task.updated` fires, and again when the approval is decided.
 */
export function createTaskStore(opts: TaskStoreOptions): TaskStore {
  const { db, bus, now } = opts;
  /** What the bus has said about approvals, used when no approval store is wired. */
  const heard = new Map<string, ApprovalStatus>();

  function approvalStatus(id: string): ApprovalStatus | undefined {
    return opts.approvals?.get(id)?.status ?? heard.get(id);
  }

  function effectiveState(row: TaskRow): TaskState {
    const stored = isTaskState(row.state) ? row.state : "failed";
    if (stored === "hidden" || !row.approval_id) return stored;
    return approvalStatus(row.approval_id) === "pending" ? "needs_you" : stored;
  }

  function toTask(row: TaskRow): Task {
    return {
      id: row.id,
      title: row.title,
      detail: row.detail,
      state: effectiveState(row),
      source: row.source as Task["source"],
      ...(row.thread_id ? { threadId: row.thread_id } : {}),
      ...(row.approval_id ? { approvalId: row.approval_id } : {}),
      ...(row.email_id ? { emailId: row.email_id } : {}),
      ...(row.next_step ? { nextStep: row.next_step } : {}),
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function row(id: string): TaskRow | undefined {
    return db.get<TaskRow>("SELECT * FROM proactive_tasks WHERE id = ?", [id]);
  }

  function emit(taskId: string): void {
    bus?.emit({ type: "task.updated", taskId });
  }

  function allRows(): TaskRow[] {
    return db.all<TaskRow>("SELECT * FROM proactive_tasks ORDER BY updated_at DESC, rowid DESC");
  }

  const store: TaskStore = {
    /** Newest change first. Hidden tasks are left out unless the filter asks for them. */
    list(filter = {}) {
      const wanted =
        filter.state === undefined
          ? TASK_STATES.filter((state) => state !== "hidden")
          : Array.isArray(filter.state)
            ? filter.state
            : [filter.state];
      const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 500), 1), 5000);
      const out: Task[] = [];
      for (const r of allRows()) {
        const task = toTask(r);
        if (!wanted.includes(task.state)) continue;
        out.push(task);
        if (out.length >= limit) break;
      }
      return out;
    },

    counts() {
      const counts = Object.fromEntries(TASK_STATES.map((state) => [state, 0])) as Record<TaskState, number>;
      for (const r of allRows()) counts[effectiveState(r)] += 1;
      return counts;
    },

    get(id) {
      const r = row(id);
      return r ? toTask(r) : undefined;
    },

    create(input) {
      const title = requireText(
        input.title,
        TITLE_MAX,
        "A task needs a title.",
        "Keep the title under 200 characters.",
      );
      const detail = typeof input.detail === "string" ? input.detail.trim().slice(0, DETAIL_MAX) : "";
      if (!TASK_SOURCES.includes(input.source)) {
        throw new ProactiveError("invalid", "That is not a task source Steward knows.");
      }
      if (input.state !== undefined && !isTaskState(input.state)) {
        throw new ProactiveError("invalid", "That is not a task state Steward knows.");
      }
      const state = input.state ?? DEFAULT_STATE[input.source];
      const at = now().toISOString();
      const id = newId("tsk");
      db.run(
        `INSERT INTO proactive_tasks
           (id, title, detail, state, source, thread_id, approval_id, email_id, next_step, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          id,
          title,
          detail,
          state,
          input.source,
          optionalText(input.threadId, 200),
          optionalText(input.approvalId, 200),
          optionalText(input.emailId, 200),
          optionalText(input.nextStep, NEXT_STEP_MAX),
          at,
          at,
        ],
      );
      emit(id);
      return toTask(row(id)!);
    },

    /**
     * Changes what the patch names. Title, detail and state ignore `undefined`; for the optional
     * fields (thread, approval, next step, error) a key present with `undefined` clears the field.
     */
    update(id, patch) {
      const current = row(id);
      if (!current) throw new ProactiveError("not_found", "Couldn't find that task.");
      const next: TaskRow = { ...current };
      if (patch.title !== undefined) {
        next.title = requireText(
          patch.title,
          TITLE_MAX,
          "A task needs a title.",
          "Keep the title under 200 characters.",
        );
      }
      if (patch.detail !== undefined) {
        next.detail = typeof patch.detail === "string" ? patch.detail.trim().slice(0, DETAIL_MAX) : "";
      }
      if (patch.state !== undefined) {
        if (!isTaskState(patch.state))
          throw new ProactiveError("invalid", "That is not a task state Steward knows.");
        next.state = patch.state;
      }
      if ("threadId" in patch) next.thread_id = optionalText(patch.threadId, 200);
      if ("approvalId" in patch) next.approval_id = optionalText(patch.approvalId, 200);
      if ("nextStep" in patch) next.next_step = optionalText(patch.nextStep, NEXT_STEP_MAX);
      if ("error" in patch) next.error = optionalText(patch.error, ERROR_MAX);
      next.updated_at = now().toISOString();
      db.run(
        `UPDATE proactive_tasks SET title = ?, detail = ?, state = ?, thread_id = ?, approval_id = ?,
           next_step = ?, error = ?, updated_at = ? WHERE id = ?`,
        [
          next.title,
          next.detail,
          next.state,
          next.thread_id,
          next.approval_id,
          next.next_step,
          next.error,
          next.updated_at,
          id,
        ],
      );
      emit(id);
      return toTask(next);
    },

    byThread(threadId) {
      const r = db.get<TaskRow>(
        "SELECT * FROM proactive_tasks WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1",
        [threadId],
      );
      return r ? toTask(r) : undefined;
    },
  };

  bus?.subscribe((event) => {
    if (event.type !== "approval.created" && event.type !== "approval.decided") return;
    const approval = event.approval;
    heard.set(approval.id, approval.status);
    if (heard.size > 5000) heard.delete(heard.keys().next().value as string);
    if (event.type === "approval.created") {
      const task = store.byThread(approval.threadId);
      if (task && task.approvalId !== approval.id) store.update(task.id, { approvalId: approval.id });
      else if (task) emit(task.id);
      return;
    }
    const linked = db.all<{ id: string }>("SELECT id FROM proactive_tasks WHERE approval_id = ?", [
      approval.id,
    ]);
    for (const { id } of linked) emit(id);
  });

  return store;
}
