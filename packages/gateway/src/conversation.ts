/**
 * "Allow in this conversation": an answer between Allow once and Always allow, after OpenBot's
 * approvals (docs/approvals.md, MIT, CopilotKit). The person allows a call and the same again, but
 * only in this conversation. It is scoped like an Always allow (the same tool, place, element and
 * people) and, on top of that, by the two checks below, kept in small functions of their own so
 * the decision itself does not change:
 *
 * - `canAllowInConversation`: it is offered only where Always allow is (so never for the safety
 *   floor, taint, the outbound check or an ask rule) and only for a run the person started.
 *   Routines and tasks reuse their conversations, so there an allow would act as a standing rule.
 * - `inConversationScope`: it applies only in its own conversation, with its own agent, to runs the
 *   person started or the answer resumed. A routine or task run in the same conversation, or a run
 *   started from a phone, never gets it.
 *
 * In scope, it joins the allow rules (step 6 of the decision), so deny rules, the floor, taint, the
 * outbound check and ask rules all still come first, unchanged.
 */
import type { Db } from "@steward/db";
import type {
  Approval,
  AuditEvent,
  ConversationAllow,
  ConversationAllowStore,
  GateCall,
  Rule,
} from "@steward/shared";
import { newId } from "@steward/shared";
import { alwaysRuleFor } from "./approvals.ts";
import type { SqliteAuditLog } from "./audit.ts";
import { truncate } from "./redact.ts";

/** Runs the person stands behind: their own, and the one their answer resumed. */
const PERSON_RUNS = new Set(["person", "resume"]);

interface AllowRow {
  id: string;
  thread_id: string;
  agent_id: string;
  name: string;
  cel: string;
  summary: string;
  approval_id: string;
  created_at: string;
}

function rowToAllow(row: AllowRow): ConversationAllow {
  return {
    id: row.id,
    threadId: row.thread_id,
    agentId: row.agent_id,
    name: row.name,
    when: row.cel,
    summary: row.summary,
    approvalId: row.approval_id,
    createdAt: row.created_at,
  };
}

/** Whether "Allow in this conversation" may be offered for this approval. */
export function canAllowInConversation(
  approval: Pick<Approval, "canAlways" | "threadId" | "initiator">,
): boolean {
  return (
    approval.canAlways === true &&
    typeof approval.threadId === "string" &&
    approval.threadId !== "" &&
    PERSON_RUNS.has(approval.initiator?.kind ?? "")
  );
}

/** Whether a conversation allow may decide this call. No initiator, no allow: it fails closed. */
export function inConversationScope(
  allow: Pick<ConversationAllow, "threadId" | "agentId">,
  call: Pick<GateCall, "threadId" | "agentId" | "initiator">,
): boolean {
  return (
    allow.threadId !== "" &&
    call.threadId === allow.threadId &&
    call.agentId === allow.agentId &&
    PERSON_RUNS.has(call.initiator?.kind ?? "")
  );
}

/** A conversation allow as the decision reads it: an allow rule with source `conversation`. */
export function asRule(allow: ConversationAllow): Rule {
  return {
    id: allow.id,
    name: allow.name,
    effect: "allow",
    when: allow.when,
    description: "You allowed this for this conversation",
    source: "conversation",
    enabled: true,
    createdAt: allow.createdAt,
  };
}

export class SqliteConversationAllows implements ConversationAllowStore {
  constructor(
    private readonly db: Db,
    private readonly audit: SqliteAuditLog,
    private readonly now: () => Date = () => new Date(),
  ) {}

  forThread(threadId: string): ConversationAllow[] {
    if (!threadId) return [];
    return this.db
      .all<AllowRow>(
        "SELECT * FROM gateway_conversation_allows WHERE thread_id = ? ORDER BY created_at DESC, id DESC",
        [threadId],
      )
      .map(rowToAllow);
  }

  /** The allows that may decide this call, as rules. Empty unless the call is in scope. */
  rulesFor(call: Pick<GateCall, "threadId" | "agentId" | "initiator">): Rule[] {
    if (!call.threadId) return [];
    return this.forThread(call.threadId)
      .filter((allow) => inConversationScope(allow, call))
      .map(asRule);
  }

  get(id: string): ConversationAllow | undefined {
    const row = this.db.get<AllowRow>("SELECT * FROM gateway_conversation_allows WHERE id = ?", [id]);
    return row ? rowToAllow(row) : undefined;
  }

  /**
   * Writes the allow for an approval being answered. Runs inside the caller's transaction and
   * returns the record row, which the caller announces once it commits. Undefined when Always allow
   * could not name what was approved, so nothing this broad is written.
   */
  insert(approval: Approval, actorId: string): { allow: ConversationAllow; event: AuditEvent } | undefined {
    const always = alwaysRuleFor(approval);
    if (!always || always.when.length > 2000) return undefined;
    const allow: ConversationAllow = {
      id: newId("cva"),
      threadId: approval.threadId,
      agentId: approval.agentId,
      name: truncate(`${always.name.replace(/^Always allow /, "")}, in this conversation`, 120),
      when: always.when,
      summary: truncate(approval.summary, 500),
      approvalId: approval.id,
      createdAt: this.now().toISOString(),
    };
    this.db.run(
      `INSERT INTO gateway_conversation_allows (id, thread_id, agent_id, name, cel, summary, approval_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        allow.id,
        allow.threadId,
        allow.agentId,
        allow.name,
        allow.when,
        allow.summary,
        allow.approvalId,
        allow.createdAt,
      ],
    );
    return { allow, event: this.record("created", allow, actorId) };
  }

  remove(threadId: string, id: string, actorId: string): boolean {
    const events: AuditEvent[] = [];
    const removed = this.db.tx(() => {
      const allow = this.get(id);
      if (!allow || allow.threadId !== threadId) return false;
      this.db.run("DELETE FROM gateway_conversation_allows WHERE id = ?", [id]);
      events.push(this.record("removed", allow, actorId));
      return true;
    });
    for (const e of events) this.audit.publish(e);
    return removed;
  }

  removeForThread(threadId: string, actorId: string): number {
    const events: AuditEvent[] = [];
    const count = this.db.tx(() => {
      const allows = this.forThread(threadId);
      for (const allow of allows) {
        this.db.run("DELETE FROM gateway_conversation_allows WHERE id = ?", [allow.id]);
        events.push(this.record("removed", allow, actorId));
      }
      return allows.length;
    });
    for (const e of events) this.audit.publish(e);
    return count;
  }

  private record(change: "created" | "removed", allow: ConversationAllow, actorId: string): AuditEvent {
    return this.audit.insert({
      type: "policy.changed",
      actorId,
      agentId: allow.agentId,
      threadId: allow.threadId,
      rule: { id: allow.id, name: allow.name, source: "conversation" },
      detail: {
        change,
        summary:
          change === "created"
            ? `Allowed for this conversation: ${allow.summary}`
            : `Turned off what was allowed for this conversation: ${allow.summary}`,
        ruleEffect: "allow",
        when: allow.when,
        approvalId: allow.approvalId,
      },
    });
  }
}
