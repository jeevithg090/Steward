// Agent Passport in the browser (P7): check a mandate offline with WebCrypto, the same way
// tempo_passport does in Python, so a company's web agent needs no server and no SDK.
// The canonical form is the Python one: keys sorted, no spaces, UTF-8 (fixtures/passport is the
// shared test vector). Reason codes are the shared ones; scope and revocation checks are the
// Gateway's job (POST /mandates/verify), this is the signature and the time window.

export type Reason = "ok" | "bad_signature" | "bad_key" | "unknown_version" | "expired" | "not_yet_valid";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Envelope {
  mandate: { [key: string]: Json };
  signature: { kind: string; credential?: { [key: string]: Json } | null };
}

const subtle = () => globalThis.crypto.subtle;
const text = new TextEncoder();

export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", bytes as BufferSource));
}

export async function digest(mandate: Envelope["mandate"]): Promise<Uint8Array> {
  return sha256(text.encode(canonical(mandate)));
}

/** A COSE EC2 key is a small CBOR map; read just enough of CBOR to get x and y. */
export function coseXY(cose: Uint8Array): { x: Uint8Array; y: Uint8Array } | null {
  let i = 0;
  const head = (): { major: number; value: number } => {
    const byte = cose[i++]!;
    const major = byte >> 5;
    let value = byte & 0x1f;
    if (value === 24) value = cose[i++]!;
    else if (value === 25) { value = (cose[i]! << 8) | cose[i + 1]!; i += 2; }
    else if (value > 25) throw new Error("unsupported CBOR length");
    return { major, value };
  };
  const item = (): number | Uint8Array => {
    const { major, value } = head();
    if (major === 0) return value;
    if (major === 1) return -1 - value;
    if (major === 2) { const out = cose.slice(i, i + value); i += value; return out; }
    throw new Error("unsupported CBOR item");
  };
  try {
    const { major, value } = head();
    if (major !== 5) return null;
    const map = new Map<number, number | Uint8Array>();
    for (let n = 0; n < value; n++) map.set(item() as number, item());
    const x = map.get(-2), y = map.get(-3);
    const ok = map.get(1) === 2 && map.get(3) === -7 && map.get(-1) === 1;
    return ok && x instanceof Uint8Array && y instanceof Uint8Array ? { x, y } : null;
  } catch {
    return null;
  }
}

/** ECDSA signatures come DER-encoded from authenticators; WebCrypto wants r and s side by side. */
export function derToRaw(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let i = 2;
  const part = (): Uint8Array | null => {
    if (der[i++] !== 0x02) return null;
    const len = der[i++]!;
    let bytes = der.slice(i, i + len);
    i += len;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length > 32) return null;
    const out = new Uint8Array(32);
    out.set(bytes, 32 - bytes.length);
    return out;
  };
  const r = part(), s = part();
  if (!r || !s) return null;
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Is the passkey signature over this exact mandate, and is it inside its time window? */
export async function verifyMandate(envelope: Envelope, now: Date): Promise<Reason> {
  const m = envelope.mandate;
  if (m.v !== 1) return "unknown_version";
  const key = (m.principal as { key?: { [k: string]: Json } })?.key ?? {};
  const xy = typeof key.public_key === "string" ? coseXY(fromB64url(key.public_key)) : null;
  const origins = Array.isArray(key.origins) ? key.origins : [];
  if (key.kind !== "webauthn-es256" || !xy || typeof key.rp_id !== "string" || origins.length === 0) return "bad_key";
  const response = envelope.signature.credential?.response as { [k: string]: string } | undefined;
  if (envelope.signature.kind !== "webauthn" || !response) return "bad_signature";
  try {
    const clientBytes = fromB64url(response.clientDataJSON!);
    const client = JSON.parse(new TextDecoder().decode(clientBytes)) as { type: string; challenge: string; origin: string };
    const auth = fromB64url(response.authenticatorData!);
    const flags = auth[32]!;
    const goodClient =
      client.type === "webauthn.get" && client.challenge === toB64url(await digest(m)) && origins.includes(client.origin);
    const goodAuth = equal(auth.slice(0, 32), await sha256(text.encode(key.rp_id))) && (flags & 0x01) !== 0 && (flags & 0x04) !== 0;
    const raw = derToRaw(fromB64url(response.signature!));
    if (!goodClient || !goodAuth || !raw) return "bad_signature";
    const jwk = { kty: "EC", crv: "P-256", x: toB64url(xy.x), y: toB64url(xy.y), ext: true };
    const publicKey = await subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signed = new Uint8Array([...auth, ...(await sha256(clientBytes))]);
    const valid = await subtle().verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, raw as BufferSource, signed as BufferSource);
    if (!valid) return "bad_signature";
  } catch {
    return "bad_signature";
  }
  if (now < new Date(String(m.issued_at))) return "not_yet_valid";
  if (now >= new Date(String(m.expires_at))) return "expired";
  return "ok";
}
