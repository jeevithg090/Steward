import type { TokenUsage } from "@ag-ui/client";
import type { Target, ToolKind, ToolSurface } from "@steward/shared";

/**
 * What every harness backend (ACP, Codex app-server) turns its protocol into, so one `HarnessAgent`
 * can turn it into AG-UI events and Steward approvals.
 */

/** Something the harness said or did during a turn. */
export type HarnessUpdate =
  | { type: "text"; delta: string; messageId?: string }
  | { type: "thought"; delta: string; messageId?: string }
  | {
      type: "tool_start";
      /** The harness's own id for the call. Unique within its session. */
      callId: string;
      /** Its own tool name when it gives one (`Bash`, `edit_file`); otherwise a name from its kind. */
      name: string;
      input: unknown;
    }
  | {
      type: "tool_end";
      callId: string;
      ok: boolean;
      /** What the tool returned, as text, when the harness says. */
      output?: string;
    };

/** A permission the harness asked for, already in Steward's terms. */
export interface HarnessPermission {
  /** The harness's id for the call this permission is about. */
  callId: string;
  /** Shown in the record and on the card: the harness's own tool name, or one from its kind. */
  toolName: string;
  kind: ToolKind;
  surface: ToolSurface;
  /** The structured input, exactly as the harness sent it. Recorded redacted. */
  args: Record<string, unknown>;
  /** From structured fields only (paths, commands, URLs), never from a title. */
  target: Target;
  /** The harness offers to remember an Allow for this kind of call. */
  offersAlways: boolean;
}

/** How a permission was answered, in Steward's terms; each backend maps it onto its own. */
export type PermissionAnswer = "allow_once" | "allow_always" | "reject" | "cancelled";

/** How a turn ended. */
export interface TurnEnd {
  stopReason: "end_turn" | "cancelled" | "refusal" | "max_tokens" | "error";
  /** What it used, per provider and model, when the harness reports it. */
  usage?: TokenUsage[];
  /** For `error`: what went wrong, in plain words. */
  error?: string;
}

/** What a backend tells the session while it runs. */
export interface BackendEvents {
  update(update: HarnessUpdate): void;
  /** Resolves with the answer to send back. May wait as long as the person takes to decide. */
  permission(request: HarnessPermission): Promise<PermissionAnswer>;
  /** The process went away on its own. */
  exited(reason: string): void;
}

/**
 * One harness process serving one conversation. `start` spawns and opens (or reopens) a session;
 * `prompt` runs a turn until it ends; `cancel` asks the turn to stop; `close` ends the process.
 */
export interface HarnessBackend {
  start(opts: { resumeHandle?: string }): Promise<{ handle: string; resumed: boolean }>;
  prompt(text: string): Promise<TurnEnd>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  /** The process id, while it runs. For tests and the record. */
  readonly pid: number | undefined;
}

export type BackendFactory = (opts: { cwd: string; events: BackendEvents }) => HarnessBackend;
