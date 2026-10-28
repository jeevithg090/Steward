// The approval shapes and the decision mapping follow Happy's happy-cli/src/codex/codexAppServerClient.ts
// (MIT, Happy Coder Contributors): handleServerRequest and mapDecisionToWire. The kinds and targets
// follow docs/plans/orchestration.md §3.
import { resolve } from "node:path";
import type { TokenUsage } from "@ag-ui/client";
import type { Target } from "@steward/shared";
import { insideWorkspace } from "../acp/mapping.ts";
import type { HarnessPermission, HarnessUpdate, PermissionAnswer } from "../types.ts";
import type { CodexDecision, CodexFileChange, CodexThreadItem, CodexTokenCounts } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Codex item ids count per thread, so ids are scoped with the thread, as Happy does. */
export function scopedId(threadId: string | undefined, itemId: string): string {
  return threadId ? `${threadId}:${itemId}` : itemId;
}

/** A command as one line, from Codex's argument list or string. */
export function commandLine(command: unknown): string | undefined {
  if (typeof command === "string") return text(command);
  if (Array.isArray(command) && command.every((c) => typeof c === "string")) {
    return text((command as string[]).join(" "));
  }
  return undefined;
}

/** `item/commandExecution/requestApproval`: always a shell command. */
export function commandPermission(params: Record<string, unknown>, callId: string): HarnessPermission {
  const command = commandLine(params.command);
  const cwd = text(params.cwd);
  return {
    callId,
    toolName: "shell",
    kind: "shell",
    surface: "shell",
    args: {
      ...(command ? { command } : {}),
      ...(cwd ? { cwd } : {}),
      ...(text(params.reason) ? { reason: text(params.reason) } : {}),
    },
    target: command ? { command } : {},
    offersAlways: true,
  };
}

/** The files a change touches, from the request's `fileChanges` or the item's own `changes`. */
export function changedFiles(fileChanges: unknown, itemChanges?: unknown): { path: string; kind: string }[] {
  const out: { path: string; kind: string }[] = [];
  if (isRecord(fileChanges)) {
    for (const [path, change] of Object.entries(fileChanges)) {
      const kind = isRecord(change) && typeof change.type === "string" ? change.type : "update";
      out.push({ path, kind });
      const moved = isRecord(change)
        ? text((change as CodexFileChange & { move_path?: unknown }).move_path)
        : undefined;
      if (moved) out.push({ path: moved, kind: "add" });
    }
  } else if (Array.isArray(itemChanges)) {
    for (const change of itemChanges) {
      if (!isRecord(change)) continue;
      const path = text(change.path);
      if (!path) continue;
      const kind =
        isRecord(change.kind) && typeof change.kind.type === "string"
          ? change.kind.type
          : String(change.kind ?? "update");
      out.push({ path, kind });
    }
  }
  return out;
}

/**
 * `item/fileChange/requestApproval`: one approval per request, listing every file (plan §3). A
 * change that only deletes is a `delete`; one outside the workspace, or one that asks to widen the
 * sandbox (`grantRoot`), is on the `system` surface, so it asks.
 */
export function fileChangePermission(
  params: Record<string, unknown>,
  callId: string,
  cwd: string,
  itemChanges?: unknown,
): HarnessPermission {
  const files = changedFiles(params.fileChanges, itemChanges);
  const outside = files.some((f) => insideWorkspace(f.path, cwd) === undefined);
  const grantRoot = text(params.grantRoot);
  const onlyDeletes = files.length > 0 && files.every((f) => f.kind === "delete");
  const first = files[0];
  const target: Target = {};
  if (first) target.path = insideWorkspace(first.path, cwd) ?? resolve(cwd, first.path);
  return {
    callId,
    toolName: "apply_patch",
    kind: onlyDeletes ? "delete" : "write",
    surface: outside || grantRoot ? "system" : "file",
    args: {
      files: files.map((f) => insideWorkspace(f.path, cwd) ?? resolve(cwd, f.path)),
      ...(text(params.reason) ? { reason: text(params.reason) } : {}),
      ...(grantRoot ? { grantRoot } : {}),
    },
    target,
    offersAlways: true,
  };
}

/** `mcpServer/elicitation/request`: a tool on one of Codex's own MCP servers. */
export function elicitationPermission(params: Record<string, unknown>, callId: string): HarnessPermission {
  const server = text(params.serverName) ?? "mcp";
  const message = text(params.message);
  // Codex names the tool inside its message ("Allow tool `search`?"); the server name is structured.
  const tool = (message && /`([^`]+)`/.exec(message)?.[1]) || server;
  const meta = isRecord(params._meta) ? params._meta : {};
  const input = isRecord(meta.tool_params) ? meta.tool_params : {};
  return {
    callId,
    toolName: `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_"),
    kind: "write",
    surface: "mcp",
    args: input,
    target: { mcp: { server, tool } },
    offersAlways: false,
  };
}

/** Steward's answer in Codex's words (plan §3). Always-for-session only when Steward offered Always. */
export function decisionFor(answer: PermissionAnswer): CodexDecision {
  switch (answer) {
    case "allow_once":
      return "accept";
    case "allow_always":
      return "acceptForSession";
    case "reject":
      return "decline";
    case "cancelled":
      return "cancel";
  }
}

/** The answer to an MCP elicitation. */
export function elicitationResponse(answer: PermissionAnswer): {
  action: "accept" | "decline" | "cancel";
  content: null;
  _meta: null;
} {
  const action =
    answer === "allow_once" || answer === "allow_always"
      ? "accept"
      : answer === "reject"
        ? "decline"
        : "cancel";
  return { action, content: null, _meta: null };
}

/** One model call's tokens, in AG-UI's terms. Codex's input count already includes the cached part. */
export function usageFrom(
  counts: CodexTokenCounts | undefined,
  model: string | undefined,
  provider: string,
): TokenUsage | undefined {
  if (!counts) return undefined;
  const n = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
  const input = n(counts.inputTokens);
  const output = n(counts.outputTokens);
  const total =
    n(counts.totalTokens) ??
    (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined);
  if (total === undefined) return undefined;
  const cached = n(counts.cachedInputTokens);
  const reasoning = n(counts.reasoningOutputTokens);
  return {
    provider,
    ...(model ? { model } : {}),
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    totalTokens: total,
    ...(cached ? { cachedInputTokens: cached } : {}),
    ...(reasoning ? { reasoningTokens: reasoning } : {}),
  };
}

/** A thread item's start in Steward's terms. */
export function itemStarted(item: CodexThreadItem, callId: string): HarnessUpdate[] {
  switch (item.type) {
    case "commandExecution": {
      const command = commandLine((item as { command?: unknown }).command);
      return [{ type: "tool_start", callId, name: "shell", input: { ...(command ? { command } : {}) } }];
    }
    case "fileChange":
      return [
        {
          type: "tool_start",
          callId,
          name: "apply_patch",
          input: { files: changedFiles(undefined, item.changes).map((f) => f.path) },
        },
      ];
    case "mcpToolCall": {
      const call = item as { server?: unknown; tool?: unknown; arguments?: unknown };
      return [
        {
          type: "tool_start",
          callId,
          name: `${String(call.server)}.${String(call.tool)}`,
          input: call.arguments ?? {},
        },
      ];
    }
    default:
      return [];
  }
}

/** A thread item's end in Steward's terms. `streamed` is true when its words already arrived as deltas. */
export function itemCompleted(item: CodexThreadItem, callId: string, streamed: boolean): HarnessUpdate[] {
  switch (item.type) {
    case "agentMessage": {
      const words = (item as { text?: unknown }).text;
      return !streamed && typeof words === "string" && words
        ? [{ type: "text", delta: words, messageId: item.id }]
        : [];
    }
    case "reasoning": {
      const summary = (item as { summary?: unknown }).summary;
      const words = Array.isArray(summary) ? summary.filter((s) => typeof s === "string").join("\n") : "";
      return words ? [{ type: "thought", delta: words, messageId: item.id }] : [];
    }
    case "commandExecution": {
      const run = item as { status?: unknown; exitCode?: unknown; aggregatedOutput?: unknown };
      const ok =
        run.status === "completed" &&
        (run.exitCode === 0 || run.exitCode === undefined || run.exitCode === null);
      const output =
        typeof run.aggregatedOutput === "string"
          ? run.aggregatedOutput
          : run.status === "declined"
            ? "Not run."
            : undefined;
      return [{ type: "tool_end", callId, ok, ...(output !== undefined ? { output } : {}) }];
    }
    case "fileChange": {
      const status = (item as { status?: unknown }).status;
      return [
        {
          type: "tool_end",
          callId,
          ok: status === "completed",
          output: status === "completed" ? "Changed." : `Not changed (${String(status ?? "unknown")}).`,
        },
      ];
    }
    case "mcpToolCall": {
      const call = item as { status?: unknown; result?: unknown; error?: unknown };
      const ok = call.status === "completed" && !call.error;
      let output: string | undefined;
      try {
        output = JSON.stringify(ok ? call.result : call.error) ?? undefined;
      } catch {
        output = undefined;
      }
      return [{ type: "tool_end", callId, ok, ...(output !== undefined ? { output } : {}) }];
    }
    default:
      return [];
  }
}
