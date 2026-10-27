import type { Migration } from "@steward/db";

/**
 * The proactive package's tables. Ids are global and never renamed; add new migrations at the end.
 *
 * Tasks keep the state that was set, and the store derives what to show on read (a task whose
 * approval is waiting reads as `needs_you`), so the stored value never drifts from the approval.
 * Briefs are one row per local date, which is what makes `generate` idempotent per day.
 */
export const migrations: Migration[] = [
  {
    id: "proactive.001_init",
    sql: `
      CREATE TABLE proactive_tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        state       TEXT NOT NULL,
        source      TEXT NOT NULL,
        thread_id   TEXT,
        approval_id TEXT,
        email_id    TEXT,
        next_step   TEXT,
        error       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX proactive_tasks_updated ON proactive_tasks (updated_at);
      CREATE INDEX proactive_tasks_thread ON proactive_tasks (thread_id);
      CREATE INDEX proactive_tasks_approval ON proactive_tasks (approval_id);
      CREATE INDEX proactive_tasks_email ON proactive_tasks (email_id);

      CREATE TABLE proactive_memory (
        id         TEXT PRIMARY KEY,
        text       TEXT NOT NULL,
        source     TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE proactive_skills (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description  TEXT NOT NULL,
        instructions TEXT NOT NULL,
        tools        TEXT NOT NULL DEFAULT '[]',
        source       TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE proactive_routines (
        id                   TEXT PRIMARY KEY,
        title                TEXT NOT NULL,
        prompt               TEXT NOT NULL,
        schedule             TEXT NOT NULL,
        timezone             TEXT NOT NULL,
        enabled              INTEGER NOT NULL,
        agent_id             TEXT NOT NULL,
        thread_id            TEXT NOT NULL,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_run_at          TEXT,
        last_status          TEXT,
        last_error           TEXT,
        next_run_at          TEXT,
        running_since        TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      CREATE INDEX proactive_routines_due ON proactive_routines (enabled, next_run_at);

      CREATE TABLE proactive_briefs (
        date       TEXT PRIMARY KEY,
        id         TEXT NOT NULL UNIQUE,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE proactive_notifications (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        href       TEXT,
        level      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at    TEXT
      );

      CREATE TABLE proactive_triage_cache (
        email_id   TEXT PRIMARY KEY,
        verdict    TEXT NOT NULL,
        reason     TEXT NOT NULL,
        confidence REAL NOT NULL,
        model      TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];
