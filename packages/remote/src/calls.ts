/**
 * What goes inside the seal for each call, answer and event (docs/plans/phone-and-shortcuts.md §5).
 * The relay carries these but cannot read them, and it is not trusted to keep them in order or
 * apart: everything that says which call or which topic a sealed blob belongs to is inside it.
 *
 * - A call names its method, a random `callId` and the time it was made. Steward refuses a call
 *   whose method differs from the outer one, a `callId` it has seen, or a time too far from now, so
 *   the relay cannot swap, resend or hold back a call for later.
 * - An answer names the `callId` it answers, so the relay cannot give one call's answer to another.
 * - An event names its topic, so the relay cannot file an approval under a conversation.
 */
import { fromBase64, randomBytes, toBase64, toBase64Url } from "./bytes.ts";
import { type DataKey, decryptPayload, encryptPayload } from "./payload.ts";
import { isRemoteMethod, type RemoteMethod, SIGNED_ANSWER_WINDOW_MS } from "./protocol.ts";

/** The parameters of every RPC, sealed with the method, a one-time id and the time. */
export interface SealedCall<P = unknown> {
  method: RemoteMethod;
  params: P;
  /** Random and used once. Steward refuses an id it has seen; its answer carries the id back. */
  callId: string;
  /** When the phone made the call, in ms. A call outside `SIGNED_ANSWER_WINDOW_MS` is refused. */
  ts: number;
}

/** Steward's answer to one call, naming that call. */
export type SealedResult<T = unknown> = { callId: string } & (
  | { ok: true; value: T }
  | { ok: false; error: string; status: number }
);

/** One event in a phone's log, sealed with the topic it was sent under. */
export interface SealedEvent<T = unknown> {
  topic: string;
  value: T;
}

const CALL_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Opens sealed text as JSON, or undefined for anything that is not base64 or does not open. */
async function open<T>(key: DataKey, c: string): Promise<T | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(c);
  } catch {
    return undefined;
  }
  return decryptPayload<T>(key, bytes);
}

/** Seals a call. Returns the sealed text and its `callId`, to match against the answer. */
export async function sealCall(
  key: DataKey,
  method: RemoteMethod,
  params: unknown,
  now: number = Date.now(),
): Promise<{ c: string; callId: string }> {
  const callId = toBase64Url(randomBytes(16));
  const call: SealedCall = { method, params, callId, ts: now };
  return { c: toBase64(await encryptPayload(key, call)), callId };
}

/**
 * Opens a call on Steward's side: `undefined` when it does not open, or when the method inside is
 * not the one the relay named; `"old"` when it has no id and time (an app from before they were
 * added); otherwise the call. Whether the id was used before, and whether the time is recent, are
 * the caller's to check (`callIsFresh`), because only it keeps the ids it has seen.
 */
export async function openCall(
  key: DataKey,
  c: string,
  outerMethod: string,
): Promise<SealedCall | "old" | undefined> {
  const call = await open<Partial<SealedCall>>(key, c);
  if (!call || !isRemoteMethod(call.method) || call.method !== outerMethod) return undefined;
  if (typeof call.callId !== "string" || !CALL_ID.test(call.callId) || typeof call.ts !== "number") {
    return "old";
  }
  return call as SealedCall;
}

/** True when a call was made within the window of now. */
export function callIsFresh(call: Pick<SealedCall, "ts">, now: number = Date.now()): boolean {
  return Number.isFinite(call.ts) && Math.abs(now - call.ts) <= SIGNED_ANSWER_WINDOW_MS;
}

export async function sealResult(key: DataKey, result: SealedResult): Promise<string> {
  return toBase64(await encryptPayload(key, result));
}

/** Opens an answer on the phone: `undefined` unless it opens and answers exactly this call. */
export async function openResult<T = unknown>(
  key: DataKey,
  c: string,
  callId: string,
): Promise<SealedResult<T> | undefined> {
  const result = await open<SealedResult<T>>(key, c);
  return result && typeof result === "object" && result.callId === callId ? result : undefined;
}

export async function sealEvent(key: DataKey, topic: string, value: unknown): Promise<string> {
  const event: SealedEvent = { topic, value };
  return toBase64(await encryptPayload(key, event));
}

/** Opens an event on the phone: its value, or `undefined` unless it was sealed under this topic. */
export async function openEvent<T = unknown>(
  key: DataKey,
  envelope: { topic: string; c: string },
): Promise<T | undefined> {
  const event = await open<SealedEvent<T>>(key, envelope.c);
  return event && typeof event === "object" && event.topic === envelope.topic ? event.value : undefined;
}
