import { createECDH, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createRelay, decryptPush, type Relay } from "@steward/relay";
import {
  answerMessage,
  confirmationCode,
  decryptPayload,
  type Envelope,
  encryptPayload,
  exportPublicKey,
  fromBase64,
  generateSigningKey,
  importDataKey,
  type PairReply,
  parsePairingFragment,
  type RemoteMethod,
  sealJson,
  signText,
  type ToDevice,
  toBase64,
  unwrapDataKey,
} from "@steward/remote";
import type { RemotePairing, RemotePairingState } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { missingPackages, tempDir, waitFor } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

const missing = await missingPackages();
if (missing.length > 0) it.todo(`the phone app's relay (waiting for ${missing.join(", ")})`);

const EMAIL_ASK = "Email sam@example.com about Friday: see you at 10";
/** Words that must never appear anywhere the relay keeps or sends on. */
const PLAINTEXT = ["sam@example.com", "Friday", "see you at 10", "Steward needs your answer", "Email sam"];

/** A phone, in Node, with the same crypto as the phone app: non-extractable WebCrypto keys. */
class Phone {
  ws?: WebSocket;
  dataKey?: CryptoKey;
  deviceId = "";
  token = "";
  envelopes: Envelope[] = [];
  revoked = false;
  private pending = new Map<string, (frame: Extract<ToDevice, { type: "rpc.result" }>) => void>();
  box!: CryptoKeyPair;
  sign!: CryptoKeyPair;

  constructor(readonly relayUrl: string) {}

  async keys() {
    this.box = (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;
    this.sign = await generateSigningKey();
    return {
      box: toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", this.box.publicKey))),
      sign: await exportPublicKey(this.sign.publicKey),
    };
  }

  async connect(afterSeq = 0): Promise<void> {
    const ws = new WebSocket(`${this.relayUrl.replace(/^http/, "ws")}/v1/device`);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "auth", token: this.token, afterSeq }));
      });
      ws.on("message", (data) => {
        const frame = JSON.parse(String(data)) as ToDevice;
        if (frame.type === "ready") resolve();
        else if (frame.type === "envelope") this.envelopes.push(frame.envelope);
        else if (frame.type === "rpc.result") this.pending.get(frame.id)?.(frame);
        else if (frame.type === "revoked") this.revoked = true;
        else if (frame.type === "error") reject(new Error(frame.message));
      });
      ws.once("error", reject);
    });
  }

  /** Sends one sealed call; `outer` lets a test lie about the method name, as a bad relay could. */
  async call<T = unknown>(method: RemoteMethod, params: unknown, outer: string = method) {
    const id = randomBytes(6).toString("hex");
    const c = toBase64(await encryptPayload(this.dataKey!, { method, params }));
    const frame = await new Promise<Extract<ToDevice, { type: "rpc.result" }>>((resolve) => {
      this.pending.set(id, resolve);
      this.ws!.send(JSON.stringify({ type: "rpc", id, method: outer, c }));
    });
    if (frame.error) return { ok: false as const, error: frame.error };
    return (await decryptPayload(this.dataKey!, fromBase64(frame.c!))) as
      | { ok: true; value: T }
      | { ok: false; error: string };
  }

  async open<T>(envelope: Envelope): Promise<T | undefined> {
    return decryptPayload<T>(this.dataKey!, fromBase64(envelope.c));
  }

  async signed(approvalId: string, answer: "once" | "refuse") {
    const nonce = randomBytes(16).toString("base64url");
    const ts = Date.now();
    const sig = await signText(
      this.sign.privateKey,
      answerMessage(this.deviceId, { approvalId, answer, nonce, ts }),
    );
    return { approvalId, answer, nonce, ts, sig };
  }
}

describe.runIf(missing.length === 0)("the phone app through the relay", () => {
  let relay: Relay;
  let relayUrl: string;
  let t: TestServer;
  let push: Server;
  let pushUrl: string;
  const pushed: Uint8Array[] = [];
  const logs: string[] = [];
  const tmp = tempDir("steward-relay-");
  const token = randomBytes(32).toString("base64url");
  const phone = () => new Phone(relayUrl);
  let one: Phone;

  beforeAll(async () => {
    push = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        pushed.push(new Uint8Array(Buffer.concat(chunks)));
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((r) => push.listen(0, "127.0.0.1", () => r()));
    pushUrl = `http://127.0.0.1:${(push.address() as AddressInfo).port}/push/abc`;
    relay = createRelay({
      dbPath: join(tmp.dir, "relay.db"),
      machineToken: token,
      publicUrl: "https://relay.test",
      allowInsecurePush: true,
      log: (line) => logs.push(JSON.stringify(line)),
    });
    relayUrl = (await relay.listen(0)).url;
    t = await startTestServer({
      STEWARD_RELAY_URL: relayUrl.replace(/^http/, "ws"),
      STEWARD_RELAY_TOKEN: token,
    });
    await t.server.services.remote!.whenConnected();
  });

  afterAll(async () => {
    await t?.close();
    await relay?.close();
    await new Promise<void>((r) => (push ? push.close(() => r()) : r()));
    tmp.remove();
  });

  /** Pairs a phone the way a person does: scan, compare the code on both screens, confirm on the Mac. */
  async function pair(name = "Sam's iPhone"): Promise<Phone> {
    const p = phone();
    const offer = (await t.api<RemotePairing>("/api/devices/remote-pairing", { method: "POST" })).body;
    expect(offer.url.startsWith(`${relayUrl.replace(/^ws/, "http")}/#pair=`)).toBe(true);
    const fragment = parsePairingFragment(new URL(offer.url).hash)!;
    const keys = await p.keys();
    const sealed = toBase64(await sealJson({ name, ...keys }, fromBase64(fragment.key)));
    const hello = await fetch(`${relayUrl}/v1/pair/${fragment.pairingId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sealed }),
    });
    expect(hello.status).toBe(202);
    const phoneCode = await confirmationCode(toBase64(fromBase64(fragment.key)), keys.box, keys.sign);
    const state = await waitFor(async () => {
      const s = (await t.api<RemotePairingState>(`/api/devices/remote-pairing/${offer.pairingId}`)).body;
      return s.state === "check" ? s : undefined;
    });
    expect(state.name).toBe(name);
    expect(state.code).toBe(phoneCode);
    expect(
      (await t.api(`/api/devices/remote-pairing/${offer.pairingId}/confirm`, { method: "POST" })).status,
    ).toBe(200);
    const reply = await waitFor(async () => {
      const res = await fetch(`${relayUrl}/v1/pair/${fragment.pairingId}`);
      return res.status === 200 ? ((await res.json()) as PairReply) : undefined;
    });
    // Collected once.
    expect((await fetch(`${relayUrl}/v1/pair/${fragment.pairingId}`)).status).toBe(404);
    const raw = await unwrapDataKey(fromBase64(reply.sealed), p.box.privateKey);
    p.dataKey = await importDataKey(raw!);
    p.deviceId = reply.deviceId;
    p.token = reply.token;
    await p.connect();
    return p;
  }

  it("pairs with the same code on both screens, once, and Steward records it", async () => {
    one = await pair();
    const device = t.server.services.devices.get(one.deviceId);
    expect(device).toMatchObject({ kind: "pwa", name: "Sam's iPhone" });
    expect(device?.scopes).not.toContain("approvals:decide");
    const paired = t.server.services.gateway.audit.page({ type: "device.paired" }).events;
    expect(paired.some((e) => e.detail.delivery === "relay")).toBe(true);
  });

  it("answers the closed list only, and never trusts the relay's method name", async () => {
    const brief = await one.call<{ say: string }>("brief.get", {});
    expect(brief.ok).toBe(true);
    const swapped = await one.call("approval.decide", {}, "brief.get");
    expect(swapped).toEqual({ ok: false, error: "That request could not be read." });
    const shell = await one.call("brief.get", {}, "shell.run");
    expect(shell).toEqual({ ok: false, error: "A phone can't ask for that." });
  });

  it("streams a chat it started, sealed, and answers a signed yes that is recorded and resumes", async () => {
    await t.api(`/api/devices/${one.deviceId}`, {
      method: "PATCH",
      json: { scopes: ["brief:read", "approvals:read", "approvals:decide", "chat", "tasks", "routines:run"] },
    });
    const sent = await one.call<{ threadId: string }>("chat.send", { text: EMAIL_ASK });
    expect(sent.ok).toBe(true);
    const threadId = sent.ok ? sent.value.threadId : "";
    const finished = await waitFor(async () => {
      for (const e of one.envelopes.filter((x) => x.topic === `thread:${threadId}`)) {
        const event = await one.open<{ type: string }>(e);
        if (event?.type === "RUN_FINISHED") return event;
      }
      return undefined;
    });
    expect(finished.type).toBe("RUN_FINISHED");
    const approvalEnvelope = await waitFor(async () => {
      for (const e of one.envelopes.filter((x) => x.topic === "approvals")) {
        const value = await one.open<{
          type: string;
          item: { id: string; summary: string; canDecideHere: boolean };
        }>(e);
        if (value?.type === "approval.created" && value.item.summary.includes("sam@example.com"))
          return value;
      }
      return undefined;
    });
    expect(approvalEnvelope.item.canDecideHere).toBe(true);
    const approvalId = approvalEnvelope.item.id;

    const answer = await one.signed(approvalId, "once");
    const decided = await one.call<{ approval: { id: string } }>("approval.decide", answer);
    expect(decided.ok).toBe(true);

    const run = t.server.services.runner;
    const messages = await waitFor(() => {
      const m = run.getThreadMessages(threadId);
      return m.at(-1)?.role === "assistant" && m.some((x) => x.role === "tool") && !run.isThreadBusy(threadId)
        ? m
        : undefined;
    });
    expect(String(messages.at(-1)?.content)).toMatch(/Sent to sam@example\.com/);
    const record = t.server.services.gateway.audit
      .page({ type: "approval.decided", limit: 50 })
      .events.find((e) => e.detail.approvalId === approvalId);
    expect(record?.detail).toMatchObject({ via: `device:${one.deviceId}`, deviceKind: "pwa" });

    // The same signed answer again is a replay, refused before anything else.
    const replay = await one.call("approval.decide", answer);
    expect(replay).toEqual({ ok: false, error: "That answer was already used.", status: 403 });
    const refused = t.server.services.gateway.audit.page({ type: "device.refused" }).events;
    expect(refused.some((e) => e.detail.reason === "answer replayed")).toBe(true);
  });

  it("refuses an answer signed by another key, or for another approval", async () => {
    const answer = await one.signed("apr_whatever", "refuse");
    const forged = { ...answer, approvalId: "apr_other" };
    expect(await one.call("approval.decide", forged)).toMatchObject({
      ok: false,
      error: "That answer wasn't signed by this phone.",
    });
  });

  it("sends a sealed push when the app is not on screen, and none while it is", async () => {
    const ua = createECDH("prime256v1");
    const uaPublic = new Uint8Array(ua.generateKeys());
    const auth = new Uint8Array(randomBytes(16));
    const subscribed = await fetch(`${relayUrl}/v1/push/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${one.token}` },
      body: JSON.stringify({
        endpoint: pushUrl,
        keys: {
          p256dh: Buffer.from(uaPublic).toString("base64url"),
          auth: Buffer.from(auth).toString("base64url"),
        },
      }),
    });
    expect(subscribed.status).toBe(204);

    const before = pushed.length;
    t.server.services.proactive.notifications.add({
      title: "Brief ready",
      body: "Your brief for Friday is ready.",
      level: "info",
    });
    const body = await waitFor(() => pushed[before]);
    const inner = JSON.parse(
      Buffer.from(decryptPush(body, new Uint8Array(ua.getPrivateKey()), uaPublic, auth)).toString(),
    ) as {
      level: string;
      c: string;
    };
    expect(inner.level).toBe("info");
    // What the push service carried is sealed again with the phone's own key.
    expect(await decryptPayload(one.dataKey!, fromBase64(inner.c))).toMatchObject({ title: "Brief ready" });

    one.ws!.send(JSON.stringify({ type: "presence", visible: true }));
    await new Promise((r) => setTimeout(r, 100));
    const count = pushed.length;
    t.server.services.proactive.notifications.add({ title: "Done", body: "x", level: "done" });
    await waitFor(() => logs.some((l) => l.includes('"outcome":"suppressed"')));
    expect(pushed.length).toBe(count);
  });

  it("keeps no plaintext anywhere the relay keeps or passes on", async () => {
    const db = relay.store.db;
    const dump = JSON.stringify([
      db.all("SELECT * FROM devices"),
      db.all("SELECT * FROM envelopes"),
      db.all("SELECT * FROM settings"),
    ]);
    const pushes = pushed.map((b) => Buffer.from(b).toString("latin1")).join("");
    const everything = `${dump}\n${logs.join("\n")}\n${pushes}`;
    expect(everything.length).toBeGreaterThan(1000);
    for (const word of PLAINTEXT) expect(everything, word).not.toContain(word);
    // The ciphertext it holds opens with the phone's key, so the capture is the real traffic.
    const opened = await Promise.all(one.envelopes.slice(0, 5).map((e) => one.open(e)));
    expect(opened.every(Boolean)).toBe(true);
  });

  it("revokes at once: the socket is closed and the token stops working", async () => {
    const p = await pair("Old iPhone");
    expect((await p.call("brief.get", {})).ok).toBe(true);
    expect((await t.api(`/api/devices/${p.deviceId}`, { method: "DELETE" })).status).toBe(200);
    await waitFor(() => p.revoked || p.ws?.readyState === WebSocket.CLOSED);
    const envelopes = await fetch(`${relayUrl}/v1/envelopes?after_seq=0`, {
      headers: { authorization: `Bearer ${p.token}` },
    });
    expect(envelopes.status).toBe(401);
    await expect(p.connect()).rejects.toThrow(/isn't paired/);
    expect(t.server.services.devices.remoteKey(p.deviceId)).toBeUndefined();
  });
});
