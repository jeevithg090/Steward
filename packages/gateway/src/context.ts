/**
 * The variables a rule can read. Every field is always present, with an empty value when it does
 * not apply (`target.host` is `""` for a shell command), because cel-js refuses to read a name it
 * cannot find and a deny rule that throws refuses everything.
 */
import type { GateCall, OutboundFinding, Target } from "@steward/shared";
import { type FieldSchema, safeMap } from "./cel.ts";
import { redactForApproval } from "./redact.ts";

/** The shape a rule sees, for docs and static checks. `true` is a value; `"any"` is an open map. */
export const CONTEXT_SCHEMA: Record<string, FieldSchema> = {
  tool: { name: true, kind: true, surface: true, source: true },
  target: {
    url: true,
    host: true,
    path: true,
    command: true,
    recipients: true,
    amount: { value: true, currency: true },
    element: { ref: true, role: true, name: true },
    mcp: { server: true, tool: true },
  },
  args: "any",
  intent: true,
  tainted: true,
  initiator: { kind: true, id: true },
  agent: { id: true },
  actor: { id: true },
  findings: true,
};

export interface PolicyContext {
  tool: { name: string; kind: string; surface: string; source: string };
  target: {
    url: string;
    host: string;
    path: string;
    command: string;
    recipients: string[];
    amount: { value: number; currency: string };
    element: { ref: string; role: string; name: string };
    mcp: { server: string; tool: string };
  };
  args: unknown;
  intent: string;
  tainted: boolean;
  initiator: { kind: string; id: string };
  agent: { id: string };
  actor: { id: string };
  findings: string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function neutralTarget(target: Target | undefined): PolicyContext["target"] {
  return {
    url: str(target?.url),
    host: str(target?.host),
    path: str(target?.path),
    command: str(target?.command),
    recipients: Array.isArray(target?.recipients) ? target.recipients.map(String) : [],
    amount: {
      value: typeof target?.amount?.value === "number" ? target.amount.value : 0,
      currency: str(target?.amount?.currency),
    },
    element: {
      ref: str(target?.element?.ref),
      role: str(target?.element?.role),
      name: str(target?.element?.name),
    },
    mcp: { server: str(target?.mcp?.server), tool: str(target?.mcp?.tool) },
  };
}

/**
 * The context for one call. `call` is the call as the gateway judges it (kind escalated, target
 * completed). `args` are redacted first, so no rule can read a password.
 */
export function buildContext(
  call: Pick<
    GateCall,
    "tool" | "args" | "target" | "intent" | "tainted" | "initiator" | "agentId" | "actorId"
  >,
  findings: readonly OutboundFinding[],
  extra?: { hide?: ReadonlySet<string>; keep?: ReadonlySet<string> },
): Record<string, unknown> {
  const context: PolicyContext = {
    tool: {
      name: str(call.tool.name),
      kind: str(call.tool.kind),
      surface: str(call.tool.surface),
      source: str(call.tool.source),
    },
    target: neutralTarget(call.target),
    args: safeMap(redactForApproval(call.args ?? {}, extra)),
    intent: str(call.intent),
    tainted: call.tainted === true,
    initiator: { kind: str(call.initiator?.kind) || "person", id: str(call.initiator?.id) },
    agent: { id: str(call.agentId) },
    actor: { id: str(call.actorId) },
    findings: [...new Set(findings.map((f) => f.kind))],
  };
  return context as unknown as Record<string, unknown>;
}

/** Every variable bound to its empty value. Rules are test-run against it when saved. */
export function neutralContext(): Record<string, unknown> {
  const context: PolicyContext = {
    tool: { name: "", kind: "", surface: "", source: "" },
    target: neutralTarget(undefined),
    args: safeMap({}),
    intent: "",
    tainted: false,
    initiator: { kind: "person", id: "" },
    agent: { id: "" },
    actor: { id: "" },
    findings: [],
  };
  return context as unknown as Record<string, unknown>;
}
