import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { type TenantPackage, TOOLS } from "@steward/shared";
import { describe, expect, it } from "vitest";
// Relative, as tenants/tenants.test.ts does: @steward/agent depends on this package, so this
// package cannot depend on it without a cycle.
import { loadTenant } from "../../agent/src/tenant.ts";
import { hashPack } from "../src/canonical.ts";
import { describeMayDo, expandStar, packFromTenant, profileFromPack } from "../src/tenant.ts";
import { validatePack } from "../src/validate.ts";

const TENANTS = fileURLToPath(new URL("../../../tenants/", import.meta.url));
const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
const ctx = { tools: Object.keys(TOOLS), validateRule: (when: string) => engine.validate(when) };

const JOB_TOOLS = Object.keys(TOOLS).filter((t) => !t.startsWith("show_") && t !== "request_secret");

describe("packFromTenant", () => {
  it("turns tenants/steward into a productivity bot that passes validation", () => {
    const tenant = loadTenant(join(TENANTS, "steward"));
    const pack = packFromTenant(tenant);
    expect(pack).toMatchObject({
      id: "steward",
      name: "Steward",
      pitch: tenant.brand.tagline,
      category: "productivity",
      version: 1,
      author: { kind: "person", handle: "Steward" },
      licence: "MIT",
      needs: { tools: JOB_TOOLS, connectors: [], model: "any" },
      instructions: tenant.agents[0]?.instructions,
      starters: tenant.starters,
      examples: [],
      routines: [],
      shortcuts: [],
    });
    expect(pack.needs.tools).toContain("directory_find");
    expect(pack.needs.tools).not.toContain("show_table");
    expect(pack.needs.tools).not.toContain("request_secret");
    expect(pack.skills.map((s) => s.name)).toEqual(tenant.agents[0]?.skills);
    const weekly = tenant.skills.find((s) => s.name === "weekly-review");
    expect(pack.skills[0]).toEqual({
      name: "weekly-review",
      description: weekly?.description,
      body: weekly?.instructions,
      allowedTools: weekly?.tools,
    });
    expect(pack.rules).toEqual(tenant.rules);
    expect(pack.rules.every((r) => r.effect === "ask" || r.effect === "deny")).toBe(true);
    expect(pack.readme).toContain("# Steward");
    expect(pack.readme).toContain("**weekly-review**");
    expect(pack.hash).toBe(hashPack(pack));

    const result = validatePack(pack, ctx);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("turns tenants/tempo into a money bot with its deny rules", () => {
    const tenant = loadTenant(join(TENANTS, "tempo"));
    const pack = packFromTenant(tenant);
    expect(pack).toMatchObject({
      id: "tempo",
      name: "Tempo",
      category: "money",
      author: { kind: "person", handle: "Tempo" },
    });
    expect(pack.skills.map((s) => s.name)).toEqual(["delay-repay-claim", "scam-check", "subscription-audit"]);
    expect(pack.rules.map((r) => [r.name, r.effect])).toEqual([
      ["Tempo never pays", "deny"],
      ["Tempo never types bank or card details", "deny"],
      ["Bank and card numbers never leave", "deny"],
    ]);
    expect(pack.starters).toHaveLength(5);
    const result = validatePack(pack, ctx);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("leaves allow rules out, picks the agent by id, and fills in what is missing", () => {
    const tenant: TenantPackage = {
      id: "acme",
      brand: { name: "Acme", tagline: "", accent: "#000", voice: "Plain and brief." },
      agents: [
        { id: "first", name: "First", title: "The first", instructions: "", skills: ["x"], tools: ["*"] },
        {
          id: "second",
          name: "Second",
          title: "The second",
          instructions: "Be second.",
          skills: [],
          tools: ["web_fetch", "mcp__notes__add", "web_fetch"],
        },
      ],
      skills: [
        { id: "tenant:x", name: "x", description: "X.", instructions: "Do x.", tools: [], source: "tenant" },
      ],
      rules: [
        { name: "Allow all", effect: "allow", when: "true", description: "" },
        { name: "Ask mail", effect: "ask", when: 'tool.surface == "mail"', description: "Mail asks." },
      ],
      model: { provider: "scripted", model: "x" },
      starters: [],
    };
    const first = packFromTenant(tenant);
    expect(first.pitch).toBe("The first");
    expect(first.instructions).toBe("Plain and brief.");
    expect(first.rules).toEqual([
      { name: "Ask mail", effect: "ask", when: 'tool.surface == "mail"', description: "Mail asks." },
    ]);
    expect(first.skills).toEqual([{ name: "x", description: "X.", body: "Do x." }]);
    const second = packFromTenant(tenant, "second");
    expect(second.id).toBe("second");
    expect(second.needs.tools).toEqual(["web_fetch", "mcp__notes__add"]);
    expect(() => packFromTenant(tenant, "third")).toThrow(/no agent called "third"/);
  });

  it("expands * to the job tools, once each, in order of first appearance", () => {
    expect(expandStar(["web_fetch", "*", "web_fetch"])).toEqual([
      "web_fetch",
      ...JOB_TOOLS.filter((t) => t !== "web_fetch"),
    ]);
  });
});

describe("profileFromPack", () => {
  it("makes an agent whose source names the bot", () => {
    const pack = packFromTenant(loadTenant(join(TENANTS, "tempo")));
    expect(profileFromPack(pack)).toEqual({
      id: "tempo",
      name: "Tempo",
      title: pack.pitch,
      instructions: pack.instructions,
      skills: ["delay-repay-claim", "scam-check", "subscription-audit"],
      tools: pack.needs.tools,
      source: "bot:tempo",
    });
  });
});

describe("describeMayDo", () => {
  it("says what the tools mean, once each, leaving out what always asks", () => {
    expect(
      describeMayDo([
        "mail_list",
        "mail_read",
        "mail_send",
        "shell_run",
        "web_search",
        "mcp__x__y",
        "directory_find",
      ]),
    ).toEqual(["read your mail", "search the web", "look up bots in the directory"]);
    expect(describeMayDo([])).toEqual([]);
  });
});
