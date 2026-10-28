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
  {
    // Bots added from the directory: the pack itself and the ids of what installing it created, so
    // removing the bot takes away exactly that and nothing else.
    id: "server.004_installed_bots",
    sql: `
      CREATE TABLE IF NOT EXISTS installed_bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        hash TEXT NOT NULL,
        source TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        pack_json TEXT NOT NULL,
        skill_ids_json TEXT NOT NULL DEFAULT '[]',
        rule_ids_json TEXT NOT NULL DEFAULT '[]',
        routine_ids_json TEXT NOT NULL DEFAULT '[]'
      );`,
  },
  {
    // Paired phones and the one-time codes that pair them (docs/plans/phone-and-shortcuts.md §3.2).
    // Tokens and codes are kept only as SHA-256 hashes: the database never holds one that works.
    id: "server.005_devices",
    sql: `
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('shortcut', 'pwa', 'app')),
        token_hash TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scopes_json)),
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT,
        public_key TEXT,
        shortcut_version TEXT
      );
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('shortcut', 'pwa', 'app')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at TEXT
      );`,
  },
];
