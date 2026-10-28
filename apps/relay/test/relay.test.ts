import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToDevice, ToMachine } from "@steward/remote";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createRelay,
  decryptPush,
  encryptPush,
  generateVapidKeys,
  type Relay,
  RelayStore,
  vapidAuthorization,
} from "../src/index.ts";

const TOKEN = "machine-token-machine-token-0123";

describe("the relay's log", () => {
  it("numbers envelopes per device, drops a repeated localId, and catches up after a seq", () => {
    const store = new RelayStore(":memory:");
    store.createDevice("dev_aaaaaaaa");
    const first = store.append("dev_aaaaaaaa", [
      { localId: "a", topic: "approvals", c: "x" },
      { localId: "b", topic: "approvals", c: "y" },
    ]);
    expect(first.map((e) => e.seq)).toEqual([1, 2]);
    expect(store.append("dev_aaaaaaaa", [{ localId: "b", topic: "approvals", c: "y" }])).toEqual([]);
    store.append("dev_aaaaaaaa", [{ localId: "c", topic: "today", c: "z" }]);
    expect(store.after("dev_aaaaaaaa", 1).map((e) => e.localId)).toEqual(["b", "c"]);
    expect(store.latestSeq("dev_aaaaaaaa")).toBe(3);
    expect(store.append("dev_unknown1", [{ localId: "a", topic: "t", c: "x" }])).toEqual([]);
  });

  it("keeps tokens only as hashes, and forgets a revoked device's log", () => {
    const store = new RelayStore(":memory:");
    const token = store.createDevice("dev_bbbbbbbb");
    expect(JSON.stringify(store.db.all("SELECT * FROM devices"))).not.toContain(token);
    expect(store.deviceForToken(token)).toBe("dev_bbbbbbbb");
    store.append("dev_bbbbbbbb", [{ localId: "a", topic: "t", c: "x" }]);
    store.revoke("dev_bbbbbbbb");
    expect(store.deviceForToken(token)).toBeUndefined();
    expect(store.after("dev_bbbbbbbb", 0)).toEqual([]);
  });
});

describe("Web Push (RFC 8291, RFC 8292)", () => {
  it("encrypts so only the subscriber reads it", () => {
    const ua = createECDH("prime256v1");
    const pub = new Uint8Array(ua.generateKeys());
    const auth = new Uint8Array(randomBytes(16));
    const sub = {
      endpoint: "https://push.example/x",
      keys: { p256dh: Buffer.from(pub).toString("base64url"), auth: Buffer.from(auth).toString("base64url") },
    };
    const body = encryptPush(sub, Buffer.from('{"c":"sealed"}'));
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(Buffer.from(body).toString("latin1")).not.toContain("sealed");
    expect(Buffer.from(decryptPush(body, new Uint8Array(ua.getPrivateKey()), pub, auth)).toString()).toBe(
      '{"c":"sealed"}',
    );
  });

  it("signs a VAPID JWT for the push service's origin", () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization("https://web.push.apple.com/abc", keys, "mailto:me@example.com", 0);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    const claims = JSON.parse(Buffer.from(m[2]!, "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://web.push.apple.com", sub: "mailto:me@example.com" });
    expect(m[4]).toBe(keys.publicKey);
    const ok = verify(
      "sha256",
      Buffer.from(`${m[1]}.${m[2]}`),
      { key: createPublicKey(keys.privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(m[3]!, "base64url"),
    );
    expect(ok).toBe(true);
  });
});

describe("the relay server", () => {
  let relay: Relay | undefined;
  const dirs: string[] = [];
  afterEach(async () => {
    await relay?.close();
    relay = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function start(extra: Partial<Parameters<typeof createRelay>[0]> = {}) {
    const logs: string[] = [];
    relay = createRelay({
      dbPath: ":memory:",
      machineToken: TOKEN,
      publicUrl: "https://relay.test",
      log: (l) => logs.push(JSON.stringify(l)),
      ...extra,
    });
    const { url } = await relay.listen(0);
    return { url, ws: url.replace(/^http/, "ws"), logs };
  }

  const open = (url: string, headers: Record<string, string> = {}) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
    });

  const next = <T>(ws: WebSocket, type: string) =>
    new Promise<T>((resolve) => {
      const on = (data: WebSocket.RawData) => {
        const frame = JSON.parse(String(data));
        if (frame.type === type) {
          ws.off("message", on);
          resolve(frame as T);
        }
      };
      ws.on("message", on);
    });

  async function device(url: string, deviceId = "dev_cccccccc") {
    const token = relay!.store.createDevice(deviceId);
    const ws = await open(`${url}/v1/device`);
    const ready = next<{ seq: number }>(ws, "ready");
    ws.send(JSON.stringify({ type: "auth", token }));
    await ready;
    return { ws, token, deviceId };
  }

  it("refuses a machine without its token, and a device without a token", async () => {
    const { ws } = await start();
    await expect(open(`${ws}/v1/machine`, { authorization: "Bearer wrong" })).rejects.toThrow("401");
    const sock = await open(`${ws}/v1/device`);
    const closed = new Promise<number>((r) => sock.once("close", (code) => r(code)));
    sock.send(JSON.stringify({ type: "auth", token: "nope" }));
    expect(await closed).toBe(4401);
    await expect(open(`${ws}/v1/device`, { origin: "https://evil.example" })).rejects.toThrow("403");
  });

  it("routes a call to Steward and back, and refuses any method not on the list", async () => {
    const { ws } = await start();
    const machine = await open(`${ws}/v1/machine`, { authorization: `Bearer ${TOKEN}` });
    machine.on("message", (data) => {
      const frame = JSON.parse(String(data)) as ToMachine;
      if (frame.type === "rpc")
        machine.send(JSON.stringify({ type: "rpc.result", id: frame.id, c: `echo:${frame.c}` }));
    });
    const phone = await device(ws);
    const result = next<Extract<ToDevice, { type: "rpc.result" }>>(phone.ws, "rpc.result");
    phone.ws.send(JSON.stringify({ type: "rpc", id: "1", method: "brief.get", c: "sealed" }));
    expect(await result).toEqual({ type: "rpc.result", id: "1", c: "echo:sealed" });
    const refused = next<Extract<ToDevice, { type: "rpc.result" }>>(phone.ws, "rpc.result");
    phone.ws.send(JSON.stringify({ type: "rpc", id: "2", method: "shell.run", c: "x" }));
    expect((await refused).error).toBe("A phone can't ask for that.");
  });

  it("waits the grace for Steward to come back, then says it is offline", async () => {
    const { ws } = await start({ graceMs: 150 });
    const phone = await device(ws);
    const offline = next<Extract<ToDevice, { type: "rpc.result" }>>(phone.ws, "rpc.result");
    phone.ws.send(JSON.stringify({ type: "rpc", id: "1", method: "brief.get", c: "x" }));
    expect((await offline).error).toMatch(/offline/);

    // A call made while Steward is away goes through when it comes back within the grace.
    const late = next<Extract<ToDevice, { type: "rpc.result" }>>(phone.ws, "rpc.result");
    phone.ws.send(JSON.stringify({ type: "rpc", id: "2", method: "brief.get", c: "x" }));
    // Listen before the socket opens: the waiting call is sent the moment Steward connects.
    const machine = new WebSocket(`${ws}/v1/machine`, { headers: { authorization: `Bearer ${TOKEN}` } });
    machine.on("message", (data) => {
      const frame = JSON.parse(String(data)) as ToMachine;
      if (frame.type === "rpc") machine.send(JSON.stringify({ type: "rpc.result", id: frame.id, c: "ok" }));
    });
    expect((await late).c).toBe("ok");
  });

  it("gives up after the timeout, and fails at once when Steward leaves mid-call", async () => {
    const { ws } = await start({ timeoutMs: 150 });
    const machine = await open(`${ws}/v1/machine`, { authorization: `Bearer ${TOKEN}` });
    const phone = await device(ws);
    const slow = next<Extract<ToDevice, { type: "rpc.result" }>>(phone.ws, "rpc.result");
    phone.ws.send(JSON.stringify({ type: "rpc", id: "1", method: "brief.get", c: "x" }));
    expect((await slow).error).toMatch(/in time/);
    const gone = next<Extract<ToDevice, { type: "rpc.result" }>>(phone.ws, "rpc.result");
    const got = next(machine, "rpc");
    phone.ws.send(JSON.stringify({ type: "rpc", id: "2", method: "brief.get", c: "x" }));
    await got;
    machine.close();
    expect((await gone).error).toMatch(/went offline/);
  });

  it("serves the phone app with a strict content policy, and index.html for app routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-static-"));
    dirs.push(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Steward</title>");
    writeFileSync(join(dir, "sw.js"), "self.addEventListener('push', () => {});");
    const { url } = await start({ staticDir: dir });
    const page = await fetch(`${url}/needs-you`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Steward</title>");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect((await fetch(`${url}/sw.js`)).headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${url}/..%2f..%2fetc%2fpasswd`)).status).toBe(200);
    expect(await (await fetch(`${url}/..%2f..%2fetc%2fpasswd`)).text()).toContain("<title>Steward</title>");
  });

  it("only accepts https push addresses", async () => {
    const { url } = await start();
    const token = relay!.store.createDevice("dev_dddddddd");
    const res = await fetch(`${url}/v1/push/subscribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "http://169.254.169.254/latest", keys: { p256dh: "x", auth: "y" } }),
    });
    expect(res.status).toBe(400);
  });
});
