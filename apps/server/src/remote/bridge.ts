import { randomBytes } from "node:crypto";
import type { BaseEvent } from "@ag-ui/client";
import {
  boxKeyPairFromSecretKey,
  confirmationCode,
  decryptPayload,
  encryptPayload,
  type FromMachine,
  fromBase64,
  openJson,
  PAIRING_TTL_MS,
  type PairHello,
  pairingUrl,
  type SealedCall,
  type ToMachine,
  toBase64,
  toBase64Url,
  wrapDataKey,
} from "@steward/remote";
import type { Device, LiveEvent } from "@steward/shared";
import WebSocket from "ws";
import type { StewardServices } from "../context.ts";
import { HttpError } from "../http/errors.ts";
import { handleRpc, keysOf } from "./rpc.ts";

/**
 * The bridge (docs/plans/phone-and-shortcuts.md §5.1): Steward dials OUT to its relay over WSS, so
 * nothing listens beyond this machine. It answers the phone app's sealed calls from the closed list,
 * seals live events for each paired app with that app's own key, and sends sealed notifications.
 * The relay sees ids, sizes, timing and method names; never content.
 */

/** AG-UI events a phone sees while a chat it started runs. Tool arguments and results stay here. */
const LIVE_AGUI = new Set([
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TEXT_MESSAGE_CHUNK",
]);

export type PairingState = "waiting" | "check" | "paired" | "refused" | "expired";

interface Pairing {
  secretKey: Uint8Array;
  publicKey: string;
  expiresAt: number;
  hello?: PairHello;
  code?: string;
  state: PairingState;
  deviceId?: string;
}

export interface RemoteStatus {
  configured: boolean;
  connected: boolean;
  url?: string;
}

export class RemoteBridge {
  private ws: WebSocket | undefined;
  private ready = false;
  private stopped = false;
  private backoff = 1000;
  private timer: NodeJS.Timeout | undefined;
  private readonly pairings = new Map<string, Pairing>();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly connectedWaiters = new Set<() => void>();

  constructor(
    private readonly s: StewardServices,
    private readonly relay: { url: string; token: string },
  ) {}

  /** The relay's https origin: the phone app's origin, and WebAuthn's relying party. */
  get origin(): string {
    return new URL(this.relay.url.replace(/^ws/, "http")).origin;
  }

  status(): RemoteStatus {
    return { configured: true, connected: this.ready, url: this.origin };
  }

  start(): void {
    this.stopped = false;
    this.unsubscribe.push(this.s.bus.subscribe((event) => void this.onLive(event)));
    this.unsubscribe.push(
      this.s.devices.onRevoke((device) => {
        if (device.kind === "pwa") this.send({ type: "device.revoke", deviceId: device.id });
      }),
    );
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const off of this.unsubscribe.splice(0)) off();
    const ws = this.ws;
    this.ws = undefined;
    this.ready = false;
    if (ws && ws.readyState !== ws.CLOSED) {
      await new Promise<void>((done) => {
        ws.once("close", () => done());
        ws.terminate();
      });
    }
  }

  /** Resolves once the relay answered `ready`. Tests use it; the app does not wait. */
  whenConnected(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The relay did not answer.")), timeoutMs);
      this.connectedWaiters.add(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private connect(): void {
    if (this.stopped) return;
    const url = `${this.relay.url.replace(/\/+$/, "")}/v1/machine`;
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.relay.token}` },
      maxPayload: 256 * 1024,
    });
    this.ws = ws;
    ws.on("message", (data) => {
      let frame: ToMachine;
      try {
        frame = JSON.parse(String(data)) as ToMachine;
      } catch {
        return;
      }
      void this.onFrame(frame).catch((err: unknown) =>
        console.error("[steward] relay frame failed:", err instanceof Error ? err.message : err),
      );
    });
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.ws = undefined;
      if (this.stopped) return;
      this.timer = setTimeout(() => this.connect(), this.backoff);
      this.timer.unref?.();
      this.backoff = Math.min(this.backoff * 2, 30_000);
    });
    ws.on("error", () => {
      // "close" follows and reconnects.
    });
  }

  private send(frame: FromMachine): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private async onFrame(frame: ToMachine): Promise<void> {
    switch (frame.type) {
      case "ready":
        this.ready = true;
        this.backoff = 1000;
        for (const waiter of [...this.connectedWaiters]) {
          this.connectedWaiters.delete(waiter);
          waiter();
        }
        // Pairings opened while the relay was away.
        for (const [id, p] of this.pairings) {
          if (p.state === "waiting")
            this.send({ type: "pair.open", pairingId: id, expiresAt: new Date(p.expiresAt).toISOString() });
        }
        return;
      case "pair.hello":
        await this.onHello(frame.pairingId, frame.sealed);
        return;
      case "rpc":
        await this.onRpc(frame.id, frame.deviceId, frame.method, frame.c);
        return;
      case "presence":
        return;
    }
  }

  // ── Pairing ────────────────────────────────────────────────────────────────────────────

  /** Opens a two-minute, one-time pairing and returns the QR address (the key in its fragment). */
  openPairing(): { pairingId: string; url: string; expiresAt: string } {
    if (!this.ready)
      throw new HttpError(409, "Steward can't reach its relay right now. Check STEWARD_RELAY_URL.");
    this.sweep();
    const pair = boxKeyPairFromSecretKey(new Uint8Array(randomBytes(32)));
    const pairingId = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    const publicKey = toBase64Url(pair.publicKey);
    this.pairings.set(pairingId, { secretKey: pair.secretKey, publicKey, expiresAt, state: "waiting" });
    this.send({ type: "pair.open", pairingId, expiresAt: new Date(expiresAt).toISOString() });
    return {
      pairingId,
      url: pairingUrl(this.relay.url, pairingId, publicKey),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  pairing(id: string): {
    state: PairingState;
    name?: string;
    code?: string;
    expiresAt: string;
    deviceId?: string;
  } {
    this.sweep();
    const p = this.pairings.get(id);
    if (!p) return { state: "expired", expiresAt: new Date().toISOString() };
    return {
      state: p.state,
      expiresAt: new Date(p.expiresAt).toISOString(),
      ...(p.hello ? { name: p.hello.name } : {}),
      ...(p.code ? { code: p.code } : {}),
      ...(p.deviceId ? { deviceId: p.deviceId } : {}),
    };
  }

  private async onHello(pairingId: string, sealed: string): Promise<void> {
    const p = this.pairings.get(pairingId);
    if (p?.state !== "waiting" || p.expiresAt <= Date.now()) return;
    const hello = await openJson<PairHello>(fromBase64(sealed), p.secretKey);
    if (
      !hello ||
      typeof hello.name !== "string" ||
      typeof hello.box !== "string" ||
      typeof hello.sign !== "string"
    ) {
      return;
    }
    p.hello = { ...hello, name: hello.name.slice(0, 60) || "Phone" };
    p.code = await confirmationCode(toBase64(fromBase64(p.publicKey)), hello.box, hello.sign);
    p.state = "check";
  }

  /** The person saw the same code on both screens and confirmed on the Mac. */
  async confirmPairing(id: string): Promise<Device> {
    this.sweep();
    const p = this.pairings.get(id);
    if (p?.state !== "check" || !p.hello) {
      throw new HttpError(409, "That pairing is no longer waiting. Start again.");
    }
    const dataKey = new Uint8Array(randomBytes(32));
    const keys = {
      box: p.hello.box,
      sign: p.hello.sign,
      ...(p.hello.webauthn ? { webauthn: p.hello.webauthn } : {}),
    };
    const device = this.s.devices.issueRemote({
      deviceName: p.hello.name,
      publicKey: JSON.stringify(keys),
      dataKey: toBase64(dataKey),
    });
    const sealed = toBase64(await wrapDataKey(dataKey, fromBase64(p.hello.box)));
    this.send({ type: "pair.done", pairingId: id, deviceId: device.id, sealed });
    p.state = "paired";
    p.deviceId = device.id;
    p.secretKey.fill(0);
    return device;
  }

  refusePairing(id: string): void {
    const p = this.pairings.get(id);
    if (!p) return;
    p.state = "refused";
    p.secretKey.fill(0);
    this.send({ type: "pair.refuse", pairingId: id });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, p] of this.pairings) {
      if (p.expiresAt + 60_000 <= now) this.pairings.delete(id);
      else if (p.expiresAt <= now && (p.state === "waiting" || p.state === "check")) p.state = "expired";
    }
  }

  // ── Calls from a phone ─────────────────────────────────────────────────────────────────

  private dataKey(deviceId: string): Uint8Array | undefined {
    const key = this.s.devices.remoteKey(deviceId);
    return key ? fromBase64(key) : undefined;
  }

  private async onRpc(id: string, deviceId: string, method: SealedCall["method"], c: string): Promise<void> {
    const reply = (frame: { c?: string; error?: string }) => this.send({ type: "rpc.result", id, ...frame });
    const key = this.dataKey(deviceId);
    const device = key ? this.s.devices.get(deviceId) : undefined;
    const keys = keysOf(device ? this.s.devices.publicKey(deviceId) : undefined);
    if (!key || !device || device.revokedAt || !keys)
      return reply({ error: "This phone isn't paired any more." });
    const call = await decryptPayload<SealedCall>(key, fromBase64(c));
    // The method is repeated inside the seal, so a relay that swapped the outer name is caught.
    if (!call || call.method !== method) return reply({ error: "That request could not be read." });
    this.s.devices.touch(device);
    let result: { ok: true; value: unknown } | { ok: false; error: string; status: number };
    try {
      const value = await handleRpc(
        {
          s: this.s,
          device,
          keys,
          relayOrigin: this.origin,
          follow: (threadId) => this.follower(device.id, threadId),
        },
        method,
        call.params,
      );
      result = { ok: true, value };
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const error =
        err instanceof HttpError ? err.message : "Something went wrong on Steward's side. Try again.";
      if (!(err instanceof HttpError))
        console.error("[steward] a phone call failed:", err instanceof Error ? err.message : err);
      result = { ok: false, error, status };
    }
    reply({ c: toBase64(await encryptPayload(key, result)) });
  }

  // ── Live events ─────────────────────────────────────────────────────────────────────────

  /** Seals the allow-listed AG-UI events of one run to one phone, under `thread:<id>`. */
  private follower(deviceId: string, threadId: string): (event: unknown) => void {
    return (event) => {
      const e = event as BaseEvent & Record<string, unknown>;
      if (!LIVE_AGUI.has(String(e.type))) return;
      void this.seal(deviceId, `thread:${threadId}`, e);
    };
  }

  private async seal(deviceId: string, topic: string, value: unknown, notify?: string): Promise<void> {
    const key = this.dataKey(deviceId);
    if (!key) return;
    const c = toBase64(await encryptPayload(key, value));
    const localId = randomBytes(12).toString("hex");
    if (notify) this.send({ type: "notify", deviceId, localId, level: notify, c });
    else this.send({ type: "events", deviceId, envelopes: [{ localId, topic, c }] });
  }

  private async onLive(event: LiveEvent): Promise<void> {
    if (!this.ready) return;
    for (const device of this.s.devices.remoteDevices()) {
      switch (event.type) {
        case "approval.created":
        case "approval.decided":
          if (!device.scopes.includes("approvals:read")) break;
          await this.seal(device.id, "approvals", {
            type: event.type,
            item: this.s.deviceApi.item(device, event.approval),
          });
          if (event.type === "approval.created") {
            await this.seal(
              device.id,
              "notifications",
              {
                title: "Steward needs your answer",
                body: event.approval.summary,
                href: `#approval=${event.approval.id}`,
              },
              "needs_you",
            );
          }
          break;
        case "notification":
          await this.seal(
            device.id,
            "notifications",
            { title: event.notification.title, body: event.notification.body, href: "#today" },
            event.notification.level,
          );
          break;
        case "task.updated":
        case "brief.ready":
          await this.seal(device.id, "today", { type: event.type });
          break;
        default:
          break;
      }
    }
  }
}
