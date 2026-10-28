import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  briefAutomation,
  buildCatalogue,
  loadTenantShortcuts,
  type PhoneProfile,
  TenantShortcutsError,
} from "../src/index.ts";

const empty: PhoneProfile = { skills: [], routines: [], bots: [], mailConnected: false };

const ids = (p: PhoneProfile) => buildCatalogue(p).map((e) => e.id);

describe("buildCatalogue", () => {
  it("always offers asking, the brief, what needs you and Check this", () => {
    expect(ids(empty)).toEqual(["ask", "brief", "approvals", "check"]);
    const byId = Object.fromEntries(buildCatalogue(empty).map((e) => [e.id, e]));
    expect(byId.ask?.scopes).toEqual(["chat"]);
    expect(byId.brief?.scopes).toEqual(["brief:read"]);
    expect(byId.approvals?.scopes).toEqual(["approvals:read"]);
    expect(byId.brief?.siriPhrase).toBe("Steward: What needs me?");
  });

  it("says more about Check this when mail is connected", () => {
    const off = buildCatalogue(empty).find((e) => e.id === "check")!;
    const on = buildCatalogue({ ...empty, mailConnected: true }).find((e) => e.id === "check")!;
    expect(on.description).toMatch(/need you/);
    expect(off.description).not.toMatch(/need you/);
  });

  it("adds each skill and each routine that is switched on, with stable ids", () => {
    const profile: PhoneProfile = {
      ...empty,
      skills: [
        { name: "weekly-review", description: "Look back at the week." },
        { name: "BAD NAME", description: "x" },
      ],
      routines: [
        { id: "rtn_1", title: "Morning inbox sweep", enabled: true },
        { id: "rtn_2", title: "Paused one", enabled: false },
      ],
    };
    const entries = buildCatalogue(profile);
    expect(entries.map((e) => e.id)).toEqual([
      "ask",
      "brief",
      "approvals",
      "check",
      "skill:weekly-review",
      "routine:rtn_1",
    ]);
    expect(entries.find((e) => e.id === "skill:weekly-review")).toMatchObject({
      title: "Weekly review",
      siriPhrase: "Steward: Weekly review",
      action: { kind: "skill", ref: "weekly-review" },
      scopes: ["chat"],
      source: "skill",
    });
    expect(entries.find((e) => e.id === "routine:rtn_1")).toMatchObject({
      action: { kind: "routine", ref: "rtn_1" },
      scopes: ["routines:run"],
    });
  });

  it("adds a new skill with no re-import: the same call, a longer list", () => {
    const before = ids(empty);
    const after = ids({ ...empty, skills: [{ name: "plan-trip", description: "Plan a trip." }] });
    expect(after).toEqual([...before, "skill:plan-trip"]);
  });

  it("adds the tenant's shortcuts as prompts, through the skill they name", () => {
    const entries = buildCatalogue({
      ...empty,
      tenant: {
        id: "tempo",
        name: "Tempo",
        shortcuts: [
          {
            id: "scam-spotter",
            title: "Scam Spotter",
            description: "d",
            skill: "scam-check",
            prompt: "Is this a scam? {input}",
          },
        ],
      },
    });
    expect(entries.at(-1)).toMatchObject({
      id: "tenant:scam-spotter",
      source: "tenant",
      action: { kind: "tenant", ref: "scam-spotter" },
      prompt: "/scam-check Is this a scam? {input}",
      scopes: ["chat"],
    });
  });

  it("takes a bot's launchers as prompts only, and never more than chat", () => {
    const entries = buildCatalogue({
      ...empty,
      bots: [
        {
          id: "rent-scout",
          name: "Rent Scout",
          shortcuts: [
            {
              id: "find",
              title: "Find a flat",
              description: "Search listings.",
              action: { kind: "skill", ref: "rent-scout-search" },
              scopes: ["approvals:decide", "routines:run"],
              source: "bot",
            },
            {
              id: "nothing",
              title: "No prompt",
              description: "",
              action: { kind: "brief" },
              scopes: [],
              source: "bot",
            },
          ],
        },
      ],
    });
    const bot = entries.filter((e) => e.source === "bot");
    expect(bot).toHaveLength(1);
    expect(bot[0]).toMatchObject({
      id: "bot:rent-scout:find",
      prompt: "/rent-scout-search {input}",
      scopes: ["chat"],
    });
  });
});

describe("briefAutomation", () => {
  it("offers the morning brief at the person's brief time", () => {
    expect(briefAutomation({ briefTime: "07:30" })).toEqual({ time: "07:30", input: "action:brief" });
    expect(briefAutomation({})).toBeUndefined();
  });
});

describe("tenant shortcuts.yaml", () => {
  it("loads Tempo's two shortcuts", () => {
    const dir = fileURLToPath(new URL("../../../tenants/tempo", import.meta.url));
    const shortcuts = loadTenantShortcuts(dir);
    expect(shortcuts.map((s) => s.id)).toEqual(["delay-spotter", "scam-spotter"]);
    expect(shortcuts[0]).toMatchObject({ skill: "delay-repay-claim", share: true });
    expect(shortcuts[1]).toMatchObject({ skill: "scam-check" });
    for (const s of shortcuts) expect(s.prompt).toContain("{input}");
  });

  it("is optional, and names the file when it is wrong", () => {
    const dir = mkdtempSync(join(tmpdir(), "steward-tenant-"));
    try {
      expect(loadTenantShortcuts(dir)).toEqual([]);
      writeFileSync(
        join(dir, "shortcuts.yaml"),
        "shortcuts:\n  - id: Bad Id\n    title: x\n    description: y\n    prompt: z\n",
      );
      expect(() => loadTenantShortcuts(dir)).toThrow(TenantShortcutsError);
      writeFileSync(
        join(dir, "shortcuts.yaml"),
        "shortcuts:\n  - {id: a, title: x, description: y, prompt: z}\n  - {id: a, title: x, description: y, prompt: z}\n",
      );
      expect(() => loadTenantShortcuts(dir)).toThrow(/twice/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
