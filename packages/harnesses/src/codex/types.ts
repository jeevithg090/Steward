// Trimmed from Happy's happy-cli/src/codex/codexAppServerTypes.ts (MIT, Happy Coder Contributors),
// which cherry-picks `codex app-server generate-ts` (Codex 0.107.0). Only what Steward sends and reads.

export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexInitializeParams {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: { experimentalApi: boolean } | null;
}

/** `thread/start` and `thread/resume`: Steward always asks for `untrusted` and `workspace-write`. */
export interface CodexThreadParams {
  threadId?: string;
  model: string | null;
  modelProvider: string | null;
  cwd: string;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  config: Record<string, unknown> | null;
  baseInstructions: string | null;
  developerInstructions: string | null;
  persistExtendedHistory: boolean;
}

export interface CodexThreadResponse {
  thread: { id: string; [key: string]: unknown };
  model: string;
  modelProvider?: string;
}

export type CodexInputItem = { type: "text"; text: string };

export interface CodexTurnStartParams {
  threadId: string;
  input: CodexInputItem[];
  approvalPolicy: CodexApprovalPolicy;
  sandboxPolicy: { type: "workspaceWrite"; networkAccess?: boolean };
}

export type CodexThreadItem =
  | { type: "agentMessage"; id: string; text: string; phase?: string | null }
  | { type: "reasoning"; id: string; summary?: string[]; content?: string[] }
  | {
      type: "commandExecution";
      id: string;
      command: string | string[];
      cwd?: string;
      status?: string;
      aggregatedOutput?: string | null;
      exitCode?: number | null;
    }
  | { type: "fileChange"; id: string; changes?: unknown[]; status?: string }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status?: string;
      arguments?: unknown;
      result?: unknown;
      error?: unknown;
    }
  | ({ type: string; id: string } & Record<string, unknown>);

/** What Codex reports in `thread/tokenUsage/updated`: the thread's running total and the last call. */
export interface CodexTokenUsage {
  total?: CodexTokenCounts;
  last?: CodexTokenCounts;
  modelContextWindow?: number | null;
}

export interface CodexTokenCounts {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

/** The answers the v2 approval requests take (plan §3). */
export type CodexDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type CodexFileChange =
  | { type: "add"; content?: string }
  | { type: "delete"; content?: string }
  | { type: "update"; unified_diff?: string; move_path?: string | null };
