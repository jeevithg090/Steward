import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { hashPack } from "@steward/bots";
import { generateBot } from "@steward/bots-gen";
import { memoryDb } from "@steward/db";
import { createGateway, gateCallFor } from "@steward/gateway";
import {
  type AppInfo,
  type AuditPage,
  type BotListing,
  type BotPack,
  BotPackSchema,
  type BotPreview,
  type InstalledBot,
  type LiveEvent,
  type Routine,
  type Rule,
  type Skill,
} from "@steward/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { directoryFetch } from "../src/bots/fetch.ts";
import { countsEndpoint, directoryError } from "../src/bots/service.ts";
import { missingPackages, tempDir } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

// ── Fixtures: a directory of two packs, written by hand as the builder would write them ─────────

const RENT_SCOUT: BotPack = {
  id: "rent-scout",
  name: "Rent Scout",
  pitch: "Finds rentals in your budget and reads the small print.",
  category: "home",
  version: 2,
  author: { kind: "person", handle: "oxhack" },
  licence: "MIT",
  needs: {
    tools: ["browser_navigate", "browser_snapshot", "web_search", "show_table"],
    connectors: [],
    model: "any",
  },
  instructions:
    "You help one person find a place to rent. Look at listings, compare them and say what you could not check.",
  starters: ["Find two-bed flats under 1,600 a month near Oxford."],
  examples: [
    { ask: "Is this listing a scam?", does: "Checks the address and the price, then says plainly." },
  ],
  skills: [
    {
      name: "find-rentals",
      description: "Search rental sites and compare what comes back.",
      body: "Search two sites. Put the results in a table. Say which site you could not read.",
      allowedTools: ["web_search", "show_table"],
    },
  ],
  rules: [
    {
      name: "Never pay a deposit",
      effect: "deny",
      when: 'tool.kind == "pay"',
      description: "Deposits are paid by you.",
    },
  ],
  routines: [
    {
      title: "Morning rentals",
      prompt: "Look for new rentals and tell me about the best two.",
      schedule: "0 8 * * *",
    },
  ],
  shortcuts: [],
  readme: "# Rent Scout\n\nFinds rentals and reads the small print.",
};

const SHELL_HELPER: BotPack = {
  id: "shell-helper",
  name: "Shell Helper",
  pitch: "Runs small commands in its workspace and explains what they did.",
  category: "dev",
  version: 1,
  author: { kind: "ai", model: "scripted", generated: "2026-10-28" },
  licence: "MIT",
  needs: { tools: ["shell_run", "file_read", "file_write"], connectors: [], model: "any" },
  instructions: "You run small commands in your own workspace and explain the result in plain words.",
  starters: [],
  examples: [],
  skills: [],
  rules: [
    { name: "Ask before installing", effect: "ask", when: 'tool.name == "shell_run"', description: "" },
  ],
  routines: [],
  shortcuts: [],
  readme: "# Shell Helper",
};

/** A pack that brings no rules, so it installs whatever the gateway knows about bot rules. */
const NOTE_TAKER: BotPack = {
  ...SHELL_HELPER,
  id: "note-taker",
  name: "Note Taker",
  pitch: "Keeps short notes as pages in its workspace.",
  category: "productivity",
  needs: { tools: ["file_write", "make_page"], connectors: [], model: "any" },
  instructions: "You keep short notes for one person as pages in your workspace.",
  skills: [
    { name: "daily-note", description: "Write today's note.", body: "Make a page named after today's date." },
  ],
  rules: [],
};

function listingOf(pack: BotPack): BotListing {
  return {
    id: pack.id,
    name: pack.name,
    pitch: pack.pitch,
    category: pack.category,
    version: pack.version,
    author: pack.author,
    needs: pack.needs,
    installs: 0,
    usedBy: 0,
    updatedAt: "2026-10-28T00:00:00.000Z",
    packUrl: `packs/${pack.id}.json`,
  };
}

/** Writes `index.json` and `packs/<id>.json` for the given packs into a temp folder. */
function writeDirectory(packs: BotPack[]): { indexPath: string; remove: () => void } {
  const { dir, remove } = tempDir("steward-bots-");
  mkdirSync(join(dir, "packs"), { recursive: true });
  for (const pack of packs) writeFileSync(join(dir, "packs", `${pack.id}.json`), JSON.stringify(pack));
  const index = {
    name: "Test directory",
    generatedAt: "2026-10-28T00:00:00.000Z",
    categories: { home: "Home & family", dev: "Developers & tools", productivity: "Email & productivity" },
    bots: packs.map(listingOf),
  };
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  return { indexPath: join(dir, "index.json"), remove };
}

/** True once the gateway's rule store accepts source `bot` (the contract in packages/shared). */
const botRulesSupported = (() => {
  try {
    const gateway = createGateway({ db: memoryDb() });
    gateway.rules.create({
      name: "probe",
      effect: "deny",
      when: 'tool.kind == "pay"',
      description: "",
      enabled: true,
      source: "bot",
    });
    return true;
  } catch {
    return false;
  }
})();

const haveGenerator = typeof generateBot === "function";

const missing = await missingPackages();
if (missing.length > 0) it.todo(`bots (waiting for ${missing.join(", ")})`);

describe("directoryError", () => {
  it("keeps a path on this machine out of what the page is told", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const denied = Object.assign(
      new Error("EACCES: permission denied, open '/home/sam/directory/packs/a.json'"),
      {
        code: "EACCES",
      },
    );
    const error = directoryError(denied);
    expect(error.status).toBe(502);
    expect(error.message).toBe("Couldn't read that bot from the directory.");
    expect(directoryError(new Error("The directory answered 404 for the pack at packs/a.json")).status).toBe(
      404,
    );
    expect(directoryError(new Error("pack changed since it was listed")).message).toMatch(/changed since/);
    vi.restoreAllMocks();
  });
});

describe("countsEndpoint", () => {
  it("is nowhere for a directory read from a file", () => {
    expect(countsEndpoint("/srv/steward/directory/index.json", "rent-scout")).toBeUndefined();
    expect(
      countsEndpoint("directory/index.json", "rent-scout", { site: "https://bots.example" }),
    ).toBeUndefined();
  });

  it("refuses a site on another origin unless it is https", () => {
    expect(
      countsEndpoint("https://bots.example/index.json", "rent-scout", { site: "http://192.168.1.1" }),
    ).toBe("https://bots.example/api/bots/rent-scout/installed");
    expect(
      countsEndpoint("http://127.0.0.1:8790/index.json", "rent-scout", { site: "http://127.0.0.1:8790" }),
    ).toBe("http://127.0.0.1:8790/api/bots/rent-scout/installed");
  });

  it("is the directory's site, or beside the index when the index names none", () => {
    expect(
      countsEndpoint("https://bots.example/index.json", "rent-scout", { site: "https://bots.example" }),
    ).toBe("https://bots.example/api/bots/rent-scout/installed");
    expect(countsEndpoint("https://cdn.example/steward/index.json", "rent-scout")).toBe(
      "https://cdn.example/steward/api/bots/rent-scout/installed",
    );
    expect(
      countsEndpoint("https://cdn.example/steward/index.json", "a/b", { site: "https://bots.example/" }),
    ).toBe("https://bots.example/api/bots/a%2Fb/installed");
  });
});

describe("directoryFetch", () => {
  it("reaches the configured directory on this machine, and nothing else there", async () => {
    const seen: string[] = [];
    const local = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.end("{}");
    });
    await new Promise<void>((done) => local.listen(0, "127.0.0.1", done));
    const { port } = local.address() as AddressInfo;
    try {
      const read = directoryFetch({
        directoryUrl: `http://127.0.0.1:${port}/index.json`,
        allowPrivateHosts: false,
      });
      expect((await read(`http://127.0.0.1:${port}/packs/a.json`)).status).toBe(200);
      await expect(read(`http://localhost:${port}/packs/a.json`)).rejects.toThrow(/private network/);
      const fromFile = directoryFetch({
        directoryUrl: "/srv/directory/index.json",
        allowPrivateHosts: false,
      });
      await expect(fromFile(`http://127.0.0.1:${port}/packs/a.json`)).rejects.toThrow(/private network/);
      const allowed = directoryFetch({ directoryUrl: "/srv/directory/index.json", allowPrivateHosts: true });
      expect((await allowed(`http://127.0.0.1:${port}/packs/b.json`)).status).toBe(200);
      expect(seen).toEqual(["/packs/a.json", "/packs/b.json"]);
    } finally {
      await new Promise<void>((done) => local.close(() => done()));
    }
  });
});

describe.runIf(missing.length === 0)("the bot directory over HTTP", () => {
  let t: TestServer;
  let directory: ReturnType<typeof writeDirectory>;
  beforeAll(async () => {
    directory = writeDirectory([RENT_SCOUT, SHELL_HELPER]);
    t = await startTestServer({ STEWARD_DIRECTORY_URL: directory.indexPath, STEWARD_DIRECTORY_COUNTS: "1" });
  });
  afterAll(async () => {
    await t?.close();
    directory?.remove();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists and filters the directory, with its categories", async () => {
    const all = await t.api<{ bots: BotListing[]; total: number; categories: Record<string, string> }>(
      "/api/bots",
    );
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.bots.map((b) => b.id).sort()).toEqual(["rent-scout", "shell-helper"]);
    expect(all.body.categories.home).toBe("Home & family");
    expect(all.body.bots.every((b) => !("installed" in b))).toBe(true);

    const dev = await t.api<{ bots: BotListing[]; total: number }>("/api/bots?category=dev");
    expect(dev.body.bots.map((b) => b.id)).toEqual(["shell-helper"]);
    const search = await t.api<{ bots: BotListing[]; total: number }>("/api/bots?q=rent");
    expect(search.body.bots.map((b) => b.id)).toEqual(["rent-scout"]);
    const browsing = await t.api<{ bots: BotListing[]; total: number }>("/api/bots?needs=browser");
    expect(browsing.body.bots.map((b) => b.id)).toEqual(["rent-scout"]);
    const words = await t.api<{ bots: BotListing[]; total: number }>("/api/bots?q=help+me+please");
    expect(words.body).toMatchObject({ bots: [], total: 0 });
    expect((await t.api("/api/bots?needs=everything")).status).toBe(400);
    expect((await t.api("/api/bots?category=nope")).status).toBe(400);
    expect((await t.api("/api/bots?limit=0")).status).toBe(400);
    expect((await t.api<InstalledBot[]>("/api/bots/installed")).body).toEqual([]);
  });

  it("previews what a pack may do through the real gateway: commands ask, reads do not", async () => {
    const shell = await t.api<BotPreview & { problems: unknown[] }>("/api/bots/preview", {
      method: "POST",
      json: { packUrl: "packs/shell-helper.json" },
    });
    expect(shell.status).toBe(200);
    expect(shell.body.pack.id).toBe("shell-helper");
    expect(shell.body.mayDoWithoutAsking).toEqual(
      expect.arrayContaining(["read files in its workspace", "write files in its workspace"]),
    );
    expect(shell.body.mayDoWithoutAsking).not.toContain("run commands");
    expect(shell.body.asksBefore).toEqual(
      expect.arrayContaining([
        "run commands",
        "Ask before installing",
        "sending anything",
        "paying",
        "signing",
        "deleting",
      ]),
    );
    expect(shell.body.toolsMissing).toEqual([]);
    expect(shell.body.needsMissing).toEqual([]);
    expect(shell.body.alreadyInstalled).toBeUndefined();
    expect(Array.isArray(shell.body.problems)).toBe(true);

    const rent = await t.api<BotPreview>("/api/bots/preview", {
      method: "POST",
      json: { packUrl: "packs/rent-scout.json" },
    });
    expect(rent.body.mayDoWithoutAsking).toEqual(
      expect.arrayContaining(["browse the web on its own computer", "read web pages", "search the web"]),
    );
    expect(rent.body.asksBefore).not.toContain("Never pay a deposit");
  });

  it("says a bot the directory doesn't have isn't there, without naming a path on this machine", async () => {
    const res = await t.api<{ error: string }>("/api/bots/preview", {
      method: "POST",
      json: { packUrl: "packs/does-not-exist.json" },
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe(
      "There is no bot at that address. It may have been removed, or the link is wrong.",
    );
    expect(JSON.stringify(res.body)).not.toContain(directory.indexPath.split("/").slice(0, -1).join("/"));
  });

  it("names what is missing here: a connector not connected, a tool Steward does not have", async () => {
    const pack: BotPack = {
      ...NOTE_TAKER,
      id: "mail-notion",
      name: "Mail to Notion",
      needs: { tools: ["mail_read", "wipe_disk"], connectors: ["mail", "notion"], model: "any" },
      skills: [],
    };
    const res = await t.api<BotPreview & { problems: { path: string; severity: string }[] }>(
      "/api/bots/preview",
      {
        method: "POST",
        json: { pack },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.toolsMissing).toEqual(["wipe_disk"]);
    expect(res.body.needsMissing).toEqual(["notion"]);
    expect(res.body.mayDoWithoutAsking).toContain("read your mail");
    expect(res.body.problems.some((p) => p.path === "needs.tools[1]" && p.severity === "error")).toBe(true);
    const install = await t.api<{ error: string }>("/api/bots/install", { method: "POST", json: { pack } });
    expect(install.status).toBe(400);
    expect(install.body.error).toMatch(/wipe_disk/);
  });

  it("refuses a pack whose rule would allow something, naming the rule", async () => {
    const pack = {
      ...NOTE_TAKER,
      id: "generous",
      name: "Generous",
      rules: [{ name: "Let it pay", effect: "allow", when: 'tool.kind == "pay"', description: "" }],
    };
    const preview = await t.api<{ problems: { message: string }[] }>("/api/bots/preview", {
      method: "POST",
      json: { pack },
    });
    expect(preview.status).toBe(400);
    const res = await t.api<{ error: string; problems: { path: string; message: string }[] }>(
      "/api/bots/install",
      {
        method: "POST",
        json: { pack },
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Let it pay/);
    expect(res.body.problems.some((p) => p.path === "rules[0].effect")).toBe(true);
    expect((await t.api<InstalledBot[]>("/api/bots/installed")).body).toEqual([]);
  });

  it("adds by address only the pack the person read: one that changed since is refused", async () => {
    const preview = await t.api<BotPreview>("/api/bots/preview", {
      method: "POST",
      json: { packUrl: "packs/shell-helper.json" },
    });
    expect(preview.body.pack.hash).toBe(hashPack(SHELL_HELPER));
    const stale = await t.api<{ error: string }>("/api/bots/install", {
      method: "POST",
      json: { packUrl: "packs/shell-helper.json", hash: "0".repeat(64) },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/changed after you read it/);
    expect((await t.api<InstalledBot[]>("/api/bots/installed")).body).toEqual([]);
    const added = await t.api<InstalledBot>("/api/bots/install", {
      method: "POST",
      json: { packUrl: "packs/shell-helper.json", hash: preview.body.pack.hash },
    });
    expect(added.status).toBe(201);
    expect((await t.api(`/api/bots/installed/${added.body.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("answers 404 for a bot the directory does not have, and never shows a path on this machine", async () => {
    for (const packUrl of ["packs/does-not-exist.json", "packs/does-not-exist.json/inner"]) {
      const res = await t.api<{ error: string }>("/api/bots/preview", { method: "POST", json: { packUrl } });
      expect(res.status, packUrl).toBe(404);
      expect(res.body.error).toBe(
        "There is no bot at that address. It may have been removed, or the link is wrong.",
      );
    }
    // A pack path that is a folder: read, refused, and still no path.
    const folder = await t.api<{ error: string }>("/api/bots/preview", {
      method: "POST",
      json: { packUrl: "packs" },
    });
    expect(folder.status).toBe(502);
    expect(folder.body.error).toBe(
      "Couldn't get that bot from the directory: The pack at packs could not be read (EISDIR)",
    );
    expect(folder.body.error).not.toContain(dirname(directory.indexPath));
  });

  it("refuses a bot that takes one of Steward's own agent ids, or whose hash does not match", async () => {
    const taken = await t.api<{ error: string }>("/api/bots/install", {
      method: "POST",
      json: { pack: { ...NOTE_TAKER, id: "steward", name: "Not Steward" } },
    });
    expect(taken.status).toBe(400);
    expect(taken.body.error).toMatch(/own agents/);
    const changed = await t.api<{ error: string }>("/api/bots/install", {
      method: "POST",
      json: { pack: { ...NOTE_TAKER, hash: "0".repeat(64) } },
    });
    expect(changed.status).toBe(400);
    expect(changed.body.error).toMatch(/hash/);
    expect((await t.api("/api/bots/install", { method: "POST", json: {} })).status).toBe(400);
  });

  it("installs a pack as an agent with its skill, lists it, and removes exactly what it brought", async () => {
    const events: LiveEvent["type"][] = [];
    const unsubscribe = t.server.services.bus.subscribe((e) => events.push(e.type));
    const own = await t.api<Skill>("/api/skills", {
      method: "POST",
      json: { name: "my-own", description: "Mine.", instructions: "Do my thing.", tools: [] },
    });
    expect(own.status).toBe(201);

    const installed = await t.api<InstalledBot>("/api/bots/install", {
      method: "POST",
      json: { pack: NOTE_TAKER },
    });
    expect(installed.status).toBe(201);
    expect(installed.body).toMatchObject({
      id: "note-taker",
      version: 1,
      source: "local",
      agentId: "note-taker",
    });
    expect(installed.body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(installed.body.skillIds).toHaveLength(1);
    expect(installed.body.ruleIds).toEqual([]);
    expect(events).toContain("bots.changed");
    unsubscribe();

    const info = await t.api<AppInfo>("/api/info");
    const agent = info.body.agents.find((a) => a.id === "note-taker");
    expect(agent).toMatchObject({
      source: "bot:note-taker",
      name: "Note Taker",
      tools: ["file_write", "make_page"],
    });
    expect(agent?.skills).toEqual(["daily-note"]);
    expect(info.body.agents[0]).toMatchObject({ id: "steward", source: "tenant" });
    const thread = await t.api("/api/threads", { method: "POST", json: { agentId: "note-taker" } });
    expect(thread.status).toBe(201);

    const skills = (await t.api<Skill[]>("/api/skills")).body;
    expect(skills.find((s) => s.name === "daily-note")).toMatchObject({ source: "person" });
    const list = (await t.api<InstalledBot[]>("/api/bots/installed")).body;
    expect(list.map((b) => b.id)).toEqual(["note-taker"]);
    expect(list[0]?.updateAvailable).toBeUndefined();
    const again = await t.api<{ error: string }>("/api/bots/install", {
      method: "POST",
      json: { pack: NOTE_TAKER },
    });
    expect(again.status).toBe(409);
    const preview = await t.api<BotPreview>("/api/bots/preview", {
      method: "POST",
      json: { pack: NOTE_TAKER },
    });
    expect(preview.body.alreadyInstalled?.id).toBe("note-taker");
    const audit = await t.api<AuditPage>("/api/audit?type=bot.installed");
    expect(audit.body.events[0]?.detail).toMatchObject({ id: "note-taker", version: 1, source: "local" });

    expect((await t.api(`/api/bots/installed/note-taker`, { method: "DELETE" })).body).toEqual({ ok: true });
    expect((await t.api(`/api/bots/installed/note-taker`, { method: "DELETE" })).status).toBe(404);
    const after = (await t.api<Skill[]>("/api/skills")).body;
    expect(after.some((s) => s.name === "daily-note")).toBe(false);
    expect(after.some((s) => s.name === "my-own")).toBe(true);
    expect((await t.api<AppInfo>("/api/info")).body.agents.some((a) => a.id === "note-taker")).toBe(false);
    expect((await t.api("/api/threads", { method: "POST", json: { agentId: "note-taker" } })).status).toBe(
      400,
    );
    expect((await t.api<AuditPage>("/api/audit?type=bot.removed")).body.events[0]?.detail).toMatchObject({
      id: "note-taker",
    });
  });

  it("suffixes a skill whose name is taken, and the bot's agent uses that name", async () => {
    const mine = await t.api<Skill>("/api/skills", {
      method: "POST",
      json: { name: "daily-note", description: "Mine first.", instructions: "My own note.", tools: [] },
    });
    expect(mine.status).toBe(201);
    const res = await t.api<InstalledBot>("/api/bots/install", {
      method: "POST",
      json: { pack: NOTE_TAKER },
    });
    expect(res.status).toBe(201);
    const skills = (await t.api<Skill[]>("/api/skills")).body;
    expect(skills.find((s) => s.id === mine.body.id)?.instructions).toBe("My own note.");
    expect(skills.find((s) => s.id === res.body.skillIds[0])?.name).toBe("daily-note-note-taker");
    const agent = (await t.api<AppInfo>("/api/info")).body.agents.find((a) => a.id === "note-taker");
    expect(agent?.skills).toEqual(["daily-note-note-taker"]);
    expect((await t.api("/api/bots/installed/note-taker", { method: "DELETE" })).status).toBe(200);
    const left = (await t.api<Skill[]>("/api/skills")).body;
    expect(left.find((s) => s.id === mine.body.id)).toBeDefined();
    expect(left.some((s) => s.name === "daily-note-note-taker")).toBe(false);
  });

  it("never fetches a pack from this machine, a private network or cloud metadata from a link", async () => {
    let hits = 0;
    const local = createServer((_req, res) => {
      hits++;
      res.end(JSON.stringify(NOTE_TAKER));
    });
    await new Promise<void>((done) => local.listen(0, "127.0.0.1", done));
    const { port } = local.address() as AddressInfo;
    try {
      const cases: [string, RegExp][] = [
        [`http://127.0.0.1:${port}/pack.json`, /on this computer or its private network/],
        [`http://localhost:${port}/pack.json`, /on this computer or its private network/],
        ["https://10.0.0.5/pack.json", /on this computer or its private network/],
        ["https://169.254.169.254/latest/meta-data", /cloud metadata/],
        ["http://169.254.169.254/latest/meta-data", /only reads bots from https addresses/],
        ["http://bots.example/pack.json", /only reads bots from https addresses/],
      ];
      for (const [packUrl, why] of cases) {
        const res = await t.api<{ error: string }>("/api/bots/preview", {
          method: "POST",
          json: { packUrl },
        });
        expect(res.status, packUrl).toBe(502);
        expect(res.body.error, packUrl).toMatch(why);
      }
      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((done) => local.close(() => done()));
    }
  });

  it("never posts an install count for a directory read from a file", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await t.api<InstalledBot>("/api/bots/install", {
      method: "POST",
      json: { packUrl: "packs/rent-scout.json" },
    });
    // With bot rules not yet accepted by the gateway the install is refused; either way nothing is posted.
    expect([201, 400]).toContain(res.status);
    await new Promise((r) => setTimeout(r, 50));
    const posted = spy.mock.calls.filter(([input, init]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return init?.method === "POST" && /\/api\/bots\/[^/]+\/installed$/.test(url) && !url.startsWith(t.base);
    });
    expect(posted).toEqual([]);
    if (res.status === 201) await t.api("/api/bots/installed/rent-scout", { method: "DELETE" });
  });

  if (!haveGenerator) it.todo("make (waiting for @steward/bots-gen#generateBot)");
  it.runIf(haveGenerator)(
    "makes a bot with the scripted model that passes its own checks, not installed",
    async () => {
      const made = await t.api<BotPack>("/api/bots/make", {
        method: "POST",
        json: { job: "find me a flat to rent near Oxford", name: "Flat Finder" },
      });
      expect(made.status).toBe(200);
      expect(BotPackSchema.safeParse(made.body).success).toBe(true);
      expect(made.body.author.kind).toBe("ai");
      expect((await t.api<InstalledBot[]>("/api/bots/installed")).body).toEqual([]);
      const preview = await t.api<BotPreview & { problems: { severity: string }[] }>("/api/bots/preview", {
        method: "POST",
        json: { pack: made.body },
      });
      expect(preview.status).toBe(200);
      expect(preview.body.problems.filter((p) => p.severity === "error")).toEqual([]);
      expect((await t.api("/api/bots/make", { method: "POST", json: { job: "x" } })).status).toBe(400);
    },
  );

  it.runIf(haveGenerator)(
    "makes a template bot when the person's model answers with something unusable, and says so in the pack",
    async () => {
      const complete = vi.fn(async () => "Sorry, I can't write JSON today.");
      vi.spyOn(t.server.services.models, "textModel").mockReturnValue({ complete } as never);
      const made = await t.api<BotPack & { error?: string }>("/api/bots/make", {
        method: "POST",
        json: { job: "find me a flat to rent near Oxford", name: "Flat Finder" },
      });
      expect(complete).toHaveBeenCalled();
      expect(made.body.error).toBeUndefined();
      expect(made.status).toBe(200);
      expect(made.body.author).toMatchObject({ kind: "ai", model: "template" });
      expect(BotPackSchema.safeParse(made.body).success).toBe(true);
    },
  );

  it.runIf(haveGenerator)(
    "exports a made bot as a zip of its folder, credited to a handle when given, ready to submit",
    async () => {
      const made = await t.api<BotPack>("/api/bots/make", {
        method: "POST",
        json: { job: "share out the week's chores fairly", name: "Chore Chart" },
      });
      const res = await fetch(`${t.base}/api/bots/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack: made.body, handle: "@ana-b" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${made.body.id}.zip"`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = Buffer.from(bytes).toString("utf8");
      expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50);
      expect(text).toContain(`${made.body.id}/bot.yaml`);
      expect(text).toContain("handle: ana-b");
      expect(text).toContain("basedOnAi: true");

      const bad = await t.api<{ error: string }>("/api/bots/export", {
        method: "POST",
        json: {
          pack: { ...made.body, rules: [{ name: "Pay", effect: "allow", when: "true", description: "" }] },
        },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe(
        `This bot can't be submitted: The rule "Pay" would allow something. A bot's rules may only ask or deny.`,
      );
      const handle = await t.api("/api/bots/export", {
        method: "POST",
        json: { pack: made.body, handle: "not a handle" },
      });
      expect(handle.status).toBe(400);
    },
  );
});

if (!botRulesSupported)
  it.todo("installing bots with rules (waiting for the gateway to accept rule source `bot`)");

describe.runIf(missing.length === 0 && botRulesSupported)(
  "installing, updating and removing bots with rules",
  () => {
    let t: TestServer;
    let directory: ReturnType<typeof writeDirectory>;
    beforeAll(async () => {
      directory = writeDirectory([RENT_SCOUT, SHELL_HELPER]);
      t = await startTestServer({ STEWARD_DIRECTORY_URL: directory.indexPath });
    });
    afterAll(async () => {
      await t?.close();
      directory?.remove();
    });

    it("installs from the directory: the agent, the skill, the rule (source bot) and a paused routine", async () => {
      const presets = (await t.api<Rule[]>("/api/rules")).body.length;
      const res = await t.api<InstalledBot>("/api/bots/install", {
        method: "POST",
        json: { packUrl: "packs/rent-scout.json" },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: "rent-scout", version: 2, source: directory.indexPath });
      expect(res.body.ruleIds).toHaveLength(1);
      expect(res.body.routineIds).toHaveLength(1);

      const agent = (await t.api<AppInfo>("/api/info")).body.agents.find((a) => a.id === "rent-scout");
      expect(agent).toMatchObject({ source: "bot:rent-scout", skills: ["find-rentals"] });
      const rules = (await t.api<Rule[]>("/api/rules")).body;
      expect(rules).toHaveLength(presets + 1);
      expect(rules.find((r) => r.id === res.body.ruleIds[0])).toMatchObject({
        name: "Rent Scout: Never pay a deposit",
        effect: "deny",
        source: "bot",
        enabled: true,
      });
      const routine = (await t.api<Routine[]>("/api/routines")).body.find(
        (r) => r.id === res.body.routineIds[0],
      );
      expect(routine).toMatchObject({ title: "Morning rentals", enabled: false, agentId: "rent-scout" });
      expect((await t.api<Skill[]>("/api/skills")).body.find((s) => s.name === "find-rentals")?.source).toBe(
        "person",
      );

      const listed = await t.api<{ bots: (BotListing & { installed?: unknown })[] }>("/api/bots");
      expect(listed.body.bots.find((b) => b.id === "rent-scout")?.installed).toEqual({
        version: 2,
        updateAvailable: false,
      });
      expect(listed.body.bots.find((b) => b.id === "shell-helper")?.installed).toBeUndefined();
    });

    it("binds a bot's rules to its own agent: Steward and other bots are untouched", async () => {
      const drafts: BotPack = {
        ...NOTE_TAKER,
        id: "drafts-only",
        name: "Drafts Only",
        needs: { tools: ["mail_send", "file_write"], connectors: [], model: "any" },
        skills: [],
        rules: [
          { name: "Drafts only", effect: "deny", when: 'tool.kind == "send"', description: "Drafts only." },
          { name: "Ask before writing", effect: "ask", when: 'tool.kind == "write"', description: "" },
        ],
      };
      const res = await t.api<InstalledBot>("/api/bots/install", { method: "POST", json: { pack: drafts } });
      expect(res.status).toBe(201);
      const rules = (await t.api<Rule[]>("/api/rules")).body.filter((r) => res.body.ruleIds.includes(r.id));
      expect(rules.map((r) => r.when).sort()).toEqual([
        'agent.id == "drafts-only" && (tool.kind == "send"\n)',
        'agent.id == "drafts-only" && (tool.kind == "write"\n)',
      ]);
      const { governance } = t.server.services.gateway;
      const decide = (tool: string, agentId: string) =>
        governance.dryRun(gateCallFor({ tool, args: {}, agentId, actorId: "local" })).effect;
      expect(decide("mail_send", "drafts-only")).toBe("deny");
      expect(decide("file_write", "drafts-only")).toBe("ask");
      // Steward's own agent keeps the gateway's defaults: a send asks, a file write runs.
      expect(decide("mail_send", "steward")).toBe("ask");
      expect(decide("file_write", "steward")).toBe("allow");
      expect(decide("file_write", "rent-scout")).toBe("allow");
      expect((await t.api("/api/bots/installed/drafts-only", { method: "DELETE" })).status).toBe(200);
    });

    it("previews what a pack may do under its own rules, never the installed version's", async () => {
      const v1: BotPack = {
        ...NOTE_TAKER,
        id: "careful-notes",
        name: "Careful Notes",
        version: 1,
        needs: { tools: ["file_write"], connectors: [], model: "any" },
        skills: [],
        rules: [{ name: "Ask before writing", effect: "ask", when: 'tool.kind == "write"', description: "" }],
      };
      const preview = async (pack: BotPack) =>
        (await t.api<BotPreview>("/api/bots/preview", { method: "POST", json: { pack } })).body;

      // Not installed yet: its own rule already decides, so writing asks.
      const fresh = await preview(v1);
      expect(fresh.mayDoWithoutAsking).not.toContain("write files in its workspace");
      expect(fresh.asksBefore).toContain("write files in its workspace");

      expect((await t.api("/api/bots/install", { method: "POST", json: { pack: v1 } })).status).toBe(201);
      // Version 2 drops that rule and adds a tool: both now run without asking, and the update says so.
      const v2: BotPack = {
        ...v1,
        version: 2,
        needs: { ...v1.needs, tools: ["file_write", "task_update"] },
        rules: [],
      };
      const next = await preview(v2);
      expect(next.mayDoWithoutAsking).toEqual(["write files in its workspace", "change tasks"]);
      expect(next.asksBefore).not.toContain("write files in its workspace");
      expect(next.changes).toEqual([
        "New: it may change tasks without asking.",
        "Drops the rule “Ask before writing” (it asks first).",
      ]);
      // Previewing changes nothing: the installed version still asks before writing.
      const decide = (tool: string) =>
        t.server.services.gateway.governance.dryRun(
          gateCallFor({ tool, args: {}, agentId: "careful-notes", actorId: "local" }),
        ).effect;
      expect(decide("file_write")).toBe("ask");
      expect((await t.api("/api/bots/installed/careful-notes", { method: "DELETE" })).status).toBe(200);
    });

    it("limits the rules of a bot installed before rules were scoped, leaving edited ones alone", async () => {
      const { gateway, installedBots, bots } = t.server.services;
      const pack: BotPack = {
        ...NOTE_TAKER,
        id: "old-bot",
        name: "Old Bot",
        skills: [],
        rules: [
          { name: "No sending", effect: "deny", when: 'tool.kind == "send"', description: "" },
          { name: "Ask on writes", effect: "ask", when: 'tool.kind == "write"', description: "" },
        ],
      };
      const make = (name: string, effect: "ask" | "deny", when: string) =>
        gateway.rules.create({ name, effect, when, description: "", enabled: true, source: "bot" });
      const unscoped = make("Old Bot: No sending", "deny", 'tool.kind == "send"');
      // The person changed this one on Rules: it is theirs now.
      const edited = make("Old Bot: Ask on writes", "ask", 'tool.kind == "write" && tool.surface == "file"');
      installedBots.upsert({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        hash: "0".repeat(64),
        source: "local",
        agentId: pack.id,
        pack,
        skillIds: [],
        ruleIds: [unscoped.id, edited.id],
        routineIds: [],
      });
      const decide = (tool: string, agentId: string) =>
        gateway.governance.dryRun(gateCallFor({ tool, args: {}, agentId, actorId: "local" })).effect;
      expect(decide("mail_send", "steward")).toBe("deny");

      expect(bots.scopeInstalledRules()).toBe(1);
      expect(gateway.rules.get(unscoped.id)?.when).toBe('agent.id == "old-bot" && (tool.kind == "send"\n)');
      expect(gateway.rules.get(edited.id)?.when).toBe('tool.kind == "write" && tool.surface == "file"');
      expect(decide("mail_send", "steward")).toBe("ask");
      expect(decide("mail_send", "old-bot")).toBe("deny");
      // Running it again changes nothing.
      expect(bots.scopeInstalledRules()).toBe(0);
      await bots.remove(pack.id);
      expect(gateway.rules.get(unscoped.id)).toBeUndefined();
      expect(gateway.rules.get(edited.id)).toBeUndefined();
    });

    it("removes exactly what a bot brought: another bot's and the person's own things survive", async () => {
      const shell = await t.api<InstalledBot>("/api/bots/install", {
        method: "POST",
        json: { packUrl: "packs/shell-helper.json" },
      });
      expect(shell.status).toBe(201);
      const ownRule = await t.api<Rule>("/api/rules", {
        method: "POST",
        json: { name: "Mine", effect: "deny", when: 'tool.name == "mail_send"', description: "" },
      });
      expect(ownRule.status).toBe(201);
      const ownSkill = await t.api<Skill>("/api/skills", {
        method: "POST",
        json: { name: "daily-note", description: "Mine.", instructions: "My own note.", tools: [] },
      });
      expect(ownSkill.status).toBe(201);
      const before = {
        rules: (await t.api<Rule[]>("/api/rules")).body,
        skills: (await t.api<Skill[]>("/api/skills")).body,
        routines: (await t.api<Routine[]>("/api/routines")).body,
      };
      const rent = (await t.api<InstalledBot[]>("/api/bots/installed")).body.find(
        (b) => b.id === "rent-scout",
      )!;

      expect((await t.api("/api/bots/installed/rent-scout", { method: "DELETE" })).body).toEqual({
        ok: true,
      });

      const after = {
        rules: (await t.api<Rule[]>("/api/rules")).body,
        skills: (await t.api<Skill[]>("/api/skills")).body,
        routines: (await t.api<Routine[]>("/api/routines")).body,
      };
      expect(after.rules.map((r) => r.id).sort()).toEqual(
        before.rules
          .map((r) => r.id)
          .filter((id) => !rent.ruleIds.includes(id))
          .sort(),
      );
      expect(after.skills.map((s) => s.id).sort()).toEqual(
        before.skills
          .map((s) => s.id)
          .filter((id) => !rent.skillIds.includes(id))
          .sort(),
      );
      expect(after.routines.map((r) => r.id)).toEqual(
        before.routines.map((r) => r.id).filter((id) => !rent.routineIds.includes(id)),
      );
      expect(after.rules.some((r) => r.id === ownRule.body.id)).toBe(true);
      expect(after.rules.some((r) => r.id === shell.body.ruleIds[0])).toBe(true);
      expect(after.skills.some((s) => s.name === "daily-note")).toBe(true);
      const agents = (await t.api<AppInfo>("/api/info")).body.agents.map((a) => a.id);
      expect(agents).toContain("shell-helper");
      expect(agents).not.toContain("rent-scout");
      expect((await t.api<AuditPage>("/api/audit?type=bot.removed")).body.events[0]?.detail).toMatchObject({
        id: "rent-scout",
        version: 2,
      });
    });

    it("updates: an older install shows the newer listing, and the update replaces what it brought", async () => {
      const v1: BotPack = {
        ...RENT_SCOUT,
        version: 1,
        needs: { ...RENT_SCOUT.needs, tools: ["browser_snapshot", "web_search", "show_table"] },
        skills: [{ ...RENT_SCOUT.skills[0]!, body: "The old way: search one site only." }],
      };
      const first = await t.api<InstalledBot>("/api/bots/install", { method: "POST", json: { pack: v1 } });
      expect(first.status).toBe(201);

      // Before it is applied, the update says what it changes.
      const preview = await t.api<BotPreview>("/api/bots/preview", {
        method: "POST",
        json: { packUrl: "packs/rent-scout.json" },
      });
      expect(preview.body.alreadyInstalled?.version).toBe(1);
      expect(preview.body.changes).toEqual([
        "New: it may browse the web on its own computer without asking.",
        "Changes what /find-rentals does.",
      ]);
      const same = await t.api<BotPreview>("/api/bots/preview", { method: "POST", json: { pack: v1 } });
      expect(same.body.changes).toBeUndefined();
      const listed = (await t.api<InstalledBot[]>("/api/bots/installed")).body.find(
        (b) => b.id === "rent-scout",
      );
      expect(listed?.updateAvailable).toEqual({ version: 2, packUrl: "packs/rent-scout.json" });
      expect(
        (await t.api<{ bots: { id: string; installed?: unknown }[] }>("/api/bots")).body.bots.find(
          (b) => b.id === "rent-scout",
        )?.installed,
      ).toEqual({ version: 1, updateAvailable: true });

      const updated = await t.api<InstalledBot>("/api/bots/installed/rent-scout/update", { method: "POST" });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ id: "rent-scout", version: 2, source: directory.indexPath });
      expect(updated.body.installedAt).toBe(first.body.installedAt);
      expect(updated.body.skillIds).not.toEqual(first.body.skillIds);
      const skills = (await t.api<Skill[]>("/api/skills")).body.filter((s) => s.name === "find-rentals");
      expect(skills).toHaveLength(1);
      expect(skills[0]?.instructions).toBe(RENT_SCOUT.skills[0]!.body);
      expect(
        (await t.api<Rule[]>("/api/rules")).body.filter((r) => r.name === "Rent Scout: Never pay a deposit"),
      ).toHaveLength(1);
      expect((await t.api<AuditPage>("/api/audit?type=bot.updated")).body.events[0]?.detail).toMatchObject({
        id: "rent-scout",
        version: 2,
        from: 1,
      });
      expect(
        (await t.api<InstalledBot[]>("/api/bots/installed")).body.find((b) => b.id === "rent-scout")
          ?.updateAvailable,
      ).toBeUndefined();

      expect((await t.api("/api/bots/installed/rent-scout/update", { method: "POST" })).status).toBe(409);
      expect((await t.api("/api/bots/installed/nobody/update", { method: "POST" })).status).toBe(404);
      const older = await t.api<{ error: string }>("/api/bots/install", {
        method: "POST",
        json: { pack: v1 },
      });
      expect(older.status).toBe(409);
      expect(older.body.error).toMatch(/newer version/);
    });
  },
);
