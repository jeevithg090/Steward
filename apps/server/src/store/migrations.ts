import type { Migration } from "@steward/db";

/**
 * The server's own tables: a key-value settings table, what the server knows about each
 * conversation, and the runner's record of every run. Everything else belongs to the packages.
 */
export const migrations: Migration[] = [
  {
    id: "server.001_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS server_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
  },
  {
    id: "server.002_thread_meta",
    sql: `
      CREATE TABLE IF NOT EXISTS thread_meta (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'routine', 'task')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS thread_meta_by_updated ON thread_meta (updated_at DESC);`,
  },
  {
    id: "server.003_runner",
    sql: `
      CREATE TABLE IF NOT EXISTS runner_threads (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        messages TEXT NOT NULL DEFAULT '[]',
        preview TEXT
      );
      CREATE TABLE IF NOT EXISTS runner_runs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        parent_run_id TEXT,
        agent_id TEXT NOT NULL,
        events TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runner_runs_by_thread ON runner_runs (thread_id, seq);`,
  },
];
