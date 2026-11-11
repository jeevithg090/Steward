import { request as httpRequest } from "node:http";
import { memoryDb } from "@steward/db";
import { createGateway, migrations as gatewayMigrations } from "@steward/gateway";
import {
  type Approval,
  type Device,
  type DeviceApprovals,
  type DevicePairReply,
  type DeviceReply,
  type DeviceSayReply,
  type PairingOffer,
  type PhoneInfo,
  parsePairText,
  STEWARD_SHORTCUT,
} from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, startupWarnings } from "../src/config.ts";
import type { DeviceApi } from "../src/device/api.ts";
import { InstallStore, UNFETCHED } from "../src/device/installs.ts";
import { createDeviceApp } from "../src/device/listener.ts";
import { checkPhoneUrl, isPrivateHost, type PhoneSettings } from "../src/device/phone.ts";
import {
  CODE_ALPHABET,
  DeviceStore,
  normaliseCode,
  PAIRING_ATTEMPTS,
  PAIRING_TTL_MS,
  PairingError,
  sha256,
} from "../src/device/store.ts";
import { migrations as serverMigrations } from "../src/store/migrations.ts";
import { missingPackages, waitFor } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

function storeOnMemory() {
  const db = memoryDb([...gatewayMigrations, ...serverMigrations]);
  let clock = new Date("2026-10-28T09:00:00.000Z");
  const gw = createGateway({ db, now: () => clock });
  const store = new DeviceStore(db, gw.audit, "local", () => clock);
  return {
    db,
    gw,
    store,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const pair = (store: DeviceStore, code: string, kind: "shortcut" | "pwa" = "shortcut") =>
  store.pair({ code, deviceName: "Sam's iPhone", kind });

describe("device store", () => {
  it("makes 8-character codes a person can read out", () => {
    const { store } = storeOnMemory();
    const { code } = store.createPairing("shortcut");
    expect(code).toHaveLength(8);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(normaliseCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(code);
  });

  it("keeps only hashes: the database never holds a token or code that works", () => {
    const { db, store } = storeOnMemory();
    const { code } = store.createPairing("shortcut");
    const { token, device } = pair(store, code);
    expect(token).toMatch(/^stw_dev_[A-Za-z0-9_-]{43}$/);
    const dump = JSON.stringify([
      db.all("SELECT * FROM devices"),
      db.all("SELECT * FROM pairing_codes"),
      db.all("SELECT * FROM gateway_audit"),
    ]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(code);
    expect(dump).toContain(sha256(token));
    expect(store.authenticate(token)?.id).toBe(device.id);
    expect(store.authenticate(`${token}x`)).toBeUndefined();
    expect(store.authenticate("not a token")).toBeUndefined();
  });

  it("gives a new phone every scope except saying yes", () => {
    const { store } = storeOnMemory();
    const { device } = pair(store, store.createPairing("shortcut").code);
    expect(device.scopes).toEqual(["brief:read", "approvals:read", "chat", "tasks", "routines:run"]);
    expect(device.scopes).not.toContain("approvals:decide");
  });

  it("uses a code once", () => {
    const { store } = storeOnMemory();
    const { code } = store.createPairing("shortcut");
    pair(store, code);
    expect(() => pair(store, code)).toThrow(PairingError);
  });

  it("lets a code expire after ten minutes", () => {
    const { store, advance } = storeOnMemory();
    const { code, expiresAt } = store.createPairing("shortcut");
    expect(Date.parse(expiresAt) - Date.parse("2026-10-28T09:00:00.000Z")).toBe(PAIRING_TTL_MS);
    advance(PAIRING_TTL_MS + 1);
    expect(() => pair(store, code)).toThrow(PairingError);
  });

  it("kills a code after five wrong tries", () => {
    const { store } = storeOnMemory();
    const { code } = store.createPairing("shortcut");
    for (let i = 0; i < PAIRING_ATTEMPTS; i++) expect(() => pair(store, "WRONGWR0")).toThrow(PairingError);
    expect(() => pair(store, code)).toThrow(PairingError);
  });

  it("allows four wrong tries before the right one", () => {
    const { store } = storeOnMemory();
    const { code } = store.createPairing("shortcut");
    for (let i = 0; i < PAIRING_ATTEMPTS - 1; i++)
      expect(() => pair(store, "WRONGWR0")).toThrow(PairingError);
    expect(pair(store, code).device.name).toBe("Sam's iPhone");
  });

  it("pairs only the kind of device the code was made for", () => {
    const { store } = storeOnMemory();
    const { code } = store.createPairing("pwa");
    expect(() => pair(store, code, "shortcut")).toThrow(PairingError);
  });

  it("stops an older code once a new one is made", () => {
    const { store } = storeOnMemory();
    const older = store.createPairing("shortcut").code;
    const newer = store.createPairing("shortcut").code;
    expect(() => pair(store, older)).toThrow(PairingError);
    expect(pair(store, newer).device).toBeDefined();
  });

  it("revokes at once, and records pairing, changes and revoking", () => {
    const { store, gw } = storeOnMemory();
    const { token, device } = pair(store, store.createPairing("shortcut").code);
    store.update(device.id, { scopes: [...device.scopes, "approvals:decide"] });
    expect(store.get(device.id)?.scopes).toContain("approvals:decide");
    store.revoke(device.id);
    expect(store.authenticate(token)).toBeUndefined();
    expect(store.list()).toHaveLength(0);
    expect(store.list({ includeRevoked: true })[0]?.revokedAt).toBeDefined();
    const types = gw.audit.page({ limit: 20 }).events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["device.paired", "device.changed", "device.revoked"]));
    expect(gw.audit.verify().ok).toBe(true);
  });

  it("revokes at start a one-tap key whose file nobody fetched, and keeps every other phone", () => {
    const { gw, store } = storeOnMemory();
    const unfetched = store.issue({ deviceName: "iPhone (one-tap file)", kind: "shortcut" }).device;
    const fetched = store.issue({ deviceName: "iPhone (one-tap file)", kind: "shortcut" }).device;
    store.touch(fetched);
    const paired = pair(store, store.createPairing("shortcut").code).device;
    const app = store.issueRemote({ deviceName: "Phone app", publicKey: "{}", dataKey: "x" });

    createDeviceApp({
      api: {} as DeviceApi,
      phone: {} as PhoneSettings,
      devices: store,
      installs: new InstallStore(),
    });
    expect(store.get(unfetched.id)?.revokedAt).toBeTruthy();
    for (const kept of [fetched, paired, app])
      expect(store.get(kept.id)?.revokedAt, kept.name).toBeUndefined();
    const revoked = gw.audit.page({ type: "device.revoked" }).events;
    expect(revoked.map((e) => e.detail)).toEqual([expect.objectContaining({ reason: UNFETCHED })]);
  });

  it("records a pairing code that did not work", () => {
    const { store, gw } = storeOnMemory();
    expect(() => pair(store, "ABCDEFGH")).toThrow(PairingError);
    const refused = gw.audit.page({ type: "device.refused" }).events;
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(refused)).not.toContain("ABCDEFGH");
  });
});

describe("phone address", () => {
  it("takes https anywhere, plain http only at home, and never the main port", () => {
    expect(checkPhoneUrl("https://mac.tail1234.ts.net/some/path", 8787)).toEqual({
      url: "https://mac.tail1234.ts.net",
    });
    expect(checkPhoneUrl("http://sams-mac.local:8788", 8787).warning).toMatch(/home network/);
    expect(checkPhoneUrl("http://192.168.1.20:8788", 8787).url).toBe("http://192.168.1.20:8788");
    expect(() => checkPhoneUrl("http://steward.example.com", 8787)).toThrow(/https/);
    expect(() => checkPhoneUrl("http://sams-mac.local:8787", 8787)).toThrow(/main port/);
    expect(() => checkPhoneUrl("ftp://x", 8787)).toThrow();
    expect(() => checkPhoneUrl("https://me:pw@x.example", 8787)).toThrow(/password/);
  });

  it("knows home and tailnet addresses", () => {
    for (const h of ["mac.local", "10.0.0.2", "172.20.1.1", "192.168.0.9", "100.101.102.103", "localhost"]) {
      expect(isPrivateHost(h)).toBe(true);
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "example.com", "100.128.0.1"])
      expect(isPrivateHost(h)).toBe(false);
  });
});

describe("start-up warnings", () => {
  it("warns when STEWARD_ALLOWED_HOSTS opens the main port, and names the device port", () => {
    expect(startupWarnings(loadConfig({}))).toEqual([]);
    const warned = startupWarnings(loadConfig({ STEWARD_ALLOWED_HOSTS: "mac.tail1234.ts.net" }));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/mac\.tail1234\.ts\.net/);
    expect(warned[0]).toMatch(/never point a tunnel/i);
    expect(warned[0]).toMatch(/8788/);
  });

  it("refuses a device port equal to the main port, and can switch it off", () => {
    expect(() => loadConfig({ STEWARD_PORT: "9000", STEWARD_DEVICE_PORT: "9000" })).toThrow(/differ/);
    expect(loadConfig({ STEWARD_DEVICE_PORT: "off" }).devicePort).toBeNull();
    expect(loadConfig({}).devicePort).toBe(8788);
  });
});

const missing = await missingPackages();
if (missing.length > 0) it.todo(`device listener (waiting for ${missing.join(", ")})`);

const PHONE_HOST = "mac.tail1234.ts.net";

/** fetch() will not send a Host header of our choosing; a tunnel does. node:http will. */
function rawGet(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "GET", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}
const EMAIL_ASK = "Email sam@example.com about Friday: see you at 10";

describe.runIf(missing.length === 0)("the device listener", () => {
  let t: TestServer;
  let deviceBase: string;

  beforeAll(async () => {
    t = await startTestServer();
    deviceBase = `http://127.0.0.1:${t.server.services.phoneListener.port}`;
    await t.api("/api/phone", { method: "PUT", json: { url: `https://${PHONE_HOST}` } });
  });
  afterAll(async () => {
    await t?.close();
  });

  /** A call to the device port, the way the Shortcuts app makes it. */
  async function device<T = unknown>(
    path: string,
    init: { method?: string; token?: string; json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: T; headers: Headers }> {
    const res = await fetch(`${deviceBase}${path}`, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      headers: {
        ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        "x-steward-shortcut": `steward@${STEWARD_SHORTCUT.version}`,
        ...init.headers,
      },
      ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON.
    }
    return { status: res.status, body: body as T, headers: res.headers };
  }

  /** Pairs a phone through Settings → Phone's own routes, as the person would. */
  async function pairPhone(name = "Sam's iPhone"): Promise<{ token: string; deviceId: string }> {
    const offer = await t.api<PairingOffer>("/api/devices/pairing", {
      method: "POST",
      json: { kind: "shortcut" },
    });
    expect(offer.status).toBe(201);
    const text = decodeURIComponent(offer.body.qrText.split("&text=")[1] ?? "");
    const payload = parsePairText(text);
    expect(payload).toMatchObject({ u: `https://${PHONE_HOST}`, c: offer.body.code });
    const paired = await device<DevicePairReply>("/device/pair", {
      json: { code: payload!.c, deviceName: name, kind: "shortcut" },
    });
    expect(paired.status).toBe(200);
    expect(paired.headers.get("cache-control")).toBe("no-store");
    return { token: paired.body.token, deviceId: paired.body.deviceId };
  }

  it("shows the phone address, the presets and the shortcut version to Settings → Phone", async () => {
    const info = (await t.api<PhoneInfo>("/api/phone")).body;
    expect(info.url).toBe(`https://${PHONE_HOST}`);
    expect(info.listener.running).toBe(true);
    expect(info.hosts).toContain(PHONE_HOST);
    expect(info.presets.map((p) => p.id)).toEqual(["preset_device_floor", "preset_shortcut_taint"]);
    expect(info.transports.map((x) => x.id)).toEqual(["tailscale", "cloudflared"]);
    expect(info.transports[0]?.command).toContain(String(t.server.services.phoneListener.port));
    // The relay learns what kind of update each message is, and it serves the app's code.
    expect(info.relay.sees.join("\n")).toMatch(/what kind of update each message is/i);
    expect(info.relay.sees.join("\n")).toMatch(/the phone app itself, which it serves/i);
  });

  it("refuses everything but pairing without a device token", async () => {
    for (const path of ["/device/home", "/device/brief", "/device/approvals", "/device/manifest"]) {
      const res = await device<DeviceReply & { error: string }>(path);
      expect(res.status, path).toBe(401);
      expect(res.body.ui[0]).toEqual({ say: res.body.error });
    }
    expect((await device("/device/say", { json: { text: "hi" } })).status).toBe(401);
    expect((await device("/device/run/brief", { json: {} })).status).toBe(401);
    expect((await device("/device/home", { token: "stw_dev_madeup" })).status).toBe(401);
  });

  it("pairs from the QR code's text and then answers the phone", async () => {
    const { token } = await pairPhone();
    const home = await device<DeviceReply>("/device/home", { token });
    expect(home.status).toBe(200);
    const menu = home.body.ui.find((u) => "choose" in u);
    expect(menu && "choose" in menu ? menu.choose.options.map((o) => o.label) : []).toEqual(
      expect.arrayContaining(["Ask Steward", "What needs me?", "Needs you"]),
    );
    const brief = await device<{ say: string }>("/device/brief", { token, method: "POST", json: {} });
    expect(brief.status).toBe(200);
    expect(brief.body.say.length).toBeLessThanOrEqual(300);
    const devices = (await t.api<Device[]>("/api/devices")).body;
    expect(devices.some((d) => d.shortcutVersion === `steward@${STEWARD_SHORTCUT.version}`)).toBe(true);
  });

  it("records which phone ran a routine, which still runs as the routine", async () => {
    const { token, deviceId } = await pairPhone("Hall iPhone");
    const s = t.server.services;
    const routine = s.proactive.routines.create({
      title: "Look at the day",
      prompt: "Tell me what needs me today.",
      schedule: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      agentId: "steward",
    });
    const ran = await device<DeviceReply>(`/device/run/${encodeURIComponent(`routine:${routine.id}`)}`, {
      token,
      json: {},
    });
    expect(ran.status).toBe(200);
    expect(ran.body.ui).toEqual([{ say: "Started Look at the day. Steward will tell you when it's done." }]);
    await waitFor(() => s.proactive.routines.get(routine.id)?.lastStatus);
    const row = s.gateway.audit
      .page({ type: "run.started", limit: 20 })
      .events.find((e) => e.threadId === routine.threadId);
    expect(row?.detail).toMatchObject({
      via: `device:${deviceId}`,
      device: "Hall iPhone",
      routine: routine.id,
    });
    expect(row?.runId).toBeTruthy();
  });

  it("carries on only in a conversation the same phone started", async () => {
    const s = t.server.services;
    const mine = await pairPhone("Desk iPhone");
    const other = await pairPhone("Other iPhone");
    const first = await device<DeviceSayReply>("/device/say", { token: mine.token, json: { text: "hello" } });
    expect(first.status).toBe(200);
    const again = await device<DeviceSayReply>("/device/say", {
      token: mine.token,
      json: { text: "hello again", threadId: first.body.threadId },
    });
    expect(again.status).toBe(200);
    expect(again.body.threadId).toBe(first.body.threadId);

    // A conversation started on the Mac, and one another phone started, are as unknown as a made-up id.
    s.threads.upsertMeta({ id: "thr_from_the_mac", agentId: s.defaultAgentId, kind: "chat", title: "Mac" });
    for (const threadId of ["thr_from_the_mac", first.body.threadId, "thr_made_up"]) {
      const res = await device<{ error: string }>("/device/say", {
        token: other.token,
        json: { text: "post here", threadId },
      });
      expect(res.status, threadId).toBe(404);
      expect(res.body.error).toBe("Couldn't find that conversation.");
    }
    expect(s.runner.getThreadMessages("thr_from_the_mac")).toEqual([]);
  });

  it("answers nothing on the main port: no /device there, and no tunnel-shaped request", async () => {
    const { token } = await pairPhone();
    const onMain = await fetch(`${t.base}/device/home`, { headers: { authorization: `Bearer ${token}` } });
    expect(onMain.status).toBe(404);

    // A tunnel that keeps its own Host name is refused by the host guard.
    expect(await rawGet(`${t.base}/api/approvals`, { host: "random-words.trycloudflare.com" })).toBe(403);
    // One that rewrites the Host to localhost still carries its forwarding headers.
    for (const header of ["x-forwarded-for", "cf-connecting-ip", "tailscale-user-login", "forwarded"]) {
      const rewritten = await fetch(`${t.base}/api/approvals`, {
        headers: { host: new URL(t.base).host, [header]: "203.0.113.9" },
      });
      expect(rewritten.status, header).toBe(403);
      const post = await fetch(`${t.base}/api/devices/pairing`, {
        method: "POST",
        headers: { host: new URL(t.base).host, "content-type": "application/json", [header]: "203.0.113.9" },
        body: "{}",
      });
      expect(post.status, header).toBe(403);
    }
    // This machine's own page still works.
    expect((await fetch(`${t.base}/api/approvals`)).status).toBe(200);
  });

  it("serves only /device/* on the device port, even with a token", async () => {
    const { token } = await pairPhone();
    for (const path of ["/api/approvals", "/api/devices", "/api/settings", "/", "/api/copilotkit/info"]) {
      const res = await device(path, { token });
      expect(res.status, path).toBe(404);
    }
  });

  it("answers only its own host names, and never a web page", async () => {
    const { token } = await pairPhone();
    const auth = { authorization: `Bearer ${token}` };
    expect(await rawGet(`${deviceBase}/device/home`, { ...auth, host: "evil.example" })).toBe(403);
    expect(await rawGet(`${deviceBase}/device/home`, { ...auth, host: `${PHONE_HOST}` })).toBe(200);
    expect(await rawGet(`${deviceBase}/device/home`, { ...auth, host: "localhost:8788" })).toBe(200);
    const page = await device("/device/home", { token, headers: { origin: "https://evil.example" } });
    expect(page.status).toBe(403);
  });

  it("refuses a revoked phone on its very next request", async () => {
    const { token, deviceId } = await pairPhone();
    expect((await device("/device/home", { token })).status).toBe(200);
    expect((await t.api(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(200);
    expect((await device("/device/home", { token })).status).toBe(401);
  });

  it("asks an old shortcut to update (426) with the notes and the download", async () => {
    const { token } = await pairPhone();
    const old = await device<{ update: { url: string; minVersion: number }; ui: DeviceReply["ui"] }>(
      "/device/home",
      {
        token,
        headers: { "x-steward-shortcut": `steward@${STEWARD_SHORTCUT.minVersion - 1}` },
      },
    );
    expect(old.status).toBe(426);
    expect(old.body.update.url).toBe(`https://${PHONE_HOST}/device/shortcut/Steward.shortcut`);
    expect(old.body.ui.at(-1)).toEqual({ open: old.body.update.url });
  });

  it("keeps saying yes switched off until the person turns it on", async () => {
    const { token, deviceId } = await pairPhone();
    const asked = await device<DeviceSayReply>("/device/say", { token, json: { text: EMAIL_ASK } });
    expect(asked.status).toBe(200);
    expect(asked.body.say).toMatch(/needs your answer/);
    const list = await device<DeviceApprovals>("/device/approvals?status=pending", { token });
    const item = list.body.items.find((i) => i.summary.includes("sam@example.com"));
    expect(item).toMatchObject({ canDecideHere: false });
    expect(item?.reason).toMatch(/switched off/);

    const yes = await device(`/device/approvals/${item!.id}/decision`, { token, json: { answer: "once" } });
    expect(yes.status).toBe(403);
    const refused = t.server.services.gateway.audit.page({ type: "device.refused" }).events;
    expect(refused.some((e) => e.detail.scope === "approvals:decide")).toBe(true);

    // Refusing never acts, so it needs no extra scope.
    const no = await device<DeviceReply>(`/device/approvals/${item!.id}/decision`, {
      token,
      json: { answer: "refuse" },
    });
    expect(no.status).toBe(200);
    expect(no.body.ui).toEqual([{ say: "Refused. Steward won't do it." }]);
    expect((await t.api<Approval>(`/api/approvals/${item!.id}`)).body.status).toBe("refused");
    expect(deviceId).toBeTruthy();
  });

  it("leaves what Steward asks out of the brief for a phone that may not see requests", async () => {
    const asker = await pairPhone("Asking iPhone");
    await device<DeviceSayReply>("/device/say", { token: asker.token, json: { text: EMAIL_ASK } });
    expect(t.server.services.gateway.approvals.list({ status: "pending" }).length).toBeGreaterThan(0);

    const { token, deviceId } = await pairPhone("Brief-only iPhone");
    await t.api(`/api/devices/${deviceId}`, { method: "PATCH", json: { scopes: ["brief:read"] } });
    const brief = await device<DeviceReply & { say: string; items: string[] }>("/device/brief", { token });
    expect(brief.status).toBe(200);
    const shown = JSON.stringify(brief.body);
    expect(shown).not.toContain("Steward asks");
    expect(shown).not.toContain("sam@example.com");
    expect(brief.body.say).not.toMatch(/request/);

    // With "See what Steward asks" on, the same brief lists them.
    const full = await device<{ items: string[] }>("/device/brief", { token: asker.token });
    expect(full.body.items.some((i) => i.startsWith("Steward asks:"))).toBe(true);
  });

  it("records a phone's yes with via, and the run resumes exactly as from the web", async () => {
    const { token, deviceId } = await pairPhone("Kitchen iPhone");
    await t.api(`/api/devices/${deviceId}`, {
      method: "PATCH",
      json: { scopes: ["brief:read", "approvals:read", "approvals:decide", "chat"] },
    });
    const asked = await device<DeviceSayReply>("/device/say", { token, json: { text: EMAIL_ASK } });
    const choose = asked.body.ui.find((u) => "choose" in u);
    const options = choose && "choose" in choose ? choose.choose.options : [];
    expect(options.map((o) => o.label)).toEqual(["Allow once", "Refuse"]);
    const allow = options[0]!;

    const run = t.server.services.runner;
    const thread = asked.body.threadId;
    const runInitiators = t.server.services.gateway.audit
      .page({ type: "approval.requested", limit: 5 })
      .events.find((e) => e.threadId === thread);
    expect(runInitiators?.rule?.id).toBe("preset_device_sends");

    const answered = await device<DeviceReply & { approval: Approval }>(allow.post, {
      token,
      json: allow.body,
    });
    expect(answered.status).toBe(200);
    expect(answered.body.approval.status).toBe("allowed");

    const messages = await waitFor(() => {
      const m = run.getThreadMessages(thread);
      return m.at(-1)?.role === "assistant" && m.some((x) => x.role === "tool") && !run.isThreadBusy(thread)
        ? m
        : undefined;
    });
    expect(String(messages.at(-1)?.content)).toMatch(/Sent to sam@example\.com/);

    const decided = t.server.services.gateway.audit
      .page({ type: "approval.decided", limit: 20 })
      .events.find((e) => e.detail.approvalId === answered.body.approval.id);
    expect(decided?.detail).toMatchObject({
      via: `device:${deviceId}`,
      device: "Kitchen iPhone",
      deviceKind: "shortcut",
    });
    expect(t.server.services.gateway.audit.verify().ok).toBe(true);
  });

  it("limits pairing tries", async () => {
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await device("/device/pair", {
        json: { code: "NOPE2345", deviceName: "x", kind: "shortcut" },
      });
      if (res.status === 429) {
        limited = true;
        expect(res.headers.get("retry-after")).toBeTruthy();
      } else expect(res.status).toBe(400);
    }
    expect(limited).toBe(true);
  });
});
