/**
 * The one door. Every tool call comes through `execute`; every answered approval through `resume`.
 *
 * execute: decide → record `tool.decided` → allow: act, record `tool.completed` / `tool.failed`;
 *          deny: refuse with a sentence the model relays; ask: open the approval and park.
 * resume:  claim the answer once → check it is the same call → re-check deny rules → act.
 *
 * Nothing acts unless its decision is already in the record. Any internal error refuses.
 */
import type { Decision, GateCall, GateOutcome, Governance, OutboundFinding } from "@steward/shared";
import { alwaysRuleFor, type SqliteApprovalStore } from "./approvals.ts";
import type { SqliteAuditLog } from "./audit.ts";
import type { CelEngine } from "./cel.ts";
import { messageOf } from "./errors.ts";
import { scanOutbound } from "./outbound.ts";
import { BUILTIN, bare, builtinRef, decide, denyCheck, type PreparedCall, prepareCall } from "./policy.ts";
import { canonicalJson, previewOf, redactForApproval, sha256Hex, truncate, underKey } from "./redact.ts";
import type { SqliteRuleStore } from "./rules.ts";
import { summarize } from "./summary.ts";

/** sha256 of the canonical tool name and arguments. A resumed call must match it exactly. */
export function actionDigest(call: Pick<GateCall, "tool" | "args">): string {
  return sha256Hex(canonicalJson({ tool: call.tool.name, args: call.args ?? {} }));
}

const RELAY = "Tell the person; do not try another way around it.";

/** What the model is told when a call is refused. It names the rule so the person can find it. */
export function refusalMessage(decision: Decision): string {
  const reason = bare(decision.reason);
  if (decision.rule && !decision.rule.id.startsWith("default:")) {
    return `Refused by the rule '${decision.rule.name}': ${reason}. ${RELAY}`;
  }
  return `Refused: ${reason}. ${RELAY}`;
}

export interface GovernanceDeps {
  rules: SqliteRuleStore;
  approvals: SqliteApprovalStore;
  audit: SqliteAuditLog;
  engine: CelEngine;
  /** Hours a pending approval stays open. Read on every ask, so a settings change applies at once. */
  expiryHours: () => number;
  now: () => Date;
}

export class GatewayGovernance implements Governance {
  constructor(private readonly deps: GovernanceDeps) {}

  dryRun(call: GateCall): Decision {
    return decide(this.deps.engine, this.deps.rules.current(), call).decision;
  }

  async execute<T>(call: GateCall, act: () => Promise<T>): Promise<GateOutcome<T>> {
    const verdict = decide(this.deps.engine, this.deps.rules.current(), call);
    const { decision, call: prepared } = verdict;
    const summary = this.summaryOf(prepared);

    try {
      this.record(
        prepared,
        decision,
        summary,
        decision.effect === "ask" ? { canAlways: verdict.canAlways } : {},
      );
    } catch (err) {
      return this.unrecorded(decision, err);
    }

    if (decision.effect === "deny") {
      return { status: "refused", decision, message: refusalMessage(decision) };
    }
    if (decision.effect === "ask") {
      return this.park(prepared, decision, verdict.canAlways, summary);
    }
    return this.act(prepared, decision, summary, act);
  }

  async resume<T>(call: GateCall, act: () => Promise<T>): Promise<GateOutcome<T>> {
    let prepared: PreparedCall;
    try {
      prepared = prepareCall(call);
    } catch (err) {
      return this.refuseResume(call as PreparedCall, "", `This call could not be read (${messageOf(err)})`, [
        "Not done: this call could not be read.",
      ]);
    }
    const summary = this.summaryOf(prepared);
    const { approvals } = this.deps;

    try {
      approvals.expireDue();
      let found = approvals.recordFor(prepared.toolCallId);
      if (!found) {
        return this.refuseResume(prepared, summary, "Nothing was waiting for an answer on this call", [
          "Not done: nothing was waiting for an answer on this call.",
        ]);
      }
      if (found.approval.threadId !== prepared.threadId) {
        return this.refuseResume(prepared, summary, "This answer belongs to a different conversation", [
          "Not done: this answer belongs to a different conversation.",
        ]);
      }
      if (found.approval.status === "pending") {
        const cancelled = approvals.cancel(
          found.approval.id,
          "system",
          "The conversation moved on without an answer.",
        );
        if (cancelled) {
          return this.refuseResume(prepared, summary, "The person moved on without answering", [
            "Not done: the person moved on without answering.",
            "Ask again if it is still needed.",
          ]);
        }
        found = approvals.recordFor(prepared.toolCallId) ?? found;
      }
      if (!approvals.claim(prepared.toolCallId)) {
        return this.refuseResume(prepared, summary, "This answer was already used", [
          "Already handled.",
          "This call was answered and acted on before; it was not done again.",
        ]);
      }
      const { approval, digest, note } = found;
      switch (approval.status) {
        case "refused":
          return this.refuseResume(
            prepared,
            summary,
            BUILTIN.answerRefused.reason,
            [
              "The person refused this.",
              "It was not done, and that was their decision. Do not try it again, or anything like it, unless they ask.",
              ...(note ? [`They said: "${truncate(note, 300)}"`] : []),
            ],
            builtinRef(BUILTIN.answerRefused, "person"),
          );
        case "expired":
          return this.refuseResume(prepared, summary, "Nobody answered in time", [
            "This request expired.",
            "Nobody answered in time, so it was not done. Ask again if it is still needed.",
          ]);
        case "cancelled":
          return this.refuseResume(prepared, summary, "The request was cancelled", [
            "This request was cancelled.",
            "It was not done. Ask again if it is still needed.",
          ]);
        case "allowed":
          break;
        default:
          return this.refuseResume(prepared, summary, "The answer could not be read", ["Not done."]);
      }

      if (actionDigest(prepared) !== digest) {
        return this.refuseResume(prepared, summary, "The call changed after it was approved", [
          "Not done: the call changed after the person approved it.",
          "Ask again with the new details.",
        ]);
      }

      // A deny rule added while the person was deciding still wins.
      let findings: OutboundFinding[];
      try {
        findings = scanOutbound(prepared);
      } catch {
        findings = approval.decision.findings;
      }
      const denied = denyCheck(this.deps.engine, this.deps.rules.current(), prepared, findings);
      if (denied) {
        this.record(prepared, denied, summary, { approvalId: approval.id, resumed: true });
        return { status: "refused", decision: denied, message: refusalMessage(denied) };
      }

      const createdRule = approval.createdRuleId ? this.deps.rules.get(approval.createdRuleId) : undefined;
      const decision: Decision = {
        effect: "allow",
        rule: createdRule
          ? { id: createdRule.id, name: createdRule.name, source: createdRule.source }
          : builtinRef(BUILTIN.answerOnce, "person"),
        reason: approval.answer === "always" ? "You chose Always allow" : BUILTIN.answerOnce.reason,
        findings,
      };
      this.record(prepared, decision, summary, {
        approvalId: approval.id,
        answer: approval.answer,
        resumed: true,
      });
      return this.act(prepared, decision, summary, act);
    } catch (err) {
      const decision = this.errorDecision(err);
      return { status: "refused", decision, message: refusalMessage(decision) };
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────────────────────

  private summaryOf(call: PreparedCall): string {
    try {
      return summarize({ tool: call.tool, args: call.args, target: call.target, hidden: call.hiddenArgs });
    } catch {
      return `Use ${call.tool?.name ?? "a tool"}`;
    }
  }

  /** Writes `tool.decided`. Throws if the record cannot be written; callers then refuse. */
  private record(
    call: PreparedCall,
    decision: Decision,
    summary: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.deps.audit.append(
      {
        type: "tool.decided",
        actorId: call.actorId,
        agentId: call.agentId,
        threadId: call.threadId,
        runId: call.runId,
        toolCallId: call.toolCallId,
        tool: call.tool,
        target: call.target,
        effect: decision.effect,
        rule: decision.rule,
        detail: {
          summary,
          reason: decision.reason,
          args: call.args,
          initiator: call.initiator,
          tainted: call.tainted,
          ...(call.intent ? { intent: call.intent } : {}),
          ...(decision.findings.length > 0 ? { findings: decision.findings } : {}),
          ...(call.escalatedFrom ? { escalatedFrom: call.escalatedFrom } : {}),
          ...extra,
        },
      },
      { keep: underKey("args", call.keptArgs), hide: underKey("args", call.hiddenArgs) },
    );
  }

  private async act<T>(
    call: PreparedCall,
    decision: Decision,
    summary: string,
    act: () => Promise<T>,
  ): Promise<GateOutcome<T>> {
    const started = performance.now();
    let result: T;
    try {
      result = await act();
    } catch (err) {
      const error = messageOf(err);
      this.safeAppend(call, "tool.failed", {
        summary,
        error: truncate(error, 500),
        durationMs: Math.round(performance.now() - started),
      });
      return { status: "failed", error, decision };
    }
    this.safeAppend(call, "tool.completed", {
      summary,
      durationMs: Math.round(performance.now() - started),
      preview: previewOf(result),
    });
    return { status: "done", result, decision };
  }

  /** Outcome rows: the action already happened, so a failure to record it is logged, not thrown. */
  private safeAppend(
    call: PreparedCall,
    type: "tool.completed" | "tool.failed",
    detail: Record<string, unknown>,
  ) {
    try {
      this.deps.audit.append({
        type,
        actorId: call.actorId,
        agentId: call.agentId,
        threadId: call.threadId,
        runId: call.runId,
        toolCallId: call.toolCallId,
        tool: call.tool,
        target: call.target,
        detail,
      });
    } catch (err) {
      console.error(
        JSON.stringify({ type: "gateway.audit_error", toolCallId: call.toolCallId, error: String(err) }),
      );
    }
  }

  private park<T>(
    call: PreparedCall,
    decision: Decision,
    canAlways: boolean,
    summary: string,
  ): GateOutcome<T> {
    try {
      const hours = this.deps.expiryHours();
      const expiresAt = new Date(this.deps.now().getTime() + hours * 3_600_000).toISOString();
      const digest = actionDigest(call);
      // Only offer Always allow when the rule it would write can match this call exactly.
      const offerAlways =
        canAlways && alwaysRuleFor({ tool: call.tool, target: call.target, summary }).when.length <= 2000;
      const { record, created } = this.deps.approvals.open({
        call,
        summary,
        args: redactForApproval(call.args, { keep: call.keptArgs, hide: call.hiddenArgs }),
        decision,
        canAlways: offerAlways,
        digest,
        expiresAt,
      });
      if (!created) {
        // The same tool call id came through twice. Only an identical, still-open call may share it.
        if (record.digest !== digest || record.approval.status !== "pending") {
          const refusal: Decision = {
            effect: "deny",
            rule: builtinRef(BUILTIN.answerCheck),
            reason: "This call id was already used for another request",
            findings: decision.findings,
          };
          return {
            status: "refused",
            decision: refusal,
            message: "Already handled. This call was not done again.",
          };
        }
      }
      return {
        status: "parked",
        approval: record.approval,
        decision,
        message: `Waiting for the person's answer: ${record.approval.summary}. ${bare(decision.reason)}. Do not try another way; the conversation continues when they answer.`,
      };
    } catch (err) {
      const refusal = this.errorDecision(err);
      try {
        this.record(call, refusal, summary);
      } catch {
        // Already refusing; nothing more to do.
      }
      return { status: "refused", decision: refusal, message: refusalMessage(refusal) };
    }
  }

  private refuseResume<T>(
    call: PreparedCall,
    summary: string,
    reason: string,
    message: string[],
    rule: NonNullable<Decision["rule"]> = builtinRef(BUILTIN.answerCheck),
  ): GateOutcome<T> {
    const decision: Decision = { effect: "deny", rule, reason, findings: [] };
    try {
      if (call.tool && call.hiddenArgs) this.record(call, decision, summary, { resumed: true });
    } catch (err) {
      console.error(
        JSON.stringify({ type: "gateway.audit_error", toolCallId: call.toolCallId, error: String(err) }),
      );
    }
    return { status: "refused", decision, message: message.join(" ") };
  }

  private errorDecision(err: unknown): Decision {
    return {
      effect: "deny",
      rule: builtinRef(BUILTIN.error),
      reason: `${BUILTIN.error.reason} (${bare(messageOf(err))})`,
      findings: [],
    };
  }

  private unrecorded<T>(decision: Decision, err: unknown): GateOutcome<T> {
    console.error(JSON.stringify({ type: "gateway.audit_error", error: String(err) }));
    const refusal: Decision = {
      effect: "deny",
      rule: builtinRef(BUILTIN.error),
      reason: "Steward could not write this call to the record, so it was not done",
      findings: decision.findings,
    };
    return { status: "refused", decision: refusal, message: refusalMessage(refusal) };
  }
}
