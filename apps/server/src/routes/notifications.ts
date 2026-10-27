import { ROUTES } from "@steward/shared";
import type { Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { flagQuery, intQuery } from "./query.ts";

/** `/api/notifications`: what Steward told the person while they were away. */
export function registerNotificationRoutes(app: Hono, s: StewardServices): void {
  const { notifications } = s.proactive;

  app.get(ROUTES.notifications, (c) => {
    const limit = intQuery(c, "limit", { min: 1, max: 200, fallback: 50 });
    return c.json(
      notifications.list({
        ...(flagQuery(c, "unread") ? { unreadOnly: true } : {}),
        ...(limit ? { limit } : {}),
      }),
    );
  });

  app.post(`${ROUTES.notifications}/read-all`, (c) => {
    notifications.readAll();
    return c.json({ ok: true });
  });
}
