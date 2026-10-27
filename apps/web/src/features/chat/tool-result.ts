/**
 * Reads a tool result the way the runtime hands it to the browser.
 *
 * A server tool's result reaches a renderer as a string. Three things can be wrapped around the data
 * inside it, in either order, and this undoes all of them:
 *
 * - JSON encoding, sometimes twice: a string that parses to another string is parsed again
 *   (OpenDuet found server tool text arriving double-encoded through the runtime).
 * - Steward's governed outcome, the `ToolResultEnvelope` from `@steward/shared`: ok, refused,
 *   parked (waiting for the person) or error.
 * - The taint wrapper `{ untrusted, notice, data }` around content Steward does not trust, such as
 *   a web page or an email. The data is still shown; the notice says where it came from.
 */

export type ToolOutcome =
  /** The call has not returned yet. */
  | { status: "pending" }
  | { status: "ok"; data: unknown; untrusted?: UntrustedMark }
  | { status: "refused"; message: string; rule?: string }
  /** The gateway asked the person. The approval card carries the rest. */
  | { status: "parked"; message: string; approvalId?: string }
  | { status: "error"; message: string };

export interface UntrustedMark {
  /** Plain words on where the content came from, when the server gave them. */
  notice?: string;
}

/** How many layers of encoding and wrapping are undone before giving up. Guards against cycles. */
const MAX_LAYERS = 6;

/** Parses a JSON string, and parses again while the result is still a JSON-looking string. */
export function decodeJson(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < MAX_LAYERS && typeof current === "string"; i++) {
    const text = current.trim();
    if (!looksLikeJson(text)) return current;
    try {
      current = JSON.parse(text);
    } catch {
      return current;
    }
  }
  return current;
}

function looksLikeJson(text: string): boolean {
  if (text === "") return false;
  const first = text[0];
  return (
    first === "{" ||
    first === "[" ||
    first === '"' ||
    text === "true" ||
    text === "false" ||
    text === "null" ||
    /^-?\d/.test(text)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Whether a value is Steward's taint wrapper. `untrusted` may be `true` or a source name. */
function isUntrustedWrapper(value: Record<string, unknown>): boolean {
  return Boolean(value.untrusted) && "data" in value;
}

/**
 * A call the AI SDK turned away before Steward saw it comes back as plain text, `Error: ...`, not as
 * an envelope. The usual case is arguments that did not fit the tool's schema; the model is told and
 * tries again, so the person needs a quiet line, not the validator's dump of the arguments.
 */
function sdkFailure(result: string): ToolOutcome | undefined {
  const text = result.trim();
  if (!text.startsWith("Error:")) return undefined;
  if (/^Error: Invalid input for tool\b/.test(text)) {
    return { status: "error", message: "That didn't come out right the first time, so Steward tried again." };
  }
  const message = text.slice("Error:".length).trim();
  return {
    status: "error",
    message: message.length > 200 ? `${message.slice(0, 199)}…` : message || "Something went wrong.",
  };
}

/**
 * Turns a renderer's `result` string into a tool outcome. `undefined` means the call is still
 * running. Anything that is not an envelope is treated as successful data, so tools that return
 * plain JSON or plain text still render.
 */
export function readToolResult(result: string | undefined | null): ToolOutcome {
  if (result === undefined || result === null) return { status: "pending" };
  const failure = sdkFailure(result);
  if (failure) return failure;
  let value = decodeJson(result);
  let untrusted: UntrustedMark | undefined;

  for (let layer = 0; layer < MAX_LAYERS; layer++) {
    if (!isRecord(value)) break;

    if (isUntrustedWrapper(value)) {
      untrusted = { notice: text(value.notice) ?? untrusted?.notice };
      value = decodeJson(value.data);
      continue;
    }

    if (value.ok === true && "data" in value) {
      value = decodeJson(value.data);
      continue;
    }

    if (value.ok === false) {
      if (value.refused === true) {
        return {
          status: "refused",
          message: text(value.message) ?? text(value.reason) ?? "Steward's rules did not allow this.",
          ...(text(value.rule) ? { rule: text(value.rule) } : {}),
        };
      }
      if (value.parked === true) {
        return {
          status: "parked",
          message: text(value.message) ?? "Waiting for your answer.",
          ...(text(value.approvalId) ? { approvalId: text(value.approvalId) } : {}),
        };
      }
      return {
        status: "error",
        message: text(value.error) ?? text(value.message) ?? "Something went wrong.",
      };
    }
    break;
  }

  return untrusted ? { status: "ok", data: value, untrusted } : { status: "ok", data: value };
}

/** The data of a successful outcome, or undefined for any other outcome. */
export function okData(outcome: ToolOutcome): unknown {
  return outcome.status === "ok" ? outcome.data : undefined;
}

/**
 * Picks a list out of a result: the value itself when it is an array, otherwise the first array
 * found under one of `keys` (`{ emails: [...] }`, `{ results: [...] }`).
 */
export function listFrom<T = unknown>(data: unknown, keys: readonly string[]): T[] | undefined {
  const decoded = decodeJson(data);
  if (Array.isArray(decoded)) return decoded as T[];
  if (!isRecord(decoded)) return undefined;
  for (const key of keys) {
    const inner = decodeJson(decoded[key]);
    if (Array.isArray(inner)) return inner as T[];
  }
  return undefined;
}

/** Picks an object out of a result: the value itself, or the object under one of `keys`. */
export function recordFrom(data: unknown, keys: readonly string[] = []): Record<string, unknown> | undefined {
  const decoded = decodeJson(data);
  if (!isRecord(decoded)) return undefined;
  for (const key of keys) {
    const inner = decodeJson(decoded[key]);
    if (isRecord(inner)) return inner;
  }
  return decoded;
}

/** A refusal in the words the person sees: "Refused by your rule ‘No payments’". */
export function refusalHeadline(outcome: Extract<ToolOutcome, { status: "refused" }>): string {
  return outcome.rule ? `Refused by your rule ‘${outcome.rule}’` : "Refused";
}
