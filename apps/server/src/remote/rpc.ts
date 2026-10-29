import {
  answerMessage,
  challengeFor,
  type RemoteMethod,
  SIGNED_ANSWER_WINDOW_MS,
  type SignedAnswer,
  verifyAssertion,
  verifyText,
} from "@steward/remote";
import type { Device } from "@steward/shared";
import { z } from "zod";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import { startTask } from "../routes/tasks.ts";

/**
 * The closed list of what the phone app may ask (docs/plans/phone-and-shortcuts.md §5.3), each one
 * answered by the same handlers the device API uses, through the gateway. Never rules, settings,
 * connections, secrets, the shell or the computer.
 */

/** The phone's keys, as stored at pairing. */
export interface RemoteKeys {
  box: string;
  sign: string;
  webauthn?: { id: string; publicKey: string };
}

export function keysOf(publicKey: string | undefined): RemoteKeys | undefined {
  try {
    const parsed = JSON.parse(publicKey ?? "") as RemoteKeys;
    return typeof parsed.box === "string" && typeof parsed.sign === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const Answer = z.object({
  approvalId: z.string().min(1).max(64),
  answer: z.enum(["once", "refuse"]),
  nonce: z.string().min(16).max(64),
  ts: z.number().int(),
  sig: z.string().min(16).max(200),
  webauthn: z
    .object({
      authenticatorData: z.string().max(2048),
      clientDataJSON: z.string().max(4096),
      signature: z.string().max(512),
    })
    .optional(),
});

const Chat = z.object({ text: z.string().trim().min(1).max(4000), threadId: z.string().max(128).optional() });
const TaskId = z.object({ taskId: z.string().min(1).max(64), note: z.string().max(2000).optional() });
const RoutineId = z.object({ routineId: z.string().min(1).max(64) });
const ThreadId = z.object({ threadId: z.string().min(1).max(128) });

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "That request could not be read.");
  return parsed.data;
}

export interface RpcContext {
  s: StewardServices;
  device: Device;
  keys: RemoteKeys;
  /** The relay's origin and host: WebAuthn's origin and relying party. */
  relayOrigin: string;
  /** Starts sealing a thread's live events to this phone. */
  follow(threadId: string): (event: unknown) => void;
  now?: () => number;
}

/**
 * Checks a signed answer: the device's own key signed exactly this answer, recently, with a nonce
 * never used before. Face ID (WebAuthn) is credited only when its assertion is for this answer.
 */
export async function checkSignedAnswer(
  ctx: RpcContext,
  answer: SignedAnswer,
): Promise<"webauthn" | undefined> {
  const now = ctx.now?.() ?? Date.now();
  const message = answerMessage(ctx.device.id, answer);
  if (!(await verifyText(ctx.keys.sign, message, answer.sig))) {
    ctx.s.devices.record("device.refused", ctx.device, { reason: "answer signature did not verify" });
    throw new HttpError(403, "That answer wasn't signed by this phone.");
  }
  if (Math.abs(now - answer.ts) > SIGNED_ANSWER_WINDOW_MS) {
    throw new HttpError(403, "That answer is too old. Answer again.");
  }
  if (!ctx.s.devices.useNonce(ctx.device.id, answer.nonce)) {
    ctx.s.devices.record("device.refused", ctx.device, {
      reason: "answer replayed",
      approvalId: answer.approvalId,
    });
    throw new HttpError(403, "That answer was already used.");
  }
  if (!answer.webauthn || !ctx.keys.webauthn) return undefined;
  const relay = new URL(ctx.relayOrigin);
  const verified = await verifyAssertion({
    publicKey: ctx.keys.webauthn.publicKey,
    rpId: relay.hostname,
    origin: relay.origin,
    challenge: await challengeFor(message),
    ...answer.webauthn,
  });
  return verified ? "webauthn" : undefined;
}

export async function handleRpc(ctx: RpcContext, method: RemoteMethod, params: unknown): Promise<unknown> {
  const { s, device } = ctx;
  const api = s.deviceApi;
  switch (method) {
    case "brief.get": {
      const brief = api.brief(device);
      const approvals = device.scopes.includes("approvals:read") ? api.approvals(device).items : [];
      const tasks = device.scopes.includes("tasks")
        ? s.proactive.tasks
            .list({ state: ["needs_you", "working", "ready_for_review", "suggested"], limit: 30 })
            .map((t) => ({
              id: t.id,
              title: t.title,
              state: t.state,
              detail: t.detail,
              threadId: t.threadId,
            }))
        : [];
      return { say: brief.say, items: brief.items, approvals, tasks };
    }
    case "approval.decide": {
      const answer = parse(Answer, params) as SignedAnswer;
      const verified = await checkSignedAnswer(ctx, answer);
      const done = api.decide(device, answer.approvalId, answer.answer, undefined, verified);
      return {
        approval: api.item(device, done.approval),
        say: done.ui[0] && "say" in done.ui[0] ? done.ui[0].say : "",
      };
    }
    case "chat.send": {
      api.need(device, "chat");
      const body = parse(Chat, params);
      let threadId = body.threadId;
      if (threadId && !s.threads.exists(threadId)) throw notFound("that conversation");
      const agentId = (threadId && s.threads.getMeta(threadId)?.agentId) || s.defaultAgentId;
      if (!threadId) {
        threadId = `thr_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
        s.threads.upsertMeta({ id: threadId, agentId, kind: "chat", title: body.text.slice(0, 80) });
      }
      const run = s.runs.start({
        agentId,
        threadId,
        userText: body.text,
        initiator: { kind: "device", id: device.id },
        onEvent: ctx.follow(threadId),
      });
      return { threadId, runId: run.runId };
    }
    case "task.start": {
      api.need(device, "tasks");
      const body = parse(TaskId, params);
      const started = startTask(s, body.taskId, body.note);
      return { taskId: started.task.id, threadId: started.threadId };
    }
    case "task.hide": {
      api.need(device, "tasks");
      const body = parse(TaskId, params);
      if (!s.proactive.tasks.get(body.taskId)) throw notFound("that task");
      s.proactive.tasks.update(body.taskId, { state: "hidden" });
      return { taskId: body.taskId };
    }
    case "routine.run": {
      api.need(device, "routines:run");
      const body = parse(RoutineId, params);
      const routine = s.proactive.routines.get(body.routineId);
      if (!routine) throw notFound("that routine");
      if (!routine.enabled) throw new HttpError(409, "That routine is paused. Turn it on first.");
      const run = s.workers.runRoutine(routine);
      return { threadId: run.threadId };
    }
    case "run.stop": {
      api.need(device, "chat");
      const body = parse(ThreadId, params);
      return { stopped: (await s.runner.stop({ threadId: body.threadId })) === true };
    }
  }
}
