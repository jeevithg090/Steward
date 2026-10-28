/**
 * The one error type the gateway throws from its stores. `code` lets the server pick an HTTP status
 * without parsing messages: `invalid` → 400, `forbidden` → 403, `not_found` → 404, `conflict` → 409.
 * Messages are plain words meant for the person.
 */
export type GatewayErrorCode = "invalid" | "forbidden" | "not_found" | "conflict";

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;

  constructor(code: GatewayErrorCode, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

export function isGatewayError(err: unknown): err is GatewayError {
  return err instanceof GatewayError;
}

/** The message of anything thrown, without stack or class name. */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
