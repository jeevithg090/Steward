// Key release on the device (spec §18, build plan S8.4): before a data key leaves this device,
// the worker must show a report signed by Tempo's deploy key, for an image on the signed
// allowlist, made in the last 60 s, with a nonce never seen before. The key is then wrapped to
// that worker's one-time public key (X25519, HKDF-SHA256, AES-256-GCM), for one step only.
// Mirrors tempo_crypto.worker_identity; fixtures/crypto holds the shared test vectors.
import { toB64url, toBytes } from "./mesh";

export interface WorkerReport {
  image_digest: string;
  ephemeral_pub: string;
  nonce: string;
  issued_at: string;
}

export interface SignedReport {
  report: WorkerReport;
  signature: string;
}

export const MAX_AGE_MS = 60_000;
const subtle = () => globalThis.crypto.subtle;
const utf8 = (s: string) => new TextEncoder().encode(s);

/** The same bytes Python signs: JSON with sorted keys and no spaces. */
export function canonical(report: WorkerReport): Uint8Array {
  const { ephemeral_pub, image_digest, issued_at, nonce } = report;
  return utf8(JSON.stringify({ ephemeral_pub, image_digest, issued_at, nonce }));
}

export function releaseContext(userId: string, missionId: string, step: string, nonce: string): Uint8Array {
  return utf8(`tempo-release|${userId}|${missionId}|${step}|${nonce}`);
}

export class ReleaseRefused extends Error {}

export async function verifyReport(
  signed: SignedReport, deployPub: Uint8Array, allowlist: string[], now: Date, seenNonces: Set<string>,
): Promise<WorkerReport> {
  const key = await subtle().importKey("raw", deployPub as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  const ok = await subtle().verify("Ed25519", key, toBytes(signed.signature), canonical(signed.report) as BufferSource);
  if (!ok) throw new ReleaseRefused("the report isn't signed by Tempo's deploy key");
  const { report } = signed;
  if (!allowlist.includes(report.image_digest)) throw new ReleaseRefused(`image ${report.image_digest} isn't on the signed allowlist`);
  if (Math.abs(now.getTime() - Date.parse(report.issued_at)) > MAX_AGE_MS) throw new ReleaseRefused("the report is stale");
  if (seenNonces.has(report.nonce)) throw new ReleaseRefused("the report was replayed");
  seenNonces.add(report.nonce);
  return report;
}

async function stepKey(shared: ArrayBuffer, devicePub: Uint8Array, workerPub: Uint8Array, context: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const salt = new Uint8Array([...devicePub, ...workerPub]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: context as BufferSource },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

/** device_pub (32) || iv (12) || AES-256-GCM(dataKey), with the context as additional data. */
export async function wrapForWorker(dataKey: Uint8Array, workerPub: Uint8Array, context: Uint8Array): Promise<Uint8Array> {
  const device = (await subtle().generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;
  const devicePub = new Uint8Array(await subtle().exportKey("raw", device.publicKey));
  const worker = await subtle().importKey("raw", workerPub as BufferSource, { name: "X25519" }, false, []);
  const shared = await subtle().deriveBits({ name: "X25519", public: worker }, device.privateKey, 256);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: context as BufferSource },
    await stepKey(shared, devicePub, workerPub, context), dataKey as BufferSource,
  );
  return new Uint8Array([...devicePub, ...iv, ...new Uint8Array(sealed)]);
}

/** The whole device-side check-then-release, for one mission step. */
export async function releaseKey(
  signed: SignedReport, dataKey: Uint8Array, opts: {
    deployPub: Uint8Array; allowlist: string[]; userId: string; missionId: string; step: string;
    now?: Date; seenNonces: Set<string>;
  },
): Promise<{ wrapped: string; context: string }> {
  const report = await verifyReport(signed, opts.deployPub, opts.allowlist, opts.now ?? new Date(), opts.seenNonces);
  const context = releaseContext(opts.userId, opts.missionId, opts.step, report.nonce);
  const wrapped = await wrapForWorker(dataKey, new Uint8Array(toBytes(report.ephemeral_pub)), context);
  return { wrapped: toB64url(wrapped.buffer as ArrayBuffer)!, context: new TextDecoder().decode(context) };
}
