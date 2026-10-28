// RPC routing adapted from happy-server sources/app/api/socket/rpcHandler.ts and presence-aware push
// from sources/app/push/{pushDispatch,focusTracker}.ts (slopus/happy, MIT, Copyright (c) 2026 Happy
// Coder Contributors): the 15 s reconnect grace, the 30 s timeout, failing fast when the target
// leaves, and not notifying a phone that has the app open. Rewritten on `ws` for one person and one
// machine, with an allow-list of methods.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { serve } from "@hono/node-server";
import {
  type FromDevice,
  type FromMachine,
  isRemoteMethod,
  PAIRING_TTL_MS,
  RPC_RECONNECT_GRACE_MS,
  RPC_TIMEOUT_MS,
  type ToDevice,
  type ToMachine,
} from "@steward/remote";
import { Hono } from "hono";
import { type WebSocket, WebSocketServer } from "ws";
import { generateVapidKeys, type PushOutcome, sendPush, type VapidKeys } from "./push.ts";
import { type PushSubscriptionJson, RelayStore } from "./store.ts";

/**
 * Steward's relay (docs/plans/phone-and-shortcuts.md §5.1): it serves the phone app's files and
 * passes ciphertext between a phone and the person's own Steward, which dials out to it. It sees
 * ids, timing, sizes, IP addresses and RPC method names; never a key and never plaintext. What it
 * logs is the same list.
 */

export interface RelayOptions {
  /** `:memory:` in tests. */
  dbPath: string;
  /** The token Steward's bridge presents (`RELAY_MACHINE_TOKEN`, the same as `STEWARD_RELAY_TOKEN`). */
  machineToken: string;
  /** The relay's own https address: the phone app's origin, and WebAuthn's relying party. */
  publicUrl: string;
  /** The phone app's built files (`apps/web/dist-phone`). */
  staticDir?: string;
  vapidSubject?: string;
  /** Lets push endpoints be plain http on this machine. Tests only. */
  allowInsecurePush?: boolean;
  /** One JSON line per thing that happened: ids, sizes, outcomes. Never ciphertext. */
  log?: (line: Record<string, unknown>) => void;
  graceMs?: number;
  timeoutMs?: number;
  pairingTtlMs?: number;
  fetch?: typeof fetch;
}

export interface Relay {
  readonly store: RelayStore;
  readonly vapid: VapidKeys;
  listen(port?: number, host?: string): Promise<{ url: string; port: number }>;
  close(): Promise<void>;
}

const MAX_FRAME = 256 * 1024;
const AUTH_WINDOW_MS = 5_000;

interface DeviceSocket {
  ws: WebSocket;
  visible: boolean;
}

interface Pending {
  socket: DeviceSocket;
  deviceRpcId: string;
  timer: NodeJS.Timeout;
}

interface Pairing {
  expiresAt: number;
  hello?: string;
  reply?: { deviceId: string; token: string; sealed: string };
  refused?: boolean;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(ws: WebSocket | undefined, frame: ToDevice | ToMachine): void {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

export function createRelay(opts: RelayOptions): Relay {
  if (opts.machineToken.length < 24) throw new Error("RELAY_MACHINE_TOKEN must be at least 24 characters.");
  const store = new RelayStore(opts.dbPath);
  const log = opts.log ?? ((line) => console.log(JSON.stringify(line)));
  const graceMs = opts.graceMs ?? RPC_RECONNECT_GRACE_MS;
  const timeoutMs = opts.timeoutMs ?? RPC_TIMEOUT_MS;
  const pairingTtl = opts.pairingTtlMs ?? PAIRING_TTL_MS;
  const origin = new URL(opts.publicUrl).origin;

  const vapid: VapidKeys = (() => {
    const saved = store.setting("vapid");
    if (saved) return JSON.parse(saved) as VapidKeys;
    const made = generateVapidKeys();
    store.setSetting("vapid", JSON.stringify(made));
    return made;
  })();

  let machine: WebSocket | undefined;
  const machineWaiters = new Set<() => void>();
  const devices = new Map<string, Set<DeviceSocket>>();
  const pending = new Map<string, Pending>();
  const pairings = new Map<string, Pairing>();

  const sweepPairings = () => {
    const now = Date.now();
    for (const [id, p] of pairings) if (p.expiresAt <= now) pairings.delete(id);
  };

  const visible = (deviceId: string) => [...(devices.get(deviceId) ?? [])].some((s) => s.visible);

  const toDevice = (deviceId: string, frame: ToDevice) => {
    for (const s of devices.get(deviceId) ?? []) send(s.ws, frame);
  };

  const notify = async (
    deviceId: string,
    level: string,
    c: string,
    localId: string,
  ): Promise<PushOutcome> => {
    // A phone with the app open on screen sees the envelope live; a push would only interrupt it.
    if (visible(deviceId)) return "suppressed";
    const subscription = store.push(deviceId);
    if (!subscription) return "no_subscription";
    const outcome = await sendPush(subscription, Buffer.from(JSON.stringify({ level, c, localId })), {
      keys: vapid,
      subject: opts.vapidSubject ?? "mailto:relay@localhost",
      urgency: level === "needs_you" ? "high" : "normal",
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    if (outcome === "gone") store.clearPush(deviceId);
    return outcome;
  };

  const onMachineFrame = async (frame: FromMachine) => {
    switch (frame.type) {
      case "rpc.result": {
        const call = pending.get(frame.id);
        if (!call) return;
        pending.delete(frame.id);
        clearTimeout(call.timer);
        send(call.socket.ws, {
          type: "rpc.result",
          id: call.deviceRpcId,
          ...(frame.c ? { c: frame.c } : {}),
          ...(frame.error ? { error: frame.error } : {}),
        });
        log({ event: "rpc.result", bytes: frame.c?.length ?? 0, ok: !frame.error });
        return;
      }
      case "events": {
        const added = store.append(frame.deviceId, frame.envelopes);
        for (const envelope of added) toDevice(frame.deviceId, { type: "envelope", envelope });
        log({ event: "events", deviceId: frame.deviceId, count: added.length });
        return;
      }
      case "notify": {
        const [envelope] = store.append(frame.deviceId, [
          { localId: frame.localId, topic: "notifications", c: frame.c },
        ]);
        if (envelope) toDevice(frame.deviceId, { type: "envelope", envelope });
        const outcome = await notify(frame.deviceId, frame.level, frame.c, frame.localId);
        log({ event: "notify", deviceId: frame.deviceId, level: frame.level, outcome });
        return;
      }
      case "pair.open":
        sweepPairings();
        if (/^[0-9a-f]{32}$/.test(frame.pairingId)) {
          pairings.set(frame.pairingId, {
            expiresAt: Math.min(Date.parse(frame.expiresAt), Date.now() + pairingTtl),
          });
        }
        log({ event: "pair.open", pairingId: frame.pairingId });
        return;
      case "pair.done": {
        const p = pairings.get(frame.pairingId);
        if (!p?.hello || p.reply || p.refused || p.expiresAt <= Date.now()) return;
        if (!/^dev_[A-Za-z0-9_-]{6,64}$/.test(frame.deviceId)) return;
        const token = store.createDevice(frame.deviceId);
        p.reply = { deviceId: frame.deviceId, token, sealed: frame.sealed };
        log({ event: "pair.done", pairingId: frame.pairingId, deviceId: frame.deviceId });
        return;
      }
      case "pair.refuse": {
        const p = pairings.get(frame.pairingId);
        if (p) p.refused = true;
        return;
      }
      case "device.revoke":
        store.revoke(frame.deviceId);
        for (const s of devices.get(frame.deviceId) ?? []) {
          send(s.ws, { type: "revoked" });
          s.ws.close(4403, "revoked");
        }
        devices.delete(frame.deviceId);
        log({ event: "revoke", deviceId: frame.deviceId });
        return;
    }
  };

  /** Forwards a phone's call, waiting up to the grace for Steward to come back. */
  const forward = (socket: DeviceSocket, deviceId: string, frame: Extract<FromDevice, { type: "rpc" }>) => {
    const fail = (error: string) => send(socket.ws, { type: "rpc.result", id: frame.id, error });
    if (!isRemoteMethod(frame.method)) {
      log({ event: "rpc.refused", deviceId, method: String(frame.method).slice(0, 40) });
      fail("A phone can't ask for that.");
      return;
    }
    const go = () => {
      const id = randomBytes(12).toString("hex");
      const timer = setTimeout(() => {
        pending.delete(id);
        fail("Steward didn't answer in time.");
      }, timeoutMs);
      pending.set(id, { socket, deviceRpcId: frame.id, timer });
      send(machine, { type: "rpc", id, deviceId, method: frame.method, c: frame.c });
      log({ event: "rpc", deviceId, method: frame.method, bytes: frame.c.length });
    };
    if (machine) return go();
    let waiter: () => void = () => {};
    const timer = setTimeout(() => {
      machineWaiters.delete(waiter);
      fail("Steward is offline. Check the computer it runs on.");
    }, graceMs);
    waiter = () => {
      clearTimeout(timer);
      go();
    };
    machineWaiters.add(waiter);
  };

  // ── HTTP ─────────────────────────────────────────────────────────────────────────────────

  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "no-referrer");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set(
      "Content-Security-Policy",
      `default-src 'self'; connect-src 'self' ${origin.replace(/^http/, "ws")}; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
  });

  const deviceOf = (header: string | undefined) => {
    const token = /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];
    return token ? store.deviceForToken(token) : undefined;
  };

  app.get("/v1/health", (c) => c.json({ ok: true, machine: Boolean(machine) }));
  app.get("/v1/push/key", (c) => c.json({ publicKey: vapid.publicKey }));

  app.post("/v1/pair/:id", async (c) => {
    sweepPairings();
    const p = pairings.get(c.req.param("id"));
    if (!p) return c.json({ error: "That pairing code has expired. Make a new one on your Mac." }, 404);
    if (p.hello) return c.json({ error: "That pairing code was already used." }, 409);
    const body = (await c.req.json().catch(() => ({}))) as { sealed?: unknown };
    if (typeof body.sealed !== "string" || body.sealed.length > 8192)
      return c.json({ error: "Send the sealed hello." }, 400);
    p.hello = body.sealed;
    send(machine, { type: "pair.hello", pairingId: c.req.param("id"), sealed: body.sealed });
    log({ event: "pair.hello", pairingId: c.req.param("id"), bytes: body.sealed.length });
    return c.json({ waiting: true }, 202);
  });

  app.get("/v1/pair/:id", (c) => {
    sweepPairings();
    const id = c.req.param("id");
    const p = pairings.get(id);
    if (!p) return c.json({ error: "That pairing has expired." }, 404);
    if (p.refused) {
      pairings.delete(id);
      return c.json({ error: "Pairing was cancelled on the Mac." }, 410);
    }
    if (!p.reply) return c.json({ waiting: true }, 202);
    // Collected once: the reply carries the phone's relay token.
    pairings.delete(id);
    c.header("Cache-Control", "no-store");
    return c.json(p.reply);
  });

  app.get("/v1/envelopes", (c) => {
    const deviceId = deviceOf(c.req.header("authorization"));
    if (!deviceId) return c.json({ error: "This phone isn't paired." }, 401);
    const after = Number(c.req.query("after_seq") ?? 0);
    return c.json({
      envelopes: store.after(deviceId, Number.isInteger(after) && after >= 0 ? after : 0),
      seq: store.latestSeq(deviceId),
    });
  });

  app.post("/v1/push/subscribe", async (c) => {
    const deviceId = deviceOf(c.req.header("authorization"));
    if (!deviceId) return c.json({ error: "This phone isn't paired." }, 401);
    const body = (await c.req.json().catch(() => ({}))) as Partial<PushSubscriptionJson>;
    let endpoint: URL;
    try {
      endpoint = new URL(String(body.endpoint));
    } catch {
      return c.json({ error: "That push subscription has no address." }, 400);
    }
    const local = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost";
    if (endpoint.protocol !== "https:" && !(opts.allowInsecurePush && local)) {
      return c.json({ error: "Push addresses must be https." }, 400);
    }
    if (typeof body.keys?.p256dh !== "string" || typeof body.keys?.auth !== "string") {
      return c.json({ error: "That push subscription has no keys." }, 400);
    }
    store.setPush(deviceId, {
      endpoint: endpoint.href,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    log({ event: "push.subscribe", deviceId, host: endpoint.hostname });
    return c.body(null, 204);
  });

  // The phone app: static files, and index.html for everything else under /.
  const root = opts.staticDir ? resolve(opts.staticDir) : undefined;
  app.get("*", (c) => {
    if (!root || !existsSync(root))
      return c.text("The Steward phone app is not built. Run: pnpm --filter @steward/web build:phone", 404);
    let pathname = "/";
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text("Not found", 404);
    }
    const path = normalize(join(root, pathname));
    const file =
      path.startsWith(root) && existsSync(path) && statSync(path).isFile() ? path : join(root, "index.html");
    if (!existsSync(file)) return c.text("Not found", 404);
    const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    const headers: Record<string, string> = { "Content-Type": type };
    if (file.endsWith("sw.js") || file.endsWith(".html")) headers["Cache-Control"] = "no-cache";
    return c.body(readFileSync(file), 200, headers);
  });

  // ── WebSockets ───────────────────────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });

  const acceptMachine = (ws: WebSocket) => {
    if (machine && machine !== ws) machine.close(4000, "replaced");
    machine = ws;
    log({ event: "machine.connected" });
    send(ws, { type: "ready" });
    for (const waiter of [...machineWaiters]) {
      machineWaiters.delete(waiter);
      waiter();
    }
    ws.on("message", (data) => {
      let frame: FromMachine;
      try {
        frame = JSON.parse(String(data)) as FromMachine;
      } catch {
        return;
      }
      void onMachineFrame(frame).catch((err: unknown) =>
        log({ event: "machine.error", error: String(err).slice(0, 200) }),
      );
    });
    ws.on("close", () => {
      if (machine !== ws) return;
      machine = undefined;
      log({ event: "machine.disconnected" });
      // Calls already sent will get no answer: say so now rather than after the timeout.
      for (const [id, call] of pending) {
        clearTimeout(call.timer);
        pending.delete(id);
        send(call.socket.ws, {
          type: "rpc.result",
          id: call.deviceRpcId,
          error: "Steward went offline. Try again.",
        });
      }
    });
  };

  const acceptDevice = (ws: WebSocket) => {
    let deviceId: string | undefined;
    const socket: DeviceSocket = { ws, visible: false };
    const authTimer = setTimeout(() => {
      if (!deviceId) ws.close(4401, "auth");
    }, AUTH_WINDOW_MS);
    ws.on("message", (data) => {
      let frame: FromDevice;
      try {
        frame = JSON.parse(String(data)) as FromDevice;
      } catch {
        return;
      }
      if (!deviceId) {
        if (frame.type !== "auth") return;
        deviceId = store.deviceForToken(frame.token);
        clearTimeout(authTimer);
        if (!deviceId) {
          send(ws, { type: "error", message: "This phone isn't paired any more." });
          ws.close(4401, "auth");
          return;
        }
        const set = devices.get(deviceId) ?? new Set();
        set.add(socket);
        devices.set(deviceId, set);
        send(ws, { type: "ready", seq: store.latestSeq(deviceId) });
        for (const envelope of store.after(deviceId, Math.max(0, Number(frame.afterSeq) || 0))) {
          send(ws, { type: "envelope", envelope });
        }
        log({ event: "device.connected", deviceId });
        return;
      }
      if (frame.type === "rpc" && typeof frame.id === "string" && typeof frame.c === "string") {
        if (!store.isActive(deviceId)) {
          send(ws, { type: "revoked" });
          ws.close(4403, "revoked");
          return;
        }
        forward(socket, deviceId, frame);
      } else if (frame.type === "presence") {
        socket.visible = frame.visible === true;
        send(machine, { type: "presence", deviceId, visible: visible(deviceId) });
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      if (deviceId) devices.get(deviceId)?.delete(socket);
    });
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? "/", "http://relay").pathname;
    if (path === "/v1/machine") {
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
      if (!sameToken(token, opts.machineToken)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, acceptMachine);
    } else if (path === "/v1/device") {
      // Only the phone app itself may open a device socket from a browser.
      const from = req.headers.origin;
      if (from && from !== origin) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, acceptDevice);
    } else {
      socket.destroy();
    }
  };

  let server: Server | undefined;

  return {
    store,
    vapid,
    async listen(port = 8790, host = "127.0.0.1") {
      server = await new Promise<Server>((done, fail) => {
        const s = serve({ fetch: app.fetch, port, hostname: host }, () => done(s as Server)) as Server;
        s.once("error", fail);
      });
      server.on("upgrade", onUpgrade);
      const actual = (server.address() as AddressInfo).port;
      return { url: `http://${host}:${actual}`, port: actual };
    },
    async close() {
      for (const call of pending.values()) clearTimeout(call.timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
      server?.closeAllConnections?.();
      store.close();
    },
  };
}
