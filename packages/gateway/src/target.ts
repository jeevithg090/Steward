/**
 * What a call is and what it touches, normalised before any rule sees it.
 *
 * The catalogue in `@steward/shared` is the source of truth for built-in tools: a caller cannot make
 * `mail_send` a read. Unknown tools are at least writes (fail closed). The target the agent resolved
 * wins; anything it left out that can be read from the arguments (a URL's host, a command, the
 * recipients of a message) is filled in, so a rule on `target.host` still holds when a caller forgot.
 */
import {
  type GateCall,
  type Initiator,
  isBuiltinTool,
  parseMcpToolName,
  type Target,
  TOOLS,
  type ToolKind,
  type ToolSurface,
} from "@steward/shared";

/** `tool.source` of a permission an external coding agent asked for: `harness:<id>`. */
export const HARNESS_SOURCE_PREFIX = "harness:";

export const TOOL_KINDS: readonly ToolKind[] = [
  "read",
  "write",
  "send",
  "pay",
  "sign",
  "delete",
  "shell",
  "ui",
];
export const TOOL_SURFACES: readonly ToolSurface[] = [
  "browser",
  "file",
  "shell",
  "mail",
  "calendar",
  "web",
  "mcp",
  "memory",
  "task",
  "ui",
  "system",
];

/** How much a kind can change. Ties keep the first kind. */
const SEVERITY: Record<ToolKind, number> = {
  read: 0,
  ui: 0,
  write: 1,
  send: 2,
  sign: 2,
  delete: 2,
  shell: 2,
  pay: 3,
};

/** Anything that is not a known kind is a write. */
export function normaliseKind(kind: unknown): ToolKind {
  return typeof kind === "string" && (TOOL_KINDS as readonly string[]).includes(kind)
    ? (kind as ToolKind)
    : "write";
}

export function stricterKind(a: ToolKind, b: ToolKind): ToolKind {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

function normaliseSurface(surface: unknown, fallback: ToolSurface): ToolSurface {
  return typeof surface === "string" && (TOOL_SURFACES as readonly string[]).includes(surface)
    ? (surface as ToolSurface)
    : fallback;
}

/**
 * The tool as the gateway judges it. Built-ins take their kind and surface from the catalogue (a
 * stricter kind from the caller is kept); MCP tools keep the read/write the person marked; anything
 * else is at least a write.
 */
export function toolInfo(name: string, given?: Partial<GateCall["tool"]>): GateCall["tool"] {
  const givenKind = given?.kind === undefined ? undefined : normaliseKind(given.kind);
  if (isBuiltinTool(name)) {
    const entry = TOOLS[name];
    return {
      name,
      kind: givenKind ? stricterKind(entry.kind, givenKind) : entry.kind,
      surface: entry.surface,
      source: given?.source || "builtin",
    };
  }
  const mcp = parseMcpToolName(name);
  if (mcp) {
    return { name, kind: givenKind ?? "write", surface: "mcp", source: given?.source || `mcp:${mcp.server}` };
  }
  // A permission an external coding agent asked for: its kind was mapped from the harness's own
  // tool kind (`packages/harnesses`), which also makes any call carrying a command a `shell`.
  if (given?.source?.startsWith(HARNESS_SOURCE_PREFIX)) {
    return {
      name,
      kind: givenKind ?? "write",
      surface: normaliseSurface(given.surface, "system"),
      source: given.source,
    };
  }
  return {
    name,
    kind: stricterKind("write", givenKind ?? "write"),
    surface: normaliseSurface(given?.surface, "system"),
    source: given?.source || "unknown",
  };
}

/** The host of a URL, lower case, without port. Empty when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function addresses(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      for (const part of item.split(/[,;]/)) {
        const angle = /<([^>]+)>/.exec(part);
        const addr = (angle?.[1] ?? part).trim().toLowerCase();
        if (addr) out.push(addr);
      }
    } else if (item && typeof item === "object") {
      const email = text((item as Record<string, unknown>).email);
      if (email) out.push(email.toLowerCase());
    }
  }
  return out;
}

/** What can be read straight from a call's arguments. Never the element: that comes from the page. */
export function deriveTarget(name: string, args: Record<string, unknown>): Target {
  const target: Target = {};
  const url = text(args.url) ?? text(args.href);
  if (url) {
    target.url = url;
    const host = hostOf(url);
    if (host) target.host = host;
  }
  const path = text(args.path) ?? text(args.dir) ?? text(args.file);
  if (path) target.path = path;
  const command = text(args.command) ?? text(args.cmd);
  if (command) target.command = command;
  const recipients = [
    ...new Set([
      ...addresses(args.to),
      ...addresses(args.cc),
      ...addresses(args.bcc),
      ...addresses(args.recipients),
      ...addresses(args.attendees),
    ]),
  ];
  if (recipients.length > 0) target.recipients = recipients;
  const amount = args.amount;
  if (amount && typeof amount === "object") {
    const a = amount as Record<string, unknown>;
    if (typeof a.value === "number" && Number.isFinite(a.value)) {
      target.amount = { value: a.value, currency: text(a.currency)?.toUpperCase() ?? "" };
    }
  } else if (typeof amount === "number" && Number.isFinite(amount)) {
    target.amount = { value: amount, currency: text(args.currency)?.toUpperCase() ?? "" };
  }
  const mcp = parseMcpToolName(name);
  if (mcp) target.mcp = mcp;
  return target;
}

/** The caller's target, completed from the arguments and tidied (lower-case host and addresses). */
export function completeTarget(
  name: string,
  args: Record<string, unknown>,
  given: Target | undefined,
): Target {
  const derived = deriveTarget(name, args);
  const merged: Target = { ...derived };
  for (const [key, value] of Object.entries(given ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  if (merged.host) merged.host = merged.host.trim().toLowerCase();
  else if (merged.url) {
    const host = hostOf(merged.url);
    if (host) merged.host = host;
  }
  if (merged.recipients)
    merged.recipients = [...new Set(merged.recipients.map((r) => String(r).trim().toLowerCase()))];
  return merged;
}

/**
 * A whole `GateCall` from a tool name and arguments, with the kind and surface from the catalogue.
 * For the "would this be allowed?" tester (`POST /api/rules/dry-run`) and for callers that build
 * calls by hand; ids default to `dry-run`.
 */
export function gateCallFor(input: {
  tool: string;
  args?: Record<string, unknown>;
  target?: Target;
  tainted?: boolean;
  initiator?: Initiator | Initiator["kind"];
  kind?: ToolKind;
  source?: string;
  intent?: string;
  outbound?: string;
  toolCallId?: string;
  runId?: string;
  threadId?: string;
  agentId?: string;
  actorId?: string;
}): GateCall {
  const actorId = input.actorId ?? "local";
  const initiator: Initiator =
    typeof input.initiator === "string"
      ? { kind: input.initiator, id: input.initiator === "person" ? actorId : "" }
      : (input.initiator ?? { kind: "person", id: actorId });
  const args = input.args ?? {};
  const given: Partial<GateCall["tool"]> = {};
  if (input.kind) given.kind = input.kind;
  if (input.source) given.source = input.source;
  const call: GateCall = {
    toolCallId: input.toolCallId ?? "dry-run",
    runId: input.runId ?? "dry-run",
    threadId: input.threadId ?? "dry-run",
    agentId: input.agentId ?? "steward",
    actorId,
    initiator,
    tool: toolInfo(input.tool, given),
    args,
    target: completeTarget(input.tool, args, input.target),
    tainted: input.tainted === true,
  };
  if (input.intent) call.intent = input.intent;
  if (input.outbound) call.outbound = input.outbound;
  return call;
}
