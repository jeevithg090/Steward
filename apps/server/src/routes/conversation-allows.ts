import { ROUTES } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { notFound } from "../http/errors.ts";

/**
 * `/api/threads/:id/allows`: what the person allowed for one conversation only, shown above its
 * message box with a way to turn each one off. Turning one off is recorded as a policy change.
 *
 * A task handed to another agent runs in a conversation of its own, but its questions are answered
 * in this one, so what was allowed for it is listed, and turned off, here too.
 */
export function registerConversationAllowRoutes(app: Hono, s: StewardServices): void {
  const allows = s.gateway.conversationAllows;
  const withHandedOn = (id: string) => [id, ...s.delegations.childrenOf(id).map((d) => d.childThreadId)];

  app.get(ROUTES.threadAllows, (c) => {
    const id = c.req.param("id");
    if (!s.threads.exists(id)) throw notFound("that conversation");
    const list = withHandedOn(id).flatMap((threadId) => allows.forThread(threadId));
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return c.json(list);
  });

  app.delete(ROUTES.threadAllow, (c) => {
    const allowId = c.req.param("allowId");
    const removed = withHandedOn(c.req.param("id")).some((threadId) =>
      allows.remove(threadId, allowId, s.actorId),
    );
    if (!removed) throw notFound("that allow");
    return c.json({ ok: true });
  });
}
