import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateBot } from "@steward/bots-gen";
import { memoryDb } from "@steward/db";
import { createGateway } from "@steward/gateway";
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
import { countsEndpoint } from "../src/bots/service.ts";
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

describe("countsEndpoint", () => {
  it("is nowhere for a directory read from a file", () => {
    expect(countsEndpoint("/srv/steward/directory/index.json", "rent-scout")).toBeUndefined();
    expect(
      countsEndpoint("directory/index.json", "rent-scout", { site: "https://bots.example" }),
    ).toBeUndefined();
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
        skills: [{ ...RENT_SCOUT.skills[0]!, body: "The old way: search one site only." }],
      };
      const first = await t.api<InstalledBot>("/api/bots/install", { method: "POST", json: { pack: v1 } });
      expect(first.status).toBe(201);
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
