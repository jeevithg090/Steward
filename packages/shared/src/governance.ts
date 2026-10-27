/**
 * Governance contracts: the shape of a tool call as the gateway sees it, the decision it makes,
 * the approval it may ask for, and the record it writes. Implemented by `@steward/gateway`.
 */

/**
 * What a tool does to the world. The gateway's defaults key off this:
 * `read` and `ui` run; `write` runs unless a rule says otherwise; `send`, `pay`, `sign`, `delete`
 * ask; `shell` asks; anything unclassified is treated as `write`.
 */
export type ToolKind = "read" | "write" | "send" | "pay" | "sign" | "delete" | "shell" | "ui";

/** Where a tool acts. Used by rules (`tool.surface == "browser"`) and by the record's filters. */
export type ToolSurface =
  | "browser"
  | "file"
  | "shell"
  | "mail"
  | "calendar"
  | "web"
  | "mcp"
  | "memory"
  | "task"
  | "ui"
  | "system";

/** What started the run. A rule can refuse a routine what it would allow a person. */
export interface Initiator {
  kind: "person" | "routine" | "task" | "resume" | "system";
  /** Routine id, task id, or the person's user id. */
  id: string;
}

/** The resolved thing a tool call acts on. Every field optional; resolvers fill what applies. */
export interface Target {
  url?: string;
  host?: string;
  path?: string;
  command?: string;
  /** Email addresses or channel names the call reaches. */
  recipients?: string[];
  /** Money, in minor units, with an ISO currency. */
  amount?: { value: number; currency: string };
  /** The element a browser action touches, from the page snapshot. */
  element?: { ref: string; role?: string; name?: string };
  /** Free-form extras for MCP tools: the server id and tool name. */
  mcp?: { server: string; tool: string };
}

/** A tool call as the gateway sees it, before anything happens. */
export interface GateCall {
  /** The AG-UI tool call id. Unique per call. */
  toolCallId: string;
  runId: string;
  threadId: string;
  agentId: string;
  /** The person the agent acts for. `local` in single-user mode. */
  actorId: string;
  initiator: Initiator;
  tool: {
    name: string;
    kind: ToolKind;
    surface: ToolSurface;
    /** `builtin`, `mcp:<server>`, `connector:<id>`. */
    source: string;
  };
  /** Arguments as the model sent them. The gateway redacts before recording. */
  args: Record<string, unknown>;
  target: Target;
  /** The model's one-line reason for the call, when it gave one. */
  intent?: string;
  /** True once this run has read content Steward does not trust (web pages, emails, MCP output). */
  tainted: boolean;
  /** Text that will leave Steward if this call runs (a message body, a form value). Checked for sensitive data. */
  outbound?: string;
}

export type Effect = "allow" | "ask" | "deny";

export interface Rule {
  id: string;
  name: string;
  effect: Effect;
  /** A CEL expression over the variables in `docs/governance.md`, e.g. `tool.kind == "pay"`. */
  when: string;
  description: string;
  /** `preset` ships with Steward; `tenant` comes from the tenant package; `person` was written in `/rules`; `always` came from an Always allow. */
  source: "preset" | "tenant" | "person" | "always";
  enabled: boolean;
  createdAt: string;
}

/** A sensitive thing found in outbound text. Never carries the value itself. */
export interface OutboundFinding {
  kind: "card_number" | "iban" | "national_id" | "api_key" | "password" | "health" | "bank_account";
  /** A masked hint such as `•••• 4242`. */
  hint: string;
  label: string;
}

export interface Decision {
  effect: Effect;
  /** The rule that decided. Absent only for the built-in defaults, which name themselves in `reason`. */
  rule?: Pick<Rule, "id" | "name" | "source">;
  reason: string;
  findings: OutboundFinding[];
}

export type ApprovalStatus = "pending" | "allowed" | "refused" | "expired" | "cancelled";
export type ApprovalAnswer = "once" | "always" | "refuse";

export interface Approval {
  id: string;
  toolCallId: string;
  runId: string;
  threadId: string;
  agentId: string;
  status: ApprovalStatus;
  /** Plain-language sentence: "Send an email to sam@example.com: 'Re: Friday'". */
  summary: string;
  tool: GateCall["tool"];
  /** Redacted arguments, safe to show. */
  args: Record<string, unknown>;
  target: Target;
  decision: Decision;
  /**
   * Whether "Always allow" is offered. False when the ask came from a person's or tenant's own ask
   * rule, from taint, or from the safety floor (payments, credentials), which no standing rule may lift.
   */
  canAlways: boolean;
  answer?: ApprovalAnswer;
  /** Set once a resume run has claimed the answer. A claimed approval never acts twice. */
  claimedAt?: string;
  /** When `answer` is `always`, the standing rule it created. */
  createdRuleId?: string;
  createdAt: string;
  decidedAt?: string;
  expiresAt: string;
}

export type AuditType =
  | "tool.decided"
  | "tool.completed"
  | "tool.failed"
  | "approval.requested"
  | "approval.decided"
  | "approval.expired"
  | "secret.requested"
  | "secret.filled"
  | "computer.help_requested"
  | "computer.control_taken"
  | "computer.control_released"
  | "policy.changed"
  | "routine.ran"
  | "routine.disabled"
  | "run.started"
  | "run.finished";

export interface AuditEvent {
  /** Monotonic, starting at 1. */
  seq: number;
  id: string;
  at: string;
  type: AuditType;
  actorId: string;
  agentId?: string;
  threadId?: string;
  runId?: string;
  toolCallId?: string;
  tool?: GateCall["tool"];
  target?: Target;
  effect?: Effect;
  rule?: Pick<Rule, "id" | "name" | "source">;
  /** Redacted detail. Never secrets, never message bodies beyond a short preview. */
  detail: Record<string, unknown>;
  /** sha256 of the previous row's hash and this row's canonical JSON. */
  prevHash: string;
  hash: string;
}

export interface ChainCheck {
  ok: boolean;
  count: number;
  /** The first row whose hash does not match, when the chain is broken. */
  brokenAt?: number;
}

/** What `Governance.execute` and `Governance.resume` return. The agent turns it into the tool result the model sees. */
export type GateOutcome<T> =
  | { status: "done"; result: T; decision: Decision }
  | { status: "refused"; decision: Decision; message: string }
  /** The person must answer. The run ends with an AG-UI interrupt keyed by the tool call id. */
  | { status: "parked"; approval: Approval; decision: Decision; message: string }
  | { status: "failed"; error: string; decision: Decision };

/**
 * The one door. Implemented by `@steward/gateway`. Every method writes its own audit rows, and any
 * internal error is a refusal (fail closed).
 *
 * Approvals do not hold a run open. An `ask` decision creates the approval and returns `parked`;
 * the run ends with an interrupt. When the person answers (`POST /api/approvals/:id/decision`), a
 * resume run (from the browser, or from the server's resume sweep when no browser is there) calls
 * `resume`, which claims the answer exactly once and acts only if it was allowed.
 */
export interface Governance {
  /** Decide → record → act → record the outcome. Returns `parked` when the person must answer. */
  execute<T>(call: GateCall, act: () => Promise<T>): Promise<GateOutcome<T>>;
  /**
   * After an answer: claims the approval for this tool call once (atomically) and acts only if it
   * was allowed and the call still matches what was approved (same tool, same arguments hash).
   * A second resume of the same call returns `refused` with "already handled".
   */
  resume<T>(call: GateCall, act: () => Promise<T>): Promise<GateOutcome<T>>;
  /** Decide without acting or recording. Powers the "would this be allowed?" tester. */
  dryRun(call: GateCall): Decision;
}

/** The interrupt Steward's middleware emits when a call is parked. `id` and `toolCallId` are the tool call id. */
export const APPROVAL_INTERRUPT_REASON = "steward_approval";

export interface ApprovalInterruptMetadata {
  approvalId: string;
  summary: string;
  tool: GateCall["tool"];
  args: Record<string, unknown>;
  findings: OutboundFinding[];
  canAlways: boolean;
  rule?: Pick<Rule, "id" | "name" | "source">;
}

/** Live events the server pushes to the web app over SSE (`GET /api/events`). */
export type LiveEvent =
  | { type: "approval.created"; approval: Approval }
  | { type: "approval.decided"; approval: Approval }
  | { type: "audit.appended"; event: AuditEvent }
  | { type: "task.updated"; taskId: string }
  | { type: "brief.ready"; briefId: string }
  | { type: "routine.updated"; routineId: string }
  | { type: "notification"; notification: AppNotification };

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  /** Where tapping it goes, e.g. `/chat/thr_...` or `/tasks`. */
  href?: string;
  level: "info" | "needs_you" | "done" | "problem";
  createdAt: string;
  readAt?: string;
}
