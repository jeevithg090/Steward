// The kind, target and answer mapping follows docs/plans/orchestration.md §3. The shape of the
// requests follows Happy's happy-cli/src/agent/acp/AcpBackend.ts (MIT, Happy Coder Contributors),
// with two fixes: the call is identified by `toolCallId` and described by `rawInput` and
// `locations` (never by its title), and the answer is chosen by the option's `kind`.
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ToolKind as AcpToolKind,
  PermissionOption,
  RequestPermissionOutcome,
  ToolCallContent,
  ToolCallLocation,
} from "@agentclientprotocol/sdk";
import type { Target, ToolKind, ToolSurface } from "@steward/shared";
import type { HarnessPermission, PermissionAnswer } from "../types.ts";

/** ACP's tool kinds in Steward's terms (plan §3). Anything unknown is a `write` on `system`, which asks. */
const KINDS: Record<AcpToolKind, { kind: ToolKind; surface: ToolSurface }> = {
  read: { kind: "read", surface: "file" },
  search: { kind: "read", surface: "file" },
  fetch: { kind: "read", surface: "web" },
  edit: { kind: "write", surface: "file" },
  move: { kind: "write", surface: "file" },
  delete: { kind: "delete", surface: "file" },
  execute: { kind: "shell", surface: "shell" },
  think: { kind: "ui", surface: "ui" },
  switch_mode: { kind: "write", surface: "system" },
  other: { kind: "write", surface: "system" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A command from the structured input: `command` or `cmd`, as a string or an argument list. */
export function commandOf(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const key of ["command", "cmd"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string")) {
      return (value as string[]).join(" ").trim() || undefined;
    }
  }
  return undefined;
}

/** File paths from the structured fields: ACP `locations` first, then the input's path fields. */
export function pathsOf(locations: readonly ToolCallLocation[] | null | undefined, input: unknown): string[] {
  const paths: string[] = [];
  for (const location of locations ?? []) {
    const path = text(location?.path);
    if (path) paths.push(path);
  }
  if (isRecord(input)) {
    for (const key of ["file_path", "filePath", "path", "notebook_path", "target_file", "destination"]) {
      const path = text(input[key]);
      if (path) paths.push(path);
    }
  }
  return [...new Set(paths)];
}

/** A path inside the workspace, relative to it; `undefined` when it points outside. */
export function insideWorkspace(path: string, cwd: string): string | undefined {
  const full = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(resolve(cwd), full);
  if (rel === "") return ".";
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return undefined;
  return rel;
}

/** The harness's own name for a tool: ACP `name`, or a `toolName` in its `_meta`; else one from its kind. */
export function toolNameOf(call: {
  name?: string | null;
  kind?: AcpToolKind | null;
  _meta?: Record<string, unknown> | null;
}): string {
  const own = text(call.name);
  if (own) return own;
  for (const value of Object.values(call._meta ?? {})) {
    if (isRecord(value)) {
      const name = text(value.toolName);
      if (name) return name;
    }
  }
  return `harness_${call.kind ?? "other"}`;
}

/**
 * A permission request in Steward's terms. The kind comes from ACP's tool kind, except that a call
 * that carries a command is a `shell` whatever kind it claims, and a change to a file outside the
 * agent's workspace is on the `system` surface, so it asks.
 */
export function permissionFrom(
  request: {
    toolCall: {
      toolCallId: string;
      kind?: AcpToolKind | null;
      name?: string | null;
      rawInput?: unknown;
      locations?: ToolCallLocation[] | null;
      _meta?: Record<string, unknown> | null;
    };
    options: readonly PermissionOption[];
  },
  cwd: string,
): HarnessPermission {
  const call = request.toolCall;
  const acpKind = call.kind ?? "other";
  let { kind, surface } = KINDS[acpKind] ?? KINDS.other;
  const target: Target = {};

  const command = commandOf(call.rawInput);
  if (command) {
    kind = "shell";
    surface = "shell";
    target.command = command;
  }
  const paths = pathsOf(call.locations, call.rawInput);
  const first = paths[0];
  if (first) {
    const rel = insideWorkspace(first, cwd);
    target.path = rel ?? resolve(cwd, first);
    if (rel === undefined && surface === "file") surface = "system";
    if (paths.some((p) => insideWorkspace(p, cwd) === undefined) && surface === "file") surface = "system";
  }
  if (isRecord(call.rawInput)) {
    const url = text(call.rawInput.url);
    if (url) target.url = url;
  }

  return {
    callId: call.toolCallId,
    toolName: toolNameOf(call),
    kind,
    surface,
    args: isRecord(call.rawInput)
      ? call.rawInput
      : call.rawInput === undefined
        ? {}
        : { input: call.rawInput },
    target,
    offersAlways: request.options.some((o) => o.kind === "allow_always"),
  };
}

/**
 * The ACP outcome for an answer, chosen by the option's kind (plan §3): once → `allow_once`;
 * always → `allow_always` when offered, else `allow_once`; refuse → `reject_once`; a stopped run →
 * `cancelled`. An allow the harness did not offer becomes a cancel rather than a wider grant.
 */
export function outcomeFor(
  answer: PermissionAnswer,
  options: readonly PermissionOption[],
): RequestPermissionOutcome {
  const pick = (...kinds: PermissionOption["kind"][]) => {
    for (const kind of kinds) {
      const option = options.find((o) => o.kind === kind);
      if (option) return option.optionId;
    }
    return undefined;
  };
  const optionId =
    answer === "allow_once"
      ? pick("allow_once")
      : answer === "allow_always"
        ? pick("allow_always", "allow_once")
        : answer === "reject"
          ? pick("reject_once", "reject_always")
          : undefined;
  return optionId === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId };
}

/** What a finished tool call returned, as text, from its content blocks or its raw output. */
export function outputOf(
  content: readonly ToolCallContent[] | null | undefined,
  rawOutput: unknown,
): string | undefined {
  const parts: string[] = [];
  for (const item of content ?? []) {
    if (item.type === "content" && item.content.type === "text") parts.push(item.content.text);
    else if (item.type === "diff") parts.push(`Changed ${item.path}`);
  }
  if (parts.length > 0) return parts.join("\n");
  if (typeof rawOutput === "string") return rawOutput;
  if (rawOutput === undefined || rawOutput === null) return undefined;
  try {
    return JSON.stringify(rawOutput);
  } catch {
    return undefined;
  }
}

/**
 * Keeps only lines that are JSON objects or arrays. Some agents print banners or debug output on
 * stdout before (or between) their JSON-RPC messages, which would otherwise break the stream.
 * Ported from Happy's DefaultTransport.filterStdoutLine (MIT).
 */
export function filterStdoutLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? line : null;
  } catch {
    return null;
  }
}
