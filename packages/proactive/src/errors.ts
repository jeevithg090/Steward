/**
 * Every refusal from the proactive stores is a `ProactiveError` with a sentence a person can act on
 * and a code the server maps to an HTTP status, so routes never have to parse messages.
 */
export type ProactiveErrorCode = "invalid" | "not_found" | "conflict" | "limit" | "read_only";

const STATUS: Record<ProactiveErrorCode, number> = {
  invalid: 400,
  read_only: 403,
  not_found: 404,
  conflict: 409,
  limit: 409,
};

export class ProactiveError extends Error {
  readonly code: ProactiveErrorCode;
  /** The HTTP status the server should answer with. */
  readonly status: number;

  constructor(code: ProactiveErrorCode, message: string) {
    super(message);
    this.name = "ProactiveError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isProactiveError(value: unknown): value is ProactiveError {
  return value instanceof ProactiveError;
}

/** Trims `value` and refuses it when empty or longer than `max`, with the given sentence. */
export function requireText(value: unknown, max: number, emptyMessage: string, longMessage?: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ProactiveError("invalid", emptyMessage);
  if (text.length > max) {
    throw new ProactiveError("invalid", longMessage ?? `Keep it under ${max} characters.`);
  }
  return text;
}
