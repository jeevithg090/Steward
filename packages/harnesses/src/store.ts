import type { Db, Migration } from "@steward/db";

/** The harness package's own table: which harness session each conversation continues. */
export const migrations: Migration[] = [
  {
    id: "harnesses.001_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS harness_sessions (
        thread_id TEXT NOT NULL,
        harness_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, harness_id)
      );`,
  },
];

/**
 * The resume handle of each conversation's harness session (an ACP session id, a Codex thread id),
 * so a conversation picks up where it left off after its process stopped or Steward restarted.
 */
export class HarnessSessionStore {
  constructor(private readonly db: Db) {}

  get(threadId: string, harnessId: string): string | undefined {
    return this.db.get<{ handle: string }>(
      "SELECT handle FROM harness_sessions WHERE thread_id = ? AND harness_id = ?",
      [threadId, harnessId],
    )?.handle;
  }

  set(threadId: string, harnessId: string, agentId: string, handle: string): void {
    this.db.run(
      `INSERT INTO harness_sessions (thread_id, harness_id, agent_id, handle, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, harness_id) DO UPDATE SET handle = excluded.handle, updated_at = excluded.updated_at`,
      [threadId, harnessId, agentId, handle, new Date().toISOString()],
    );
  }

  delete(threadId: string): void {
    this.db.run("DELETE FROM harness_sessions WHERE thread_id = ?", [threadId]);
  }
}
