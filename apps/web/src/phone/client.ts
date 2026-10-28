import {
  answerMessage,
  challengeFor,
  confirmationCode,
  decryptPayload,
  type Envelope,
  encryptPayload,
  exportPublicKey,
  fromBase64,
  generateSigningKey,
  importDataKey,
  type PairHello,
  type PairReply,
  type RemoteMethod,
  randomBytes,
  sealJson,
  signText,
  type ToDevice,
  toBase64,
  toBase64Url,
  unwrapDataKey,
} from "@steward/remote";

/**
 * The phone app's side of the relay (docs/plans/phone-and-shortcuts.md §5.2–§5.5). Every key is a
 * WebCrypto key made non-extractable and kept in IndexedDB, never localStorage: the box key that
 * received the data key, the data key itself, and the key that signs answers. Script on this page
 * can use them but never read them back.
 */

const DB = "steward-phone";

export interface StoredDevice {
  deviceId: string;
  /** The relay token (not a content key): it lets this phone connect, nothing more. */
  token: string;
  name: string;
  dataKey: CryptoKey;
  signKey: CryptoKey;
  webauthnId?: string;
  lastSeq: number;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const req = run(conn.transaction("keys", mode).objectStore("keys"));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const loadDevice = () => idb<StoredDevice | undefined>("readonly", (s) => s.get("device"));
export const saveDevice = (d: StoredDevice) => idb<void>("readwrite", (s) => s.put(d, "device"));
export const forgetDevice = () => idb<void>("readwrite", (s) => s.delete("device"));

/** True when this browser can keep an X25519 key in WebCrypto (Safari 17+, Chrome 133+). */
async function x25519(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;
}

/** Makes a Face ID credential for this phone, when the browser offers one. Needs a tap first. */
async function registerWebAuthn(name: string): Promise<{ id: string; publicKey: string } | undefined> {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) return undefined;
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: "Steward", id: location.hostname },
        user: { id: randomBytes(16) as BufferSource, name, displayName: name },
        challenge: randomBytes(32) as BufferSource,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          userVerification: "required",
          residentKey: "discouraged",
          authenticatorAttachment: "platform",
        },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    const response = credential?.response as AuthenticatorAttestationResponse | undefined;
    const spki = response?.getPublicKey?.();
    if (!credential || !spki) return undefined;
    return { id: toBase64Url(new Uint8Array(credential.rawId)), publicKey: toBase64(new Uint8Array(spki)) };
  } catch {
    return undefined;
  }
}

export interface PairingStart {
  code: string;
  /** Resolves once Steward was confirmed on the Mac and the keys are stored. */
  done: Promise<StoredDevice>;
}

/**
 * Pairs: makes this phone's keys, seals its hello to the one-time key from the QR code, shows the
 * code to compare with the Mac, then collects the sealed data key once the person confirms there.
 */
export async function startPairing(
  pairingId: string,
  oneTimeKey: string,
  name: string,
): Promise<PairingStart> {
  const box = await x25519();
  const sign = await generateSigningKey(false);
  const boxPublic = toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", box.publicKey)));
  const signPublic = await exportPublicKey(sign.publicKey);
  const webauthn = await registerWebAuthn(name);
  const hello: PairHello = { name, box: boxPublic, sign: signPublic, ...(webauthn ? { webauthn } : {}) };
  const sealed = toBase64(await sealJson(hello, fromBase64(oneTimeKey)));
  const res = await fetch(`/v1/pair/${pairingId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sealed }),
  });
  if (res.status !== 202) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Pairing didn't start. Make a new code on your Mac.");
  }
  const code = await confirmationCode(toBase64(fromBase64(oneTimeKey)), boxPublic, signPublic);
  const done = (async () => {
    const until = Date.now() + 2 * 60_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(`/v1/pair/${pairingId}`);
      if (poll.status === 202) continue;
      if (!poll.ok) {
        const body = (await poll.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Pairing was not confirmed.");
      }
      const reply = (await poll.json()) as PairReply;
      const raw = await unwrapDataKey(fromBase64(reply.sealed), box.privateKey);
      if (!raw) throw new Error("Steward's reply could not be opened. Pair again.");
      const device: StoredDevice = {
        deviceId: reply.deviceId,
        token: reply.token,
        name,
        dataKey: await importDataKey(raw),
        signKey: sign.privateKey,
        ...(webauthn ? { webauthnId: webauthn.id } : {}),
        lastSeq: 0,
      };
      raw.fill(0);
      await saveDevice(device);
      return device;
    }
    throw new Error("Pairing timed out. Make a new code on your Mac.");
  })();
  return { code, done };
}

export type Status = "connecting" | "online" | "offline" | "revoked";

/** One live connection to the relay: sealed calls out, sealed events in. */
export class RemoteClient {
  private ws: WebSocket | undefined;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private retry = 1000;
  private closed = false;

  constructor(
    private device: StoredDevice,
    private readonly on: { envelope(topic: string, value: unknown): void; status(status: Status): void },
  ) {}

  connect(): void {
    this.closed = false;
    this.on.status("connecting");
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/v1/device`);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: this.device.token, afterSeq: this.device.lastSeq }));
      ws.send(JSON.stringify({ type: "presence", visible: document.visibilityState === "visible" }));
    };
    ws.onmessage = (message) => void this.onFrame(JSON.parse(String(message.data)) as ToDevice);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      for (const p of this.pending.values()) p.reject(new Error("The connection dropped. Try again."));
      this.pending.clear();
      if (this.closed) return;
      this.on.status("offline");
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    };
    document.addEventListener("visibilitychange", this.presence);
  }

  close(): void {
    this.closed = true;
    document.removeEventListener("visibilitychange", this.presence);
    this.ws?.close();
  }

  private presence = () => {
    this.ws?.send(JSON.stringify({ type: "presence", visible: document.visibilityState === "visible" }));
  };

  private async onFrame(frame: ToDevice): Promise<void> {
    switch (frame.type) {
      case "ready":
        this.retry = 1000;
        this.on.status("online");
        return;
      case "envelope":
        await this.onEnvelope(frame.envelope);
        return;
      case "rpc.result": {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id);
        if (frame.error) return p.reject(new Error(frame.error));
        const result = await decryptPayload<{ ok: true; value: unknown } | { ok: false; error: string }>(
          this.device.dataKey,
          fromBase64(frame.c ?? ""),
        );
        if (!result) return p.reject(new Error("Steward's answer could not be opened."));
        if (result.ok) p.resolve(result.value);
        else p.reject(new Error(result.error));
        return;
      }
      case "revoked":
        this.closed = true;
        this.on.status("revoked");
        await forgetDevice();
        return;
      case "error":
        if (/isn't paired/.test(frame.message)) {
          this.closed = true;
          this.on.status("revoked");
          await forgetDevice();
        }
        return;
    }
  }

  private async onEnvelope(envelope: Envelope): Promise<void> {
    const value = await decryptPayload(this.device.dataKey, fromBase64(envelope.c));
    if (envelope.seq > this.device.lastSeq) {
      this.device = { ...this.device, lastSeq: envelope.seq };
      void saveDevice(this.device);
    }
    if (value !== undefined) this.on.envelope(envelope.topic, value);
  }

  /** One call from the closed list. The method is sealed inside too, so the relay cannot swap it. */
  async call<T>(method: RemoteMethod, params: unknown = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Not connected to Steward yet.");
    const id = toBase64Url(randomBytes(8));
    const c = toBase64(await encryptPayload(this.device.dataKey, { method, params }));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ type: "rpc", id, method, c }));
    });
  }

  /**
   * Signs an answer with this phone's key. When Steward read untrusted content before asking to
   * send, delete or run something, Face ID checks the person first, for this answer only.
   */
  async answer(approvalId: string, answer: "once" | "refuse", withFaceId = false): Promise<{ say: string }> {
    const nonce = toBase64Url(randomBytes(16));
    const ts = Date.now();
    const message = answerMessage(this.device.deviceId, { approvalId, answer, nonce, ts });
    const sig = await signText(this.device.signKey, message);
    let webauthn: { authenticatorData: string; clientDataJSON: string; signature: string } | undefined;
    if (withFaceId && this.device.webauthnId) {
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: (await challengeFor(message)) as BufferSource,
          allowCredentials: [{ type: "public-key", id: fromBase64(this.device.webauthnId) as BufferSource }],
          userVerification: "required",
          rpId: location.hostname,
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      const r = assertion?.response as AuthenticatorAssertionResponse | undefined;
      if (!r) throw new Error("Face ID was cancelled, so nothing was answered.");
      webauthn = {
        authenticatorData: toBase64(new Uint8Array(r.authenticatorData)),
        clientDataJSON: toBase64(new Uint8Array(r.clientDataJSON)),
        signature: toBase64(new Uint8Array(r.signature)),
      };
    }
    return this.call("approval.decide", {
      approvalId,
      answer,
      nonce,
      ts,
      sig,
      ...(webauthn ? { webauthn } : {}),
    });
  }

  get canFaceId(): boolean {
    return Boolean(this.device.webauthnId);
  }
}

/** Turns on notifications: registers the service worker and gives the relay this phone's push address. */
export async function enablePush(device: StoredDevice): Promise<"on" | "denied" | "unsupported"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const registration = await navigator.serviceWorker.register("/sw.js");
  const { publicKey } = (await (await fetch("/v1/push/key")).json()) as { publicKey: string };
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  const res = await fetch("/v1/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${device.token}` },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return res.ok ? "on" : "unsupported";
}
