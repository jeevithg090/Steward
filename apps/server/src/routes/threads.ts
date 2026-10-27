import { newId, ROUTES, ThreadCreateBody } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound, readBody } from "../http/errors.ts";
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
    if (!s.hasAgent(body.agentId)) throw new HttpError(400, "Choose one of your agents.");
    const id = newId("thr");
    s.threads.upsertMeta({ id, agentId: body.agentId, kind: "chat", title: body.title?.trim() ?? "" });
    return c.json(s.threads.summary(id), 201);
  });

  app.get(ROUTES.thread, (c) => {
    const summary = s.threads.summary(c.req.param("id"));
    if (!summary) throw notFound("that conversation");
    return c.json(summary);
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
    return c.json({ ok: true });
  });
}
