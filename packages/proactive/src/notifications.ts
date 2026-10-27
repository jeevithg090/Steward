import type { Db } from "@steward/db";
import type { AppNotification, EventBus, NotificationStore } from "@steward/shared";
import { newId } from "@steward/shared";
import { ProactiveError, requireText } from "./errors.ts";

const LEVELS: readonly AppNotification["level"][] = ["info", "needs_you", "done", "problem"];

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  href: string | null;
  level: string;
  created_at: string;
  read_at: string | null;
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    ...(row.href ? { href: row.href } : {}),
    level: row.level as AppNotification["level"],
    createdAt: row.created_at,
    ...(row.read_at ? { readAt: row.read_at } : {}),
  };
}

/**
 * What Steward wants the person to know when they are not looking: a brief is ready, a routine was
 * switched off. Each one is also pushed on the bus so an open page shows it at once.
 */
export function createNotificationStore(opts: {
  db: Db;
  bus?: EventBus;
  now: () => Date;
}): NotificationStore {
  const { db, bus, now } = opts;

  return {
    list(filter = {}) {
      const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 500);
      const rows = db.all<NotificationRow>(
        `SELECT * FROM proactive_notifications ${filter.unreadOnly ? "WHERE read_at IS NULL" : ""}
         ORDER BY rowid DESC LIMIT ?`,
        [limit],
      );
      return rows.map(toNotification);
    },

    add(input) {
      const title = requireText(input.title, 200, "A notification needs a title.");
      const body = typeof input.body === "string" ? input.body.trim().slice(0, 1000) : "";
      if (!LEVELS.includes(input.level)) {
        throw new ProactiveError("invalid", "That is not a notification level Steward knows.");
      }
      const href = input.href?.trim() || undefined;
      const notification: AppNotification = {
        id: newId("ntf"),
        title,
        body,
        ...(href ? { href } : {}),
        level: input.level,
        createdAt: now().toISOString(),
      };
      db.run(
        `INSERT INTO proactive_notifications (id, title, body, href, level, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [notification.id, title, body, href ?? null, notification.level, notification.createdAt],
      );
      bus?.emit({ type: "notification", notification });
      return notification;
    },

    readAll() {
      db.run("UPDATE proactive_notifications SET read_at = ? WHERE read_at IS NULL", [now().toISOString()]);
    },
  };
}
