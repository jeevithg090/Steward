import type { Db } from "@steward/db";
import type { ThreadSummary } from "@steward/shared";
import type { NodeSqliteAgentRunner, RunnerThreadRecord } from "../runtime/runner.ts";

export type ThreadKind = ThreadSummary["kind"];

export interface ThreadMeta {
  id: string;
  title: string;
  agentId: string;
  kind: ThreadKind;
  createdAt: string;
  updatedAt: string;
}

interface MetaRow {
  id: string;
  title: string;
  agent_id: string;
  kind: ThreadKind;
  created_at: string;
  updated_at: string;
}

const UNTITLED = "New conversation";

/** A short title from the first thing the person said: first line, at most `max` characters. */
export function titleFrom(text: string, max = 60): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const clean = line.replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * What the server knows about each conversation (title, kind, agent), joined with the runner's
 * record of its runs. A thread the browser started without asking the server exists only in the
 * runner until its first run finishes; it is listed all the same.
 */
export class ThreadStore {
  constructor(
    private readonly db: Db,
    private readonly runner: NodeSqliteAgentRunner,
    /** Conversations kept out of the list: the ones a task handed to another agent runs in. */
    private readonly hidden: () => ReadonlySet<string> = () => new Set(),
  ) {}

  getMeta(id: string): ThreadMeta | undefined {
    const row = this.db.get<MetaRow>("SELECT * FROM thread_meta WHERE id = ?", [id]);
    return row ? toMeta(row) : undefined;
  }

  /** Creates the row when missing. A given title or kind replaces what is stored. */
  upsertMeta(input: { id: string; agentId: string; kind?: ThreadKind; title?: string }): ThreadMeta {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO thread_meta (id, title, agent_id, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = CASE WHEN ? IS NULL THEN title ELSE excluded.title END,
         kind = CASE WHEN ? IS NULL THEN kind ELSE excluded.kind END,
         updated_at = excluded.updated_at`,
      [
        input.id,
        input.title ?? "",
        input.agentId,
        input.kind ?? "chat",
        now,
        now,
        input.title ?? null,
        input.kind ?? null,
      ],
    );
    return this.getMeta(input.id)!;
  }

  setTitle(id: string, title: string): void {
    this.db.run("UPDATE thread_meta SET title = ?, updated_at = ? WHERE id = ?", [
      title,
      new Date().toISOString(),
      id,
    ]);
  }

  touch(id: string): void {
    this.db.run("UPDATE thread_meta SET updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
  }

  deleteMeta(id: string): void {
    this.db.run("DELETE FROM thread_meta WHERE id = ?", [id]);
  }

  exists(id: string): boolean {
    return this.getMeta(id) !== undefined || this.runner.threadRecord(id) !== undefined;
  }

  summary(id: string): ThreadSummary | undefined {
    const meta = this.getMeta(id);
    const record = this.runner.threadRecord(id);
    if (!meta && !record) return undefined;
    return this.compose(id, meta, record);
  }

  list(filter: { kind?: ThreadKind; agentId?: string; limit?: number } = {}): ThreadSummary[] {
    const metas = new Map(this.db.all<MetaRow>("SELECT * FROM thread_meta").map((r) => [r.id, toMeta(r)]));
    const records = new Map(this.runner.threadRecords().map((r) => [r.id, r]));
    const ids = new Set([...metas.keys(), ...records.keys()]);
    const hidden = this.hidden();
    const out: ThreadSummary[] = [];
    for (const id of ids) {
      if (hidden.has(id)) continue;
      const summary = this.compose(id, metas.get(id), records.get(id));
      if (filter.kind && summary.kind !== filter.kind) continue;
      if (filter.agentId && summary.agentId !== filter.agentId) continue;
      out.push(summary);
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  private compose(id: string, meta?: ThreadMeta, record?: RunnerThreadRecord): ThreadSummary {
    const updatedAt =
      [meta?.updatedAt, record?.updatedAt].filter(Boolean).sort().at(-1) ?? new Date(0).toISOString();
    return {
      id,
      title: meta?.title || UNTITLED,
      agentId: meta?.agentId ?? record?.agentId ?? "steward",
      kind: meta?.kind ?? "chat",
      updatedAt,
      running: this.runner.isThreadRunning(id),
      ...(record?.preview ? { lastMessagePreview: record.preview } : {}),
    };
  }
}

function toMeta(row: MetaRow): ThreadMeta {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agent_id,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
