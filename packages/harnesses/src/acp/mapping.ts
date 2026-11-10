// The kind, target and answer mapping follows docs/plans/orchestration.md §3. The shape of the
// requests follows Happy's happy-cli/src/agent/acp/AcpBackend.ts (MIT, Happy Coder Contributors),
// with two fixes: the call is identified by `toolCallId` and described by `rawInput` and
// `locations` (never by its title), and the answer is chosen by the option's `kind`.
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

/** The input fields that name one path: what to read or change, and both ends of a move (from first). */
const PATH_FIELDS = [
  "file_path",
  "filePath",
  "path",
  "notebook_path",
  "target_file",
  "source",
  "old_path",
  "oldPath",
  "from",
  "destination",
  "new_path",
  "newPath",
  "to",
];
/** The input fields that name several. */
const PATH_LISTS = ["paths", "files", "file_paths", "filePaths"];

/** File paths from the structured fields: ACP `locations` first, then the input's path fields. */
export function pathsOf(locations: readonly ToolCallLocation[] | null | undefined, input: unknown): string[] {
  const paths: string[] = [];
  for (const location of locations ?? []) {
    const path = text(location?.path);
    if (path) paths.push(path);
  }
  if (isRecord(input)) {
    for (const key of PATH_FIELDS) {
      const path = text(input[key]);
      if (path) paths.push(path);
    }
    for (const key of PATH_LISTS) {
      const list = input[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const path = text(item) ?? (isRecord(item) ? (text(item.path) ?? text(item.file_path)) : undefined);
        if (path) paths.push(path);
      }
    }
  }
  return [...new Set(paths)];
}

/** The real path of the deepest part of `path` that exists, with the rest as written. */
function realish(path: string): string {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync(current), ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      rest.push(basename(current));
      current = parent;
    }
  }
}

/**
 * A path inside the workspace, relative to it; `undefined` when it points outside. Compared by
 * real path, so a link inside the workspace that leads out of it counts as outside (as the
 * computer's own workspace check does).
 */
export function insideWorkspace(path: string, cwd: string): string | undefined {
  const full = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(realish(resolve(cwd)), realish(full));
  if (rel === "") return ".";
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) return undefined;
  return rel;
}

/** A path as a call shows it: relative inside the workspace, absolute outside it. */
function shownPath(path: string, cwd: string): string {
  return insideWorkspace(path, cwd) ?? resolve(cwd, path);
}

/**
 * The one path a change is judged by (`target.path`). For one path, that path. For several, the
 * folder that holds them all, ending in a separator: a rule that lets the agent work in a folder
 * then allows the change only when every path is in that folder, never because the first one is.
 */
export function targetPath(paths: readonly string[], cwd: string): string | undefined {
  const shown = [...new Set(paths.map((p) => shownPath(p, cwd)))];
  if (shown.length <= 1) return shown[0];
  const split = shown.map((p) => resolve(cwd, p).split(sep));
  const first = split[0] ?? [];
  const common: string[] = [];
  for (const [i, part] of first.entries()) {
    if (split.some((parts) => parts[i] !== part)) break;
    common.push(part);
  }
  const folder = common.join(sep) || sep;
  const inside = insideWorkspace(folder, cwd);
  if (inside !== undefined) return inside === "." ? `.${sep}` : `${inside}${sep}`;
  return folder.endsWith(sep) ? folder : `${folder}${sep}`;
}

/**
 * The vendor tools' own settings (`.claude/`, `.gemini/`, `.codex/`, `.mcp.json`): a change there
 * could let the tool stop asking, so it asks even inside the workspace.
 */
export function isVendorSettings(path: string): boolean {
  return /(^|[\\/])\.(claude|gemini|codex)([\\/]|$)|(^|[\\/])\.mcp\.json$/i.test(path);
}

/** ACP kinds that change files: with no path to check, they ask. */
const CHANGES = new Set<AcpToolKind>(["edit", "move", "delete"]);

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
 * that carries a command is a `shell` whatever kind it claims. A change is on the `system`
 * surface, so it asks, when any path it names is outside the agent's workspace or is a vendor
 * tool's own settings, and when it names no path at all (fail closed).
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
  const path = targetPath(paths, cwd);
  if (path) {
    target.path = path;
    const changes = kind !== "read";
    if (
      surface === "file" &&
      paths.some((p) => insideWorkspace(p, cwd) === undefined || (changes && isVendorSettings(p)))
    ) {
      surface = "system";
    }
  } else if (surface === "file" && CHANGES.has(acpKind)) {
    surface = "system";
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
  };
}

/**
 * The ACP outcome for an answer, chosen by the option's kind (plan §3): allow → `allow_once`;
 * refuse → `reject_once`; a stopped run → `cancelled`. `allow_always` is never chosen: Always
 * allow is a Steward rule, so the harness keeps asking and the gateway keeps deciding. An allow
 * the harness did not offer becomes a cancel rather than a wider grant.
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
