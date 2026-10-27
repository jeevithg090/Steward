/**
 * The agent's computer: a Chromium profile, a workspace folder and a restricted shell.
 * Implemented by `@steward/computer`; the live screen reaches the web app over
 * `WS /ws/computer/:agentId` using the messages below.
 */

export type Controller = "agent" | "person";

export interface ComputerStatus {
  agentId: string;
  running: boolean;
  url?: string;
  title?: string;
  controller: Controller;
  /** Set while the agent is waiting for the person to do something on its screen. */
  help?: { reason: string; requestedAt: string };
  /** Set while the agent is waiting for a secret typed into the secret box. */
  secret?: SecretRequest;
  viewport: { width: number; height: number };
}

export interface SecretRequest {
  id: string;
  /** The field the value goes into, from the page snapshot. */
  ref: string;
  /** "Password for example.com". */
  label: string;
  /** Host of the page asking. Shown so the person can check it. */
  host: string;
  requestedAt: string;
}

/** One line in the Activity tab: what the agent ran, read or saved. */
export interface ActivityItem {
  id: string;
  at: string;
  agentId: string;
  toolCallId?: string;
  kind:
    | "navigate"
    | "click"
    | "type"
    | "key"
    | "scroll"
    | "snapshot"
    | "file"
    | "shell"
    | "secret"
    | "help"
    | "control";
  /** "Opened news.ycombinator.com", "Ran `ls -la`", "Saved report.md (2.1 KB)". */
  text: string;
  /** Short output preview for shell commands and reads; never secrets, never file contents. */
  output?: string;
  ok: boolean;
}

export interface WorkspaceFile {
  path: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}

/** Server → client on `WS /ws/computer/:agentId`. */
export type ComputerServerMessage =
  | { type: "frame"; data: string; mime: "image/jpeg"; width: number; height: number }
  | { type: "status"; status: ComputerStatus }
  | { type: "activity"; item: ActivityItem }
  | { type: "error"; message: string };

/** Client → server on `WS /ws/computer/:agentId`. Input is accepted only while the person has control. */
export type ComputerClientMessage =
  | { type: "take" }
  | { type: "release" }
  | {
      type: "mouse";
      action: "move" | "down" | "up" | "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
    }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; action: "down" | "up" | "press"; key: string; text?: string }
  | { type: "text"; text: string }
  | { type: "navigate"; url: string }
  /** The secret box. The value goes to the page and nowhere else. */
  | { type: "secret"; requestId: string; value: string }
  | { type: "secret.cancel"; requestId: string };

/** What a browser tool returns to the model after acting. */
export interface PageObservation {
  url: string;
  title: string;
  /** An accessibility snapshot in YAML-ish text with `[ref=e12]` markers the model uses to target elements. */
  snapshot: string;
  /** True when the snapshot was cut to fit; the model can scroll or ask for more. */
  truncated: boolean;
}

export interface ShellResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** The computer as the agent and server see it. One per agent id. */
export interface Computer {
  readonly agentId: string;
  status(): ComputerStatus;
  navigate(url: string): Promise<PageObservation>;
  snapshot(): Promise<PageObservation>;
  click(ref: string): Promise<PageObservation>;
  type(ref: string, text: string, opts?: { submit?: boolean }): Promise<PageObservation>;
  press(key: string): Promise<PageObservation>;
  scroll(direction: "up" | "down", amount?: number): Promise<PageObservation>;
  back(): Promise<PageObservation>;
  /** Resolves a ref to the element it names, for the gateway's target. */
  describe(ref: string): Promise<{ role?: string; name?: string } | undefined>;
  /** Asks the person to take the wheel; resolves when they release it. */
  requestHelp(reason: string, opts?: { signal?: AbortSignal }): Promise<{ released: boolean }>;
  /** Asks for a secret via the secret box; resolves once it has been typed into the field. Never returns the value. */
  requestSecret(
    ref: string,
    label: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ filled: boolean; length: number }>;
  listFiles(dir?: string): Promise<WorkspaceFile[]>;
  readFile(path: string, opts?: { maxBytes?: number }): Promise<string>;
  writeFile(path: string, content: string): Promise<WorkspaceFile>;
  runShell(command: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ShellResult>;
  activity(limit?: number): ActivityItem[];
  close(): Promise<void>;
}
