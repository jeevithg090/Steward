import {
  newId,
  ROUTES,
  TaskPatchBody,
  TaskStartBody,
  type TaskState,
  type TasksResponse,
} from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { asUserError, HttpError, notFound, readBody } from "../http/errors.ts";
import { taskStart } from "../runtime/frames.ts";

const STATES: readonly TaskState[] = [
  "needs_you",
  "suggested",
  "working",
  "ready_for_review",
  "needs_input",
  "resolved",
  "failed",
  "hidden",
];

/** Start: hands a task to Steward in a conversation of its own. The web app and the phone app share it. */
export function startTask(s: StewardServices, id: string, note?: string) {
  const { tasks } = s.proactive;
  const task = tasks.get(id);
  if (!task) throw notFound("that task");
  if (task.threadId && s.runner.isThreadBusy(task.threadId)) {
    throw new HttpError(409, "Steward is already working on that task.");
  }
  const threadId = task.threadId ?? newId("thr");
  const agentId = s.threads.getMeta(threadId)?.agentId ?? s.defaultAgentId;
  s.threads.upsertMeta({ id: threadId, agentId, kind: "task", title: task.title });
  tasks.update(id, { state: "working", threadId });
  try {
    s.runs.start({
      agentId,
      threadId,
      userText: taskStart(task, note),
      initiator: { kind: "task", id: task.id },
    });
  } catch (err) {
    tasks.update(id, { state: task.state });
    throw err;
  }
  return { task: tasks.get(id) ?? task, threadId };
}

/** `/api/tasks`: the Tasks page, and Start, which hands a task to Steward in a conversation of its own. */
export function registerTaskRoutes(app: Hono, s: StewardServices): void {
  const { tasks } = s.proactive;

  app.get(ROUTES.tasks, (c) => {
    const raw = c.req.query("state");
    let state: TaskState[] | undefined;
    if (raw) {
      state = raw.split(",").map((v) => v.trim()) as TaskState[];
      if (state.some((v) => !STATES.includes(v))) {
        throw new HttpError(400, `state must be one or more of: ${STATES.join(", ")}.`);
      }
    }
    const body: TasksResponse = {
      tasks: tasks.list(state ? { state: state.length === 1 ? state[0]! : state } : {}),
      counts: tasks.counts(),
    };
    return c.json(body);
  });

  app.patch(ROUTES.task, async (c) => {
    const id = c.req.param("id");
    const body = await readBody(c, TaskPatchBody);
    if (!tasks.get(id)) throw notFound("that task");
    try {
      return c.json(tasks.update(id, body));
    } catch (err) {
      asUserError(err);
    }
  });

  app.post(ROUTES.taskStart, async (c) => {
    const body = await readBody(c, TaskStartBody);
    return c.json(startTask(s, c.req.param("id"), body.note));
  });
}
