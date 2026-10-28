import type {
  DevicePairReply,
  DeviceReply,
  PairingOffer,
  PhoneCatalogue,
  ShortcutInstall,
} from "@steward/shared";
import { readSigned } from "@steward/shortcuts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InstallStore } from "../src/device/installs.ts";
import { launcherName, makeInstall } from "../src/device/shortcuts.ts";
import { missingPackages } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

describe("one-time downloads", () => {
  it("serve once, and forget after ten minutes, revoking a key never fetched", () => {
    let now = 0;
    const store = new InstallStore(() => now);
    const first = store.add({ bytes: new Uint8Array([1]), name: "Steward", personal: true });
    expect(first.id).toMatch(/^[0-9a-f]{32}$/);
    expect(store.take(first.id)?.name).toBe("Steward");
    expect(store.take(first.id)).toBeUndefined();
    let revoked = false;
    const second = store.add({
      bytes: new Uint8Array([1]),
      name: "x",
      personal: true,
      onExpire: () => (revoked = true),
    });
    now = 10 * 60_000 + 1;
    expect(store.take(second.id)).toBeUndefined();
    expect(revoked).toBe(true);
  });

  it("name launchers for Siri without characters a file name cannot hold", () => {
    expect(
      launcherName({
        id: "brief",
        title: "What needs me?",
        description: "",
        siriPhrase: "Steward: What needs me?",
        action: { kind: "brief" },
        scopes: [],
        source: "core",
      }),
    ).toBe("Steward What needs me");
  });
});

const missing = await missingPackages();
if (missing.length > 0) it.todo(`phone shortcuts (waiting for ${missing.join(", ")})`);

describe.runIf(missing.length === 0)("the phone catalogue and shortcuts", () => {
  let t: TestServer;
  let deviceBase: string;
  const PHONE = "https://mac.tail1234.ts.net";

  beforeAll(async () => {
    t = await startTestServer();
    deviceBase = `http://127.0.0.1:${t.server.services.phoneListener.port}`;
    await t.api("/api/phone", { method: "PUT", json: { url: PHONE } });
  });
  afterAll(async () => {
    await t?.close();
  });

  async function pair(): Promise<string> {
    const offer = (await t.api<PairingOffer>("/api/devices/pairing", { method: "POST", json: {} })).body;
    const res = await fetch(`${deviceBase}/device/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: offer.code, deviceName: "Test iPhone", kind: "shortcut" }),
    });
    return ((await res.json()) as DevicePairReply).token;
  }

  const call = async <T>(token: string, path: string, body: unknown = { text: "" }) => {
    const res = await fetch(`${deviceBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };

  it("lists the catalogue with what each shortcut does, and a new skill appears with no re-import", async () => {
    const before = (await t.api<PhoneCatalogue>("/api/phone/catalogue")).body;
    expect(before.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining(["ask", "brief", "approvals", "check"]),
    );
    expect(before.steward.downloadUrl).toBe(`${PHONE}/device/shortcut/Steward.shortcut`);
    expect(before.steward.steps.length).toBeGreaterThan(2);
    expect(before.entries.find((e) => e.id === "brief")?.launcher).toBe(true);
    expect(before.entries.find((e) => e.id === "ask")?.launcher).toBe(false);
    expect(before.automation).toEqual({ time: "08:00", input: "action:brief" });

    const token = await pair();
    const created = await t.api("/api/skills", {
      method: "POST",
      json: { name: "plan-trip", description: "Plan a trip.", instructions: "Plan it." },
    });
    expect(created.status).toBe(201);
    const after = (await t.api<PhoneCatalogue>("/api/phone/catalogue")).body;
    expect(after.entries.map((e) => e.id)).toContain("skill:plan-trip");
    const home = await call<DeviceReply>(token, "/device/home");
    const menu = home.body.ui.find((u) => "choose" in u);
    expect(menu && "choose" in menu ? menu.choose.options.map((o) => o.post) : []).toContain(
      "/device/run/skill%3Aplan-trip",
    );
    // A launcher sends the id as it is; both spellings reach the same action.
    expect((await call<DeviceReply>(token, "/device/run/skill:plan-trip")).body.ui[0]).toMatchObject({
      ask: { post: "/device/run/skill%3Aplan-trip" },
    });
  });

  it("asks for words, then takes them in the address the way the shortcut sends them", async () => {
    const token = await pair();
    const asked = await call<DeviceReply>(token, "/device/run/ask");
    expect(asked.body.ui).toEqual([
      { ask: { prompt: "What would you like Steward to do?", post: "/device/run/ask", field: "text" } },
    ]);
    const answered = await call<{ say: string; threadId: string }>(
      token,
      `/device/run/ask?text=${encodeURIComponent("hello")}`,
    );
    expect(answered.status).toBe(200);
    expect(answered.body.threadId).toMatch(/^thr_/);
  });

  it("carries an approval's answer in the address of each choice", async () => {
    const token = await pair();
    const asked = await call<DeviceReply & { threadId: string }>(token, "/device/say", {
      text: "Email sam@example.com about Friday: see you at 10",
    });
    const choose = asked.body.ui.find((u) => "choose" in u);
    const refuse =
      choose && "choose" in choose ? choose.choose.options.find((o) => o.label === "Refuse") : undefined;
    expect(refuse?.post).toMatch(/\/decision\?answer=refuse$/);
    const done = await call<DeviceReply>(token, refuse!.post);
    expect(done.status).toBe(200);
    expect(done.body.ui).toEqual([{ say: "Refused. Steward won't do it." }]);
  });

  it("serves the generic shortcut without a key, signed, or says plainly that none ships", async () => {
    const res = await fetch(`${deviceBase}/device/shortcut/Steward.shortcut`);
    if (readSigned("Steward.shortcut")) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="Steward.shortcut"');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("AEA1");
    } else {
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toMatch(/signs it at release/);
    }
  });

  it("refuses the one-tap file where nothing can sign it, and leaves no key behind", async () => {
    const before = t.server.services.devices.list().length;
    await expect(
      makeInstall(t.server.services, "steward", {
        installs: t.server.services.installs,
        profile: t.server.services.phoneProfile,
        platform: "linux",
      }),
    ).rejects.toThrow(/Only a Mac/);
    expect(t.server.services.devices.list()).toHaveLength(before);
  });

  it("offers a shipped launcher on any host, once, from the device port", async () => {
    const shipped = readSigned("launchers/brief.shortcut");
    const make = () =>
      makeInstall(t.server.services, "brief", {
        installs: t.server.services.installs,
        profile: t.server.services.phoneProfile,
        platform: "linux",
      });
    if (!shipped) {
      await expect(make()).rejects.toThrow(/Only a Mac/);
      return;
    }
    const install: ShortcutInstall = await make();
    expect(install.personal).toBe(false);
    expect(install.url.startsWith(`${PHONE}/device/install/`)).toBe(true);
    const path = new URL(install.url).pathname;
    const first = await fetch(`${deviceBase}${path}`);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-disposition")).toBe(
      'attachment; filename="Steward What needs me.shortcut"',
    );
    expect((await fetch(`${deviceBase}${path}`)).status).toBe(404);
  });

  it("has no launcher for asking or checking: those are the shortcut itself", async () => {
    const res = await t.api("/api/phone/shortcuts/ask/install", { method: "POST" });
    expect(res.status).toBe(400);
    expect((await t.api("/api/phone/shortcuts/nope/install", { method: "POST" })).status).toBe(404);
  });
});
