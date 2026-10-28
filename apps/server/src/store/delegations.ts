import type { Db } from "@steward/db";

export type DelegationStatus = "running" | "waiting" | "done" | "failed" | "stopped";

export interface DelegationRecord {
  subagentRunId: string;
  parentThreadId: string;
  parentAgentId: string;
  parentRunId: string;
  parentToolCallId: string;
  childThreadId: string;
  childAgentId: string;
  task: string;
  depth: number;
  status: DelegationStatus;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  subagent_run_id: string;
  parent_thread_id: string;
  parent_agent_id: string;
  parent_run_id: string;
  parent_tool_call_id: string;
  child_thread_id: string;
  child_agent_id: string;
  task: string;
  depth: number;
  status: DelegationStatus;
  created_at: string;
  updated_at: string;
}

function toRecord(row: Row): DelegationRecord {
  return {
    subagentRunId: row.subagent_run_id,
    parentThreadId: row.parent_thread_id,
    parentAgentId: row.parent_agent_id,
    parentRunId: row.parent_run_id,
    parentToolCallId: row.parent_tool_call_id,
    childThreadId: row.child_thread_id,
    childAgentId: row.child_agent_id,
    task: row.task,
    depth: row.depth,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every task one agent handed to another, and the questions each child is waiting on. */
export class DelegationStore {
  constructor(private readonly db: Db) {}

  insert(record: Omit<DelegationRecord, "createdAt" | "updatedAt" | "status">): DelegationRecord {
    const at = new Date().toISOString();
    this.db.run(
      `INSERT INTO delegations (subagent_run_id, parent_thread_id, parent_agent_id, parent_run_id,
         parent_tool_call_id, child_thread_id, child_agent_id, task, depth, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
      [
        record.subagentRunId,
        record.parentThreadId,
        record.parentAgentId,
        record.parentRunId,
        record.parentToolCallId,
        record.childThreadId,
        record.childAgentId,
        record.task,
        record.depth,
        at,
        at,
      ],
    );
    return this.get(record.subagentRunId) as DelegationRecord;
  }

  get(subagentRunId: string): DelegationRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM delegations WHERE subagent_run_id = ?", [subagentRunId]);
    return row ? toRecord(row) : undefined;
  }

  byChildThread(threadId: string): DelegationRecord | undefined {
    const row = this.db.get<Row>("SELECT * FROM delegations WHERE child_thread_id = ?", [threadId]);
    return row ? toRecord(row) : undefined;
  }

  /** The delegation a child's question belongs to. */
  ownerOf(interruptId: string): string | undefined {
    return this.db.get<{ subagent_run_id: string }>(
      "SELECT subagent_run_id FROM delegation_interrupts WHERE interrupt_id = ?",
      [interruptId],
    )?.subagent_run_id;
  }

  setStatus(subagentRunId: string, status: DelegationStatus, interruptIds: readonly string[] = []): void {
    this.db.tx(() => {
      this.db.run("UPDATE delegations SET status = ?, updated_at = ? WHERE subagent_run_id = ?", [
        status,
        new Date().toISOString(),
        subagentRunId,
      ]);
      this.db.run("DELETE FROM delegation_interrupts WHERE subagent_run_id = ?", [subagentRunId]);
      for (const id of interruptIds) {
        this.db.run(
          "INSERT OR REPLACE INTO delegation_interrupts (interrupt_id, subagent_run_id) VALUES (?, ?)",
          [id, subagentRunId],
        );
      }
    });
  }

  /** How many of a parent run's children are running now. */
  runningFor(parentRunId: string): number {
    return (
      this.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM delegations WHERE parent_run_id = ? AND status = 'running'",
        [parentRunId],
      )?.n ?? 0
    );
  }

  /** Every child conversation, so the conversation list can leave them out. */
  childThreadIds(): Set<string> {
    return new Set(
      this.db
        .all<{ child_thread_id: string }>("SELECT child_thread_id FROM delegations")
        .map((r) => r.child_thread_id),
    );
  }

  /** The children of a conversation, e.g. to delete them with it. */
  childrenOf(parentThreadId: string): DelegationRecord[] {
    return this.db
      .all<Row>("SELECT * FROM delegations WHERE parent_thread_id = ? ORDER BY created_at", [parentThreadId])
      .map(toRecord);
  }

  deleteForParent(parentThreadId: string): void {
    this.db.run("DELETE FROM delegations WHERE parent_thread_id = ?", [parentThreadId]);
  }
}
