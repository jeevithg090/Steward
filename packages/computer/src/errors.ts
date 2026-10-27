/**
 * Every refusal or failure the computer reports is a `ComputerError` with a stable `code`, so the
 * agent can map it to a tool result and the model gets one plain sentence it can act on. Messages
 * never quote typed text, secrets or file contents: Playwright errors can echo their arguments, so
 * they are mapped to our own sentences before they leave this package.
 */
export type ComputerErrorCode =
  /** The ref is not on the page any more, or the element under it changed. */
  | "stale_ref"
  /** The person used the screen (or the page changed); look again before acting. */
  | "snapshot_required"
  /** The person holds the wheel, or Steward is waiting for their help. */
  | "person_has_control"
  /** The network policy refused the address. */
  | "blocked"
  | "bad_url"
  | "bad_input"
  | "bad_path"
  | "not_found"
  | "too_large"
  | "not_text"
  /** Something else is already waiting (one secret request at a time). */
  | "busy"
  /** The computer stopped while this was running. */
  | "closed"
  | "timeout"
  | "failed";

export class ComputerError extends Error {
  readonly code: ComputerErrorCode;

  constructor(code: ComputerErrorCode, message: string) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
  }
}

export function isComputerError(error: unknown): error is ComputerError {
  return error instanceof ComputerError;
}

/** The sentences the agent and the web app may rely on. */
export const MESSAGES = {
  personHasControl: "The person has control of the screen right now.",
  waitingForHelp: "Steward asked the person for help and is waiting for them to hand the screen back.",
  takeTheWheelFirst: "Take the wheel before using the screen.",
  snapshotAfterHandback:
    "The person used the screen since your last look. Take a new snapshot before acting on the page.",
  noSnapshot: "There is no snapshot of this page yet. Take a snapshot first and use the refs it returns.",
  stillFinishing: "Steward is still finishing an action. Try taking the wheel again in a moment.",
  computerStopped: "The computer stopped. Start it again to carry on.",
} as const;

export function staleRef(ref: string, why?: string): ComputerError {
  const reason = why ? ` ${why}` : "";
  return new ComputerError(
    "stale_ref",
    `Stale ref ${ref}:${reason} take a new snapshot and use the refs it returns.`,
  );
}

/** First line of an unknown error, short, for failures where the message cannot carry typed text. */
export function briefCause(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = text.split("\n")[0] ?? "";
  return first.replace(/^\w+\.\w+:\s*/, "").slice(0, 200);
}

/** True for the Playwright errors raised when a navigation replaced the page mid-call. */
export function isNavigationRace(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /Execution context was destroyed|frame was detached|navigating|interrupted by another navigation/i.test(
    text,
  );
}
