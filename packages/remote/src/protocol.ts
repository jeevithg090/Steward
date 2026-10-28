/**
 * Steward's relay protocol (docs/plans/phone-and-shortcuts.md §5). Three parties: the phone app,
 * the relay (which sees ids, timing, sizes and these method names, and nothing else), and the
 * bridge inside Steward, which dials out to the relay.
 */

/** The closed list of what a phone may ask Steward to do. Nothing else is ever routed. */
export const REMOTE_METHODS = [
  "approval.decide",
  "chat.send",
  "task.start",
  "task.hide",
  "routine.run",
  "run.stop",
  "brief.get",
] as const;
export type RemoteMethod = (typeof REMOTE_METHODS)[number];

export function isRemoteMethod(value: unknown): value is RemoteMethod {
  return typeof value === "string" && (REMOTE_METHODS as readonly string[]).includes(value);
}

/** Never remote-callable, named so reviews and tests can check it stays that way. */
export const NEVER_REMOTE = ["rules", "settings", "connections", "secrets", "shell", "computer"] as const;

/** RPC timing from Happy: wait 15 s for Steward to reconnect, give up on a call after 30 s. */
export const RPC_RECONNECT_GRACE_MS = 15_000;
export const RPC_TIMEOUT_MS = 30_000;
/** Pairing requests live two minutes and are used once. */
export const PAIRING_TTL_MS = 2 * 60_000;
/** A signed answer older or newer than this is refused. */
export const SIGNED_ANSWER_WINDOW_MS = 2 * 60_000;

/** One sealed entry in a device's log. `c` is base64 ciphertext under that device's data key. */
export interface Envelope {
  seq: number;
  localId: string;
  /** `approvals`, `notifications`, `today`, or `thread:<id>`. Ids only, never content. */
  topic: string;
  c: string;
  at: string;
}

/** What the relay sends Steward's bridge. */
export type ToMachine =
  | { type: "ready" }
  | { type: "rpc"; id: string; deviceId: string; method: RemoteMethod; c: string }
  | { type: "pair.hello"; pairingId: string; sealed: string }
  | { type: "presence"; deviceId: string; visible: boolean };

/** What the bridge sends the relay. */
export type FromMachine =
  | { type: "rpc.result"; id: string; c?: string; error?: string }
  | { type: "events"; deviceId: string; envelopes: { localId: string; topic: string; c: string }[] }
  | { type: "notify"; deviceId: string; localId: string; level: string; c: string }
  | { type: "pair.open"; pairingId: string; expiresAt: string }
  | { type: "pair.done"; pairingId: string; deviceId: string; sealed: string }
  | { type: "pair.refuse"; pairingId: string }
  | { type: "device.revoke"; deviceId: string };

/** What the relay sends a phone. */
export type ToDevice =
  | { type: "ready"; seq: number }
  | { type: "envelope"; envelope: Envelope }
  | { type: "rpc.result"; id: string; c?: string; error?: string }
  | { type: "revoked" }
  | { type: "error"; message: string };

/** What a phone sends the relay. */
export type FromDevice =
  | { type: "auth"; token: string; afterSeq?: number }
  | { type: "rpc"; id: string; method: RemoteMethod; c: string }
  | { type: "presence"; visible: boolean };

/** The phone's hello, sealed to the one-time pairing key. */
export interface PairHello {
  name: string;
  /** X25519 public key (base64), for sealing the data key and notification bodies to. */
  box: string;
  /** ECDSA P-256 public key (SPKI, base64), for signed answers. */
  sign: string;
  /** A WebAuthn credential made at pairing, when the phone supports one. */
  webauthn?: { id: string; publicKey: string };
}

/** What a phone collects once Steward confirmed: its relay token and its sealed data key. */
export interface PairReply {
  deviceId: string;
  token: string;
  /** The device's data key, wrapped to its box key. */
  sealed: string;
}

/** The parameters of every RPC, sealed: the method is repeated inside so the relay cannot swap it. */
export interface SealedCall<P = unknown> {
  method: RemoteMethod;
  params: P;
}

/** A signed answer to an approval. */
export interface SignedAnswer {
  approvalId: string;
  answer: "once" | "refuse";
  nonce: string;
  ts: number;
  /** ECDSA P-256 over `answerMessage(...)`, IEEE P1363 (r || s), base64. */
  sig: string;
  /** A WebAuthn assertion whose challenge is SHA-256 of the same message (Face ID checked). */
  webauthn?: { authenticatorData: string; clientDataJSON: string; signature: string };
}

/** The exact bytes a phone signs: fixed key order, the device named, so an answer cannot move. */
export function answerMessage(
  deviceId: string,
  a: Pick<SignedAnswer, "approvalId" | "answer" | "nonce" | "ts">,
): string {
  return JSON.stringify({
    v: 1,
    deviceId,
    approvalId: a.approvalId,
    answer: a.answer,
    nonce: a.nonce,
    ts: a.ts,
  });
}

/** The QR code: an https address on the relay, with the one-time key in the fragment (never sent). */
export function pairingUrl(relayUrl: string, pairingId: string, ephemeralPublicKey: string): string {
  const base = relayUrl.replace(/^ws/, "http").replace(/\/+$/, "");
  return `${base}/#pair=${pairingId}.${ephemeralPublicKey}`;
}

export function parsePairingFragment(hash: string): { pairingId: string; key: string } | undefined {
  const m = /^#?pair=([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(hash);
  return m ? { pairingId: m[1]!, key: m[2]! } : undefined;
}
