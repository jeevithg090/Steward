// Tempo Mesh in the browser (S5.2): this device's token, passkeys (Face ID, fingerprint,
// Windows Hello) through WebAuthn, pairing and Web Push. The Gateway verifies every signature.
import type { GatewayConfig, MissionView } from "./api";
import { type CompanyVerdict, type Envelope, verifyWithCompany as askCompany } from "./passport";

export const DEVICE_KEY = "tempo.device";
export const DEVICE_ID_KEY = "tempo.device.id";
/** A mandate this browser signed or fetched, kept so "Let the company check it" survives a reload. */
export const MANDATE_KEY_PREFIX = "tempo.mandate.";

export interface MeshConfig {
  rp_id: string;
  vapid_public_key: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  capabilities: string[];
  active: boolean;
  passkey: boolean;
  push: boolean;
  last_active: string;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function toBytes(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function toB64url(buffer: ArrayBuffer | null): string | null {
  if (buffer === null) return null;
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Json = Record<string, unknown>;

/** The Gateway's JSON options with their base64url fields turned into bytes, as WebAuthn wants. */
export function creationOptions(json: Json): CredentialCreationOptions {
  const user = json.user as Json;
  return {
    publicKey: {
      ...(json as unknown as PublicKeyCredentialCreationOptions),
      challenge: toBytes(json.challenge as string),
      user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: toBytes(user.id as string) },
      excludeCredentials: ((json.excludeCredentials as Json[] | undefined) ?? []).map((c) => ({
        ...(c as unknown as PublicKeyCredentialDescriptor),
        id: toBytes(c.id as string),
      })),
    },
  };
}

export function requestOptions(json: Json): CredentialRequestOptions {
  return {
    publicKey: {
      ...(json as unknown as PublicKeyCredentialRequestOptions),
      challenge: toBytes(json.challenge as string),
      allowCredentials: ((json.allowCredentials as Json[] | undefined) ?? []).map((c) => ({
        ...(c as unknown as PublicKeyCredentialDescriptor),
        id: toBytes(c.id as string),
      })),
    },
  };
}

/** A credential as the JSON the Gateway (py_webauthn) reads. */
export function credentialJson(credential: PublicKeyCredential): Json {
  const r = credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: toB64url(r.clientDataJSON) };
  if ("attestationObject" in r && r.attestationObject) response.attestationObject = toB64url(r.attestationObject);
  if ("authenticatorData" in r && r.authenticatorData) {
    response.authenticatorData = toB64url(r.authenticatorData);
    response.signature = toB64url(r.signature);
    response.userHandle = toB64url(r.userHandle);
  }
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
  };
}

export interface Authenticator {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

export class MeshClient {
  constructor(
    private readonly config: GatewayConfig,
    private readonly storage: Storage,
    private readonly authenticator: Authenticator = navigator.credentials,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get token(): string | null {
    return this.storage.getItem(DEVICE_KEY);
  }

  get deviceId(): string | null {
    return this.storage.getItem(DEVICE_ID_KEY);
  }

  private remember(token: string, id: string): void {
    this.storage.setItem(DEVICE_KEY, token);
    this.storage.setItem(DEVICE_ID_KEY, id);
  }

  private async call<T>(path: string, init: RequestInit = {}, auth: "device" | "owner" | "none" = "device"): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth === "device" && this.token) headers["X-Tempo-Device"] = this.token;
    if (auth === "owner") headers.Authorization = `Bearer ${this.config.token}`;
    const response = await this.fetchImpl(`${this.config.url}/mesh${path}`, { ...init, headers });
    if (!response.ok) {
      const detail = await response.json().then((b: { detail?: string }) => b.detail).catch(() => undefined);
      throw new Error(detail ?? `${init.method ?? "GET"} /mesh${path}: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  /** Mission Control's first device for a person (it holds the owner token). */
  async registerThisDevice(userId: string, name: string): Promise<DeviceInfo> {
    const body = JSON.stringify({ user_id: userId, name, capabilities: ["approve.biometric", "notifications.show"] });
    const made = await this.call<{ device: DeviceInfo; token: string }>("/devices", { method: "POST", body }, "owner");
    this.remember(made.token, made.device.id);
    return made.device;
  }

  devices = () => this.call<DeviceInfo[]>("/devices");
  remove = (id: string) => this.call<{ removed: boolean }>(`/devices/${id}`, { method: "DELETE" });

  async addPasskey(): Promise<DeviceInfo> {
    const started = await this.call<{ challenge_id: string; options: Json }>("/devices/me/passkey/options", { method: "POST" });
    const credential = (await this.authenticator.create(creationOptions(started.options))) as PublicKeyCredential | null;
    if (!credential) throw new Error("No passkey was made.");
    const body = JSON.stringify({ challenge_id: started.challenge_id, credential: credentialJson(credential) });
    return this.call<DeviceInfo>("/devices/me/passkey", { method: "POST", body });
  }

  /** Answer with Face ID (or the device's own lock): the yes or no is what gets signed. */
  async answer(requestId: string, approved: boolean): Promise<MissionView> {
    const limits = approved ? { auto_accept_max_gbp: "50" } : {};
    const started = await this.call<{ challenge_id: string; options: Json }>(`/approvals/${requestId}/options`, {
      method: "POST", body: JSON.stringify({ approved, limits }),
    });
    const credential = (await this.authenticator.get(requestOptions(started.options))) as PublicKeyCredential | null;
    if (!credential) throw new Error("Nothing was signed.");
    const body = JSON.stringify({ challenge_id: started.challenge_id, credential: credentialJson(credential) });
    return this.call<MissionView>(`/approvals/${requestId}`, { method: "POST", body });
  }

  /** Agent Passport: Face ID signs the mandate itself (the challenge is its digest). */
  async issueMandate(missionId: string): Promise<Record<string, unknown>> {
    const started = await this.call<{ challenge_id: string; options: Json }>("/mandates/options", {
      method: "POST", body: JSON.stringify({ mission_id: missionId }),
    });
    const credential = (await this.authenticator.get(requestOptions(started.options))) as PublicKeyCredential | null;
    if (!credential) throw new Error("Nothing was signed.");
    const body = JSON.stringify({ challenge_id: started.challenge_id, credential: credentialJson(credential) });
    return this.call<Record<string, unknown>>("/mandates", { method: "POST", body });
  }

  /** Sign a mandate with Face ID and keep the envelope on this device, exactly as a company sees it. */
  async signMandate(missionId: string): Promise<Envelope> {
    const envelope = (await this.issueMandate(missionId)) as unknown as Envelope;
    this.rememberEnvelope(envelope);
    return envelope;
  }

  rememberEnvelope(envelope: Envelope): void {
    const id = envelope.mandate.mandate_id;
    if (typeof id !== "string") return;
    try {
      this.storage.setItem(`${MANDATE_KEY_PREFIX}${id}`, JSON.stringify(envelope));
    } catch {
      /* storage full or locked: the envelope lasts until reload */
    }
  }

  storedEnvelope(mandateId: string): Envelope | null {
    try {
      const raw = this.storage.getItem(`${MANDATE_KEY_PREFIX}${mandateId}`);
      return raw ? (JSON.parse(raw) as Envelope) : null;
    } catch {
      return null;
    }
  }

  /** The signed mandate: from this device, else from the Gateway for one of the person's devices. */
  async envelope(mandateId: string): Promise<Envelope | null> {
    const kept = this.storedEnvelope(mandateId);
    if (kept) return kept;
    if (!this.token) return null;
    const fetched = await this.call<Envelope>(`/mandates/${encodeURIComponent(mandateId)}`);
    this.rememberEnvelope(fetched);
    return fetched;
  }

  /** Play the company: Tempo's public check (POST /mandates/verify, no login), as a company's agent calls it. */
  verifyWithCompany(envelope: Envelope, counterparty: string, action: string, amountGbp: string | null): Promise<CompanyVerdict> {
    return askCompany(this.config.url, { envelope, counterparty, action, amount_gbp: amountGbp }, this.fetchImpl);
  }

  startPairing = () => this.call<{ pairing_id: string; link: string; qr_svg: string; expires_at: string }>("/pairings", { method: "POST" });
  pairingStatus = (id: string) => this.call<{ claimed: boolean; code: string | null; device_name: string | null }>(`/pairings/${id}`);
  confirmPairing = (id: string) => this.call<DeviceInfo>(`/pairings/${id}/confirm`, { method: "POST" });

  /** On the new device: the link from the QR code. Returns the code to compare. */
  async claim(link: string, name: string): Promise<string> {
    const [pairingId, secret] = (link.split("#pair=")[1] ?? "").split(".");
    if (!pairingId || !secret) throw new Error("That isn't a Tempo pairing link.");
    const body = JSON.stringify({ secret, name, capabilities: ["approve.biometric", "notifications.show"] });
    const claimed = await this.call<{ device: DeviceInfo; token: string; code: string }>(
      `/pairings/${pairingId}/claim`, { method: "POST", body }, "none",
    );
    this.remember(claimed.token, claimed.device.id);
    return claimed.code;
  }

  /** The passkey RP id and the Web Push key (null when the Gateway has no VAPID key). */
  meshConfig = () => this.call<MeshConfig>("/config", {}, "none");

  /** Stop waking this device: the Gateway forgets its subscription, and the browser drops it. */
  async disablePush(): Promise<void> {
    await this.call("/devices/me/push", { method: "PUT", body: JSON.stringify({}) });
    try {
      const registration = await navigator.serviceWorker?.getRegistration("/sw.js");
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    } catch {
      /* nothing to unsubscribe in this browser */
    }
  }

  /** Web Push: the subscription goes to the Gateway; pushes will only ever say "sync". */
  async enablePush(): Promise<boolean> {
    const { vapid_public_key: key } = await this.call<{ vapid_public_key: string | null }>("/config", {}, "none");
    if (!key || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if ((await Notification.requestPermission()) !== "granted") return false;
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
    await this.call("/devices/me/push", { method: "PUT", body: JSON.stringify(subscription.toJSON()) });
    return true;
  }
}

export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

const UNREACHABLE = /Failed to fetch|NetworkError|Load failed|ECONNREFUSED|showcase:\/\//i;

/** Plain words for a Mesh or WebAuthn failure, saying what to do next. */
export function meshWords(err: unknown): string {
  const name = err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException) ? (err as Error).name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "NotAllowedError") return "Face ID or the fingerprint check was cancelled or timed out. Try again when you're ready.";
  if (name === "InvalidStateError") return "This device already holds a passkey for Tempo.";
  if (name === "SecurityError") return "This page isn't secure enough for Face ID. Open Tempo on localhost or over https.";
  if (name === "NotSupportedError") return "This browser can't make a passkey. Try Safari, Chrome or Edge.";
  if (UNREACHABLE.test(message)) return "I can't reach Tempo's Gateway. Check Settings, or try again in a moment.";
  if (/HTTP 5\d\d/.test(message)) return "The Gateway hit a problem. Try again in a moment.";
  const text = message.replace(/^(GET|POST|PUT|DELETE) \S+: /, "").trim();
  if (!text) return "Something went wrong. Try again.";
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
