import { newId, ROUTES, ThreadCreateBody, ThreadPatchBody } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound, readBody } from "../http/errors.ts";
import { registerConversationAllowRoutes } from "./conversation-allows.ts";
import { enumQuery, intQuery, textQuery } from "./query.ts";

const KINDS = ["chat", "routine", "task"] as const;

/** `/api/threads`: the conversation list, joined from the server's records and the runner's. */
export function registerThreadRoutes(app: Hono, s: StewardServices): void {
  app.get(ROUTES.threads, (c) => {
    const kind = enumQuery(c, "kind", KINDS);
    const agentId = textQuery(c, "agentId", 64);
    const limit = intQuery(c, "limit", { min: 1, max: 500 });
    return c.json(
      s.threads.list({
        ...(kind ? { kind } : {}),
        ...(agentId ? { agentId } : {}),
        ...(limit ? { limit } : {}),
      }),
    );
  });

  app.post(ROUTES.threads, async (c) => {
    const body = await readBody(c, ThreadCreateBody);
    const agentId = body.agentId ?? s.defaultAgentId;
    if (!s.hasAgent(agentId)) throw new HttpError(400, "Choose one of your agents.");
    const id = newId("thr");
    s.threads.upsertMeta({ id, agentId, kind: "chat", title: body.title?.trim() ?? "" });
    return c.json(s.threads.summary(id), 201);
  });

  app.get(ROUTES.thread, (c) => {
    const summary = s.threads.summary(c.req.param("id"));
    if (!summary) throw notFound("that conversation");
    return c.json(summary);
  });

  // Renames a conversation. A thread the runner knows but the server has no row for gets one.
  app.patch(ROUTES.thread, async (c) => {
    const id = c.req.param("id");
    const summary = s.threads.summary(id);
    if (!summary) throw notFound("that conversation");
    const body = await readBody(c, ThreadPatchBody);
    s.threads.upsertMeta({ id, agentId: summary.agentId, title: body.title });
    return c.json(s.threads.summary(id));
  });

  app.delete(ROUTES.thread, async (c) => {
    const id = c.req.param("id");
    if (!s.threads.exists(id)) throw notFound("that conversation");
    if (s.runner.isThreadBusy(id)) {
      await s.runner.stop({ threadId: id });
      await Promise.race([s.runner.whenIdle(id), new Promise((r) => setTimeout(r, 5_000))]);
      if (s.runner.isThreadBusy(id))
        throw new HttpError(409, "That conversation is still stopping. Try again in a moment.");
    }
    s.runner.deleteThread(id);
    s.threads.deleteMeta(id);
    // What was allowed for this conversation only goes with it.
    s.gateway.conversationAllows.removeForThread(id, s.actorId);
    // A coding agent's process for this conversation stops, and its session is forgotten.
    await s.models.closeThread(id).catch(() => {});
    // So do the conversations of tasks it handed to other agents.
    for (const child of s.delegations.childrenOf(id)) {
      if (s.runner.isThreadBusy(child.childThreadId)) await s.runner.stop({ threadId: child.childThreadId });
      s.runner.deleteThread(child.childThreadId);
      s.threads.deleteMeta(child.childThreadId);
      s.gateway.conversationAllows.removeForThread(child.childThreadId, s.actorId);
      await s.models.closeThread(child.childThreadId).catch(() => {});
    }
    s.delegations.deleteForParent(id);
    return c.json({ ok: true });
  });

  registerConversationAllowRoutes(app, s);
}
