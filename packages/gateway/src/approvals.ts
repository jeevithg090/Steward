// Adapted from openbot/server/src/approvals/store.ts and approvals/types.ts (MIT, CopilotKit)
/**
 * Approvals: the person's answer to a call that asked.
 *
 * Semantics follow OpenBot's approval store (CopilotKit/openbot server/src/approvals/store.ts, MIT),
 * simplified for one SQLite file: an approval is opened once per tool call, answered once, and
 * claimed once by the resume that acts on it. "Always allow" writes its standing rule in the same
 * transaction as the answer, and is refused when the ask came from the safety floor, taint, the
 * outbound check or an ask rule.
 */
import type { Db } from "@steward/db";
import { fromJson, toJson } from "@steward/db";
import type {
  Approval,
  ApprovalAnswer,
  ApprovalStatus,
  ApprovalStore,
  AuditEvent,
  Decision,
  EventBus,
  GateCall,
  Initiator,
  Rule,
} from "@steward/shared";
import { newId } from "@steward/shared";
import type { SqliteAuditLog } from "./audit.ts";
import { celString } from "./cel.ts";
import { GatewayError } from "./errors.ts";
import { truncate } from "./redact.ts";
import type { SqliteRuleStore } from "./rules.ts";
import { listPeople } from "./summary.ts";

interface ApprovalRow {
  id: string;
  tool_call_id: string;
  run_id: string;
  thread_id: string;
  agent_id: string;
  actor_id: string;
  status: string;
  summary: string;
  tool_json: string;
  args_json: string;
  target_json: string;
  decision_json: string;
  initiator_json: string;
  digest: string;
  can_always: number;
  answer: string | null;
  note: string | null;
  decided_by: string | null;
  claimed_at: string | null;
  created_rule_id: string | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string;
}

/** An approval with the fields only the gateway needs. */
export interface ApprovalRecord {
  approval: Approval;
  digest: string;
  actorId: string;
  initiator: Initiator;
  note?: string;
}

function rowToApproval(row: ApprovalRow): Approval {
  const approval: Approval = {
    id: row.id,
    toolCallId: row.tool_call_id,
    runId: row.run_id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    status: row.status as ApprovalStatus,
    summary: row.summary,
    tool: fromJson<GateCall["tool"]>(row.tool_json, {
      name: "",
      kind: "write",
      surface: "system",
      source: "",
    }),
    args: fromJson<Record<string, unknown>>(row.args_json, {}),
    target: fromJson<GateCall["target"]>(row.target_json, {}),
    decision: fromJson<Decision>(row.decision_json, { effect: "ask", reason: "", findings: [] }),
    canAlways: row.can_always === 1,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  if (row.answer) approval.answer = row.answer as ApprovalAnswer;
  if (row.claimed_at) approval.claimedAt = row.claimed_at;
  if (row.created_rule_id) approval.createdRuleId = row.created_rule_id;
  if (row.decided_at) approval.decidedAt = row.decided_at;
  approval.initiator = fromJson<Initiator>(row.initiator_json, { kind: "person", id: row.actor_id });
  return approval;
}

function rowToRecord(row: ApprovalRow): ApprovalRecord {
  const record: ApprovalRecord = {
    approval: rowToApproval(row),
    digest: row.digest,
    actorId: row.actor_id,
    initiator: fromJson<Initiator>(row.initiator_json, { kind: "person", id: row.actor_id }),
  };
  if (row.note) record.note = row.note;
  return record;
}

/** What "Always allow" turns into. Scoped as narrowly as the call allows. */
export function alwaysRuleFor(approval: Pick<Approval, "tool" | "target" | "summary">): {
  name: string;
  when: string;
  description: string;
} {
  const { tool, target } = approval;
  const parts = [`tool.name == ${celString(tool.name)}`];
  const scope: string[] = [];
  if (target.host) {
    parts.push(`target.host == ${celString(target.host)}`);
    scope.push(`on ${target.host}`);
  }
  if (target.mcp?.server) parts.push(`target.mcp.server == ${celString(target.mcp.server)}`);
  if (tool.surface === "browser" && target.element?.name) {
    parts.push(`target.element.name == ${celString(target.element.name)}`);
    scope.unshift(`'${truncate(target.element.name, 40)}'`);
  }
  // A key press is judged by the control it activates, which the rule cannot name: pin the kind,
  // so Enter in the same field never runs unasked once it would delete or sign instead.
  if (tool.surface === "browser") parts.push(`tool.kind == ${celString(tool.kind)}`);
  if ((tool.kind === "shell" || tool.surface === "shell") && target.command) {
    parts.push(`target.command == ${celString(target.command)}`);
    scope.push(`\`${truncate(target.command, 60)}\``);
  }
  const recipients = target.recipients ?? [];
  if (recipients.length > 0) {
    parts.push(
      `size(target.recipients) > 0 && target.recipients.all(r, r in [${recipients.map(celString).join(", ")}])`,
    );
    scope.push(`to ${listPeople(recipients)}`);
  }
  const label = target.mcp ? `${target.mcp.tool} on ${target.mcp.server}` : tool.name;
  return {
    name: truncate(`Always allow ${label}${scope.length > 0 ? ` ${scope.join(" ")}` : ""}`, 120),
    when: parts.join(" && "),
    description: truncate(`You chose Always allow for: ${approval.summary}`, 500),
  };
}

export interface OpenInput {
  call: GateCall;
  summary: string;
  args: Record<string, unknown>;
  decision: Decision;
  canAlways: boolean;
  digest: string;
  expiresAt: string;
}

const ANSWERS: readonly ApprovalAnswer[] = ["once", "always", "refuse"];

export class SqliteApprovalStore implements ApprovalStore {
  private readonly waiters = new Map<string, Set<(approval: Approval) => void>>();

  constructor(
    private readonly db: Db,
    private readonly audit: SqliteAuditLog,
    private readonly rules: SqliteRuleStore,
    private readonly bus?: EventBus,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private row(id: string): ApprovalRow | undefined {
    return this.db.get<ApprovalRow>("SELECT * FROM gateway_approvals WHERE id = ?", [id]);
  }

  private rowByToolCall(toolCallId: string): ApprovalRow | undefined {
    return this.db.get<ApprovalRow>("SELECT * FROM gateway_approvals WHERE tool_call_id = ?", [toolCallId]);
  }

  /** Newest first. Pending approvals past their expiry are marked expired first. */
  list(filter: { status?: ApprovalStatus; threadId?: string; limit?: number } = {}): Approval[] {
    this.expireDue();
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.threadId) {
      where.push("thread_id = ?");
      params.push(filter.threadId);
    }
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 100), 1), 500);
    const sql = `SELECT * FROM gateway_approvals ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?`;
    return this.db.all<ApprovalRow>(sql, [...params, limit]).map(rowToApproval);
  }

  get(id: string): Approval | undefined {
    const row = this.row(id);
    return row ? rowToApproval(row) : undefined;
  }

  byToolCall(toolCallId: string): Approval | undefined {
    const row = this.rowByToolCall(toolCallId);
    return row ? rowToApproval(row) : undefined;
  }

  /** The approval with its digest, actor and note. For the gateway's own use. */
  recordFor(toolCallId: string): ApprovalRecord | undefined {
    const row = this.rowByToolCall(toolCallId);
    return row ? rowToRecord(row) : undefined;
  }

  /**
   * Opens the approval for a call, or returns the one already open for that tool call id. The
   * caller compares digests: a second call with the same id and different arguments must not ride
   * on the first one's approval.
   */
  open(input: OpenInput): { record: ApprovalRecord; created: boolean } {
    const events: AuditEvent[] = [];
    const result = this.db.tx(() => {
      const existing = this.rowByToolCall(input.call.toolCallId);
      if (existing) return { record: rowToRecord(existing), created: false };
      const id = newId("apr");
      const at = this.now().toISOString();
      this.db.run(
        `INSERT INTO gateway_approvals (id, tool_call_id, run_id, thread_id, agent_id, actor_id, status, summary,
           tool_json, args_json, target_json, decision_json, initiator_json, digest, can_always, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.call.toolCallId,
          input.call.runId ?? "",
          input.call.threadId ?? "",
          input.call.agentId ?? "",
          input.call.actorId ?? "",
          input.summary,
          toJson(input.call.tool),
          toJson(input.args),
          toJson(input.call.target),
          toJson(input.decision),
          toJson(input.call.initiator),
          input.digest,
          input.canAlways ? 1 : 0,
          at,
          input.expiresAt,
        ],
      );
      events.push(
        this.audit.insert({
          type: "approval.requested",
          actorId: input.call.actorId,
          agentId: input.call.agentId,
          threadId: input.call.threadId,
          runId: input.call.runId,
          toolCallId: input.call.toolCallId,
          tool: input.call.tool,
          target: input.call.target,
          rule: input.decision.rule,
          detail: {
            approvalId: id,
            summary: input.summary,
            reason: input.decision.reason,
            canAlways: input.canAlways,
            findings: input.decision.findings,
            expiresAt: input.expiresAt,
          },
        }),
      );
      const row = this.row(id);
      if (!row) throw new Error("the approval was not saved");
      return { record: rowToRecord(row), created: true };
    });
    for (const e of events) this.audit.publish(e);
    if (result.created) this.emit({ type: "approval.created", approval: result.record.approval });
    return result;
  }

  /**
   * Records the person's answer. Answering the same way twice returns the approval unchanged (a
   * double click is not an error); answering differently, or after it expired, is a conflict.
   */
  decide(id: string, answer: ApprovalAnswer, actorId: string, note?: string): Approval {
    if (!ANSWERS.includes(answer))
      throw new GatewayError("invalid", "The answer must be once, always or refuse.");
    const at = this.now().toISOString();
    const events: AuditEvent[] = [];
    type Outcome =
      | { kind: "decided"; approval: Approval }
      | { kind: "same"; approval: Approval }
      | { kind: "expired"; approval: Approval }
      | { kind: "closed"; approval: Approval };
    let outcome: Outcome;
    try {
      outcome = this.db.tx((): Outcome => {
        const row = this.row(id);
        if (!row) throw new GatewayError("not_found", "There is no approval with that id.");
        const current = rowToApproval(row);
        if (current.status === "pending" && current.expiresAt <= at) {
          events.push(...this.expireRows([row], at));
          const expired = this.get(id);
          return { kind: "expired", approval: expired ?? current };
        }
        if (current.status !== "pending") {
          const same =
            (current.status === "allowed" && answer !== "refuse" && current.answer === answer) ||
            (current.status === "refused" && answer === "refuse");
          return { kind: same ? "same" : "closed", approval: current };
        }
        if (answer === "always" && !current.canAlways) {
          throw new GatewayError(
            "invalid",
            "Always allow is not offered for this one. Allow it once, or refuse it.",
          );
        }
        let created: Rule | undefined;
        if (answer === "always") {
          const rule = alwaysRuleFor(current);
          created = this.rules.insert({ ...rule, effect: "allow", source: "always", enabled: true });
        }
        const status: ApprovalStatus = answer === "refuse" ? "refused" : "allowed";
        const changed = this.db.run(
          `UPDATE gateway_approvals SET status = ?, answer = ?, note = ?, decided_by = ?, decided_at = ?,
             created_rule_id = ? WHERE id = ? AND status = 'pending'`,
          [status, answer, note ? truncate(note, 500) : null, actorId, at, created?.id ?? null, id],
        );
        if (changed.changes !== 1)
          throw new GatewayError("conflict", "This was answered at the same moment elsewhere.");
        const decided = this.get(id);
        if (!decided) throw new Error("the approval disappeared");
        events.push(
          this.audit.insert({
            type: "approval.decided",
            actorId,
            agentId: decided.agentId,
            threadId: decided.threadId,
            runId: decided.runId,
            toolCallId: decided.toolCallId,
            tool: decided.tool,
            target: decided.target,
            ...(created ? { rule: { id: created.id, name: created.name, source: created.source } } : {}),
            detail: {
              approvalId: id,
              summary: decided.summary,
              answer,
              ...(note ? { note } : {}),
              ...(created ? { createdRuleId: created.id } : {}),
            },
          }),
        );
        return { kind: "decided", approval: decided };
      });
    } catch (err) {
      this.rules.discardAudit();
      throw err;
    }
    this.rules.flushAudit();
    for (const e of events) this.audit.publish(e);
    if (outcome.kind === "decided" || outcome.kind === "expired") this.announce(outcome.approval);
    if (outcome.kind === "expired")
      throw new GatewayError("conflict", "This request expired before it was answered.");
    if (outcome.kind === "closed") {
      const what =
        outcome.approval.status === "expired"
          ? "This request expired before it was answered."
          : outcome.approval.status === "cancelled"
            ? "This request was cancelled."
            : "This was already answered.";
      throw new GatewayError("conflict", what);
    }
    return outcome.approval;
  }

  private expireRows(rows: readonly ApprovalRow[], at: string): AuditEvent[] {
    const events: AuditEvent[] = [];
    for (const row of rows) {
      const changed = this.db.run(
        "UPDATE gateway_approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'",
        [at, row.id],
      );
      if (changed.changes !== 1) continue;
      events.push(
        this.audit.insert({
          type: "approval.expired",
          actorId: "system",
          agentId: row.agent_id,
          threadId: row.thread_id,
          runId: row.run_id,
          toolCallId: row.tool_call_id,
          tool: fromJson<GateCall["tool"] | undefined>(row.tool_json, undefined),
          detail: { approvalId: row.id, summary: row.summary, expiresAt: row.expires_at },
        }),
      );
    }
    return events;
  }

  expireDue(now: Date = this.now()): number {
    const at = now.toISOString();
    const due = this.db.all<ApprovalRow>(
      "SELECT * FROM gateway_approvals WHERE status = 'pending' AND expires_at <= ? ORDER BY created_at",
      [at],
    );
    if (due.length === 0) return 0;
    const events = this.db.tx(() => this.expireRows(due, at));
    for (const e of events) this.audit.publish(e);
    for (const row of due) {
      const approval = this.get(row.id);
      if (approval?.status === "expired") this.announce(approval);
    }
    return events.length;
  }

  /**
   * Withdraws a pending approval nobody answered: the conversation moved on, or the thread was
   * deleted. Also claims it, so no later resume can act on it. Returns undefined when it was not
   * pending any more.
   */
  cancel(id: string, actorId: string, reason: string): Approval | undefined {
    const at = this.now().toISOString();
    const events: AuditEvent[] = [];
    const cancelled = this.db.tx(() => {
      const changed = this.db.run(
        `UPDATE gateway_approvals SET status = 'cancelled', claimed_at = ?, decided_at = ?, decided_by = ?, note = ?
         WHERE id = ? AND status = 'pending' AND claimed_at IS NULL`,
        [at, at, actorId, truncate(reason, 500), id],
      );
      if (changed.changes !== 1) return undefined;
      const approval = this.get(id);
      if (!approval) return undefined;
      events.push(
        this.audit.insert({
          type: "approval.decided",
          actorId,
          agentId: approval.agentId,
          threadId: approval.threadId,
          runId: approval.runId,
          toolCallId: approval.toolCallId,
          tool: approval.tool,
          detail: { approvalId: id, summary: approval.summary, status: "cancelled", reason },
        }),
      );
      return approval;
    });
    for (const e of events) this.audit.publish(e);
    if (cancelled) this.announce(cancelled);
    return cancelled;
  }

  /**
   * Claims the answer for a tool call, once. The first resume wins; every later one gets false.
   * This is the line that makes double resumes harmless.
   */
  claim(toolCallId: string): boolean {
    const changed = this.db.run(
      "UPDATE gateway_approvals SET claimed_at = ? WHERE tool_call_id = ? AND claimed_at IS NULL",
      [this.now().toISOString(), toolCallId],
    );
    return changed.changes === 1;
  }

  /**
   * Resolves when the approval is no longer pending (answered, expired or cancelled). With a
   * timeout it resolves with the approval as it then stands, which may still be pending.
   */
  waitFor(id: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Approval> {
    const current = this.get(id);
    if (!current) return Promise.reject(new GatewayError("not_found", "There is no approval with that id."));
    if (current.status !== "pending") return Promise.resolve(current);
    return new Promise<Approval>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const listeners = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, listeners);
      const cleanup = () => {
        listeners.delete(onDecided);
        if (listeners.size === 0) this.waiters.delete(id);
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      const onDecided = (approval: Approval) => {
        cleanup();
        resolve(approval);
      };
      const onAbort = () => {
        cleanup();
        reject(opts.signal?.reason ?? new Error("Stopped waiting."));
      };
      listeners.add(onDecided);
      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          resolve(this.get(id) ?? current);
        }, opts.timeoutMs);
      }
    });
  }

  private announce(approval: Approval): void {
    this.emit({ type: "approval.decided", approval });
    for (const listener of [...(this.waiters.get(approval.id) ?? [])]) listener(approval);
  }

  private emit(event: { type: "approval.created" | "approval.decided"; approval: Approval }): void {
    try {
      this.bus?.emit(event);
    } catch (err) {
      console.error(JSON.stringify({ type: "gateway.bus_error", error: String(err) }));
    }
  }
}
