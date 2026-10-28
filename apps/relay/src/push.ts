import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
} from "node:crypto";
import type { PushSubscriptionJson } from "./store.ts";

/**
 * Web Push with no third-party library: the message encryption of RFC 8291 (`aes128gcm`) and VAPID
 * (RFC 8292). What goes inside is already sealed by Steward with the device's own key, so the push
 * service, Apple and Google, and this relay see only an opaque blob and a level.
 */

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

const hmac = (key: Uint8Array, data: Uint8Array) =>
  new Uint8Array(createHmac("sha256", key).update(data).digest());
const cat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const text = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

/** HKDF-Expand for one block, which is all RFC 8291 needs. */
const expand = (prk: Uint8Array, info: Uint8Array, length: number) =>
  hmac(prk, cat(info, new Uint8Array([1]))).slice(0, length);

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url: the `applicationServerKey` a phone subscribes with. */
  publicKey: string;
  /** PKCS#8 PEM. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const raw = cat(new Uint8Array([4]), fromB64u(jwk.x!), fromB64u(jwk.y!));
  return { publicKey: b64u(raw), privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
}

/** RFC 8291: encrypts `payload` for one subscription. Returns the request body. */
export function encryptPush(
  subscription: PushSubscriptionJson,
  payload: Uint8Array,
  salt = randomBytes(16),
): Uint8Array {
  const uaPublic = fromB64u(subscription.keys.p256dh);
  const authSecret = fromB64u(subscription.keys.auth);
  const ecdh = createECDH("prime256v1");
  const asPublic = new Uint8Array(ecdh.generateKeys());
  const shared = new Uint8Array(ecdh.computeSecret(uaPublic));
  const prkKey = hmac(authSecret, shared);
  const ikm = expand(prkKey, cat(text("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic), 32);
  const prk = hmac(new Uint8Array(salt), ikm);
  const cek = expand(prk, cat(text("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = expand(prk, cat(text("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = cat(cipher.update(cat(payload, new Uint8Array([2]))), cipher.final(), cipher.getAuthTag());
  const header = new Uint8Array(21 + asPublic.length);
  header.set(new Uint8Array(salt), 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return cat(header, body);
}

/** RFC 8291 in reverse, with the subscriber's private key. For tests. */
export function decryptPush(
  body: Uint8Array,
  uaPrivate: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
): Uint8Array {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const asPublic = body.slice(21, 21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = new Uint8Array(ecdh.computeSecret(asPublic));
  const prkKey = hmac(authSecret, shared);
  const ikm = expand(prkKey, cat(text("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic), 32);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, cat(text("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = expand(prk, cat(text("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const data = body.slice(21 + idLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.slice(-16));
  const plain = cat(decipher.update(data.slice(0, -16)), decipher.final());
  const end = plain.lastIndexOf(2);
  return plain.slice(0, end);
}

/** RFC 8292: the `Authorization` header for one push service. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
): string {
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const key: KeyObject = createPrivateKey(keys.privateKey);
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export type PushOutcome = "sent" | "suppressed" | "no_subscription" | "gone" | "failed";

export interface PushOptions {
  keys: VapidKeys;
  subject: string;
  urgency?: "high" | "normal";
  /** Push services answer within this, or the push counts as failed. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Sends one push. `gone` means the subscription is dead and should be forgotten (404, 410). */
export async function sendPush(
  subscription: PushSubscriptionJson,
  payload: Uint8Array,
  opts: PushOptions,
): Promise<PushOutcome> {
  const body = encryptPush(subscription, payload);
  try {
    const res = await (opts.fetch ?? fetch)(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, opts.keys, opts.subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: opts.urgency ?? "normal",
      },
      body: body as BodyInit,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
