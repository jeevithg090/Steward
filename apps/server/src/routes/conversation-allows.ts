import { ROUTES } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { notFound } from "../http/errors.ts";

/**
 * `/api/threads/:id/allows`: what the person allowed for one conversation only, shown above its
 * message box with a way to turn each one off. Turning one off is recorded as a policy change.
 */
export function registerConversationAllowRoutes(app: Hono, s: StewardServices): void {
  const allows = s.gateway.conversationAllows;

  app.get(ROUTES.threadAllows, (c) => {
    const id = c.req.param("id");
    if (!s.threads.exists(id)) throw notFound("that conversation");
    return c.json(allows.forThread(id));
  });

  app.delete(ROUTES.threadAllow, (c) => {
    const id = c.req.param("id");
    if (!allows.remove(id, c.req.param("allowId"), s.actorId)) throw notFound("that allow");
    return c.json({ ok: true });
  });
}
