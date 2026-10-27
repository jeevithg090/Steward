import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BRAND, DEFAULT_MODEL, DEFAULT_STARTERS, loadTenant, TenantError } from "../src/tenant.ts";

const made: string[] = [];

function tenantDir(files: Record<string, string>, name = "acme"): string {
  const root = mkdtempSync(join(tmpdir(), "steward-tenant-"));
  made.push(root);
  const dir = join(root, name);
  mkdirSync(dir);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function loadError(dir: string): TenantError {
  try {
    loadTenant(dir);
  } catch (error) {
    if (error instanceof TenantError) return error;
    throw error;
  }
  throw new Error("expected loadTenant to throw");
}

describe("loadTenant", () => {
  it("reads all five files", () => {
    const dir = tenantDir({
      "brand.yaml": [
        "name: Acme Helper",
        "tagline: Helps with Acme.",
        'accent: "#123456"',
        "voice: Crisp.",
        'starters: ["What is new?"]',
      ].join("\n"),
      "agents.yaml": [
        "agents:",
        "  - id: helper",
        "    name: Helper",
        "    title: Your helper",
        "    instructions: Be kind.",
        "    skills: [weekly-review]",
        "    tools: [web_fetch, web_search, mcp__notes__add]",
        "    model: openai/gpt-5-mini",
      ].join("\n"),
      "skills.yaml": [
        "skills:",
        "  - name: weekly-review",
        "    description: Review the week",
        "    instructions: List what got done.",
        "    tools: [mail_list]",
      ].join("\n"),
      "rules.yaml": [
        "rules:",
        "  - name: Ask about the calendar",
        "    effect: ask",
        "    when: 'tool.surface == \"calendar\"'",
        "    description: Calendar changes ask first.",
      ].join("\n"),
      "model.yaml": "provider: nvidia\nmodel: meta/llama-3.3-70b-instruct\napiKeyEnv: ACME_NIM_KEY\n",
    });
    const tenant = loadTenant(dir);
    expect(tenant.id).toBe("acme");
    expect(tenant.brand).toEqual({
      name: "Acme Helper",
      tagline: "Helps with Acme.",
      accent: "#123456",
      voice: "Crisp.",
    });
    expect(tenant.starters).toEqual(["What is new?"]);
    expect(tenant.agents).toEqual([
      {
        id: "helper",
        name: "Helper",
        title: "Your helper",
        instructions: "Be kind.",
        skills: ["weekly-review"],
        tools: ["web_fetch", "web_search", "mcp__notes__add"],
        model: "openai/gpt-5-mini",
      },
    ]);
    expect(tenant.skills).toEqual([
      {
        id: "tenant:weekly-review",
        name: "weekly-review",
        description: "Review the week",
        instructions: "List what got done.",
        tools: ["mail_list"],
        source: "tenant",
      },
    ]);
    expect(tenant.rules).toEqual([
      {
        name: "Ask about the calendar",
        effect: "ask",
        when: 'tool.surface == "calendar"',
        description: "Calendar changes ask first.",
      },
    ]);
    expect(tenant.model).toEqual({
      provider: "nvidia",
      model: "meta/llama-3.3-70b-instruct",
      apiKeyEnv: "ACME_NIM_KEY",
    });
  });

  it("falls back to Steward's defaults for missing or empty files", () => {
    const tenant = loadTenant(tenantDir({ "rules.yaml": "" }));
    expect(tenant.brand).toEqual(DEFAULT_BRAND);
    expect(tenant.starters).toEqual([...DEFAULT_STARTERS]);
    expect(tenant.agents).toEqual([
      { id: "steward", name: "Steward", title: "Your steward", instructions: "", skills: [], tools: ["*"] },
    ]);
    expect(tenant.skills).toEqual([]);
    expect(tenant.rules).toEqual([]);
    expect(tenant.model).toEqual(DEFAULT_MODEL);
  });

  it("fills missing fields inside a file", () => {
    const tenant = loadTenant(tenantDir({ "brand.yaml": "name: Tempo\n" }));
    expect(tenant.brand.name).toBe("Tempo");
    expect(tenant.brand.accent).toBe(DEFAULT_BRAND.accent);
    expect(tenant.agents[0]?.name).toBe("Tempo");
  });

  it("names the file and the field when something is wrong", () => {
    const err = loadError(tenantDir({ "agents.yaml": "agents:\n  - id: Bad Id\n    name: x\n" }));
    expect(err.file).toBe("agents.yaml");
    expect(err.message).toMatch(/^agents\.yaml: agents\[0\]\.id: /);
  });

  it("refuses unknown fields, so a typo never silently does nothing", () => {
    const err = loadError(
      tenantDir({ "rules.yaml": "rules:\n  - name: x\n    effect: deny\n    wen: 'true'\n" }),
    );
    expect(err.message).toContain("rules.yaml");
    expect(err.message).toContain('unknown field "wen"');
  });

  it("refuses an unknown effect, provider or tool", () => {
    expect(
      loadError(tenantDir({ "rules.yaml": "rules:\n  - name: x\n    effect: maybe\n    when: 'true'\n" }))
        .message,
    ).toMatch(/rules\.yaml: rules\[0\]\.effect/);
    expect(loadError(tenantDir({ "model.yaml": "provider: skynet\nmodel: x\n" })).message).toMatch(
      /model\.yaml: provider/,
    );
    expect(
      loadError(
        tenantDir({ "agents.yaml": "agents:\n  - id: a\n    name: A\n    tools: [launch_rockets]\n" }),
      ).message,
    ).toContain('"launch_rockets" is not a Steward tool');
  });

  it("refuses an agent that names a skill the tenant does not have", () => {
    const err = loadError(
      tenantDir({ "agents.yaml": "agents:\n  - id: a\n    name: A\n    skills: [missing]\n" }),
    );
    expect(err.message).toContain('agents.yaml: agents[0].skills[0]: no skill named "missing"');
  });

  it("refuses a key where the name of its environment variable belongs", () => {
    const err = loadError(
      tenantDir({ "model.yaml": "provider: openrouter\nmodel: x\napiKeyEnv: sk-or-v1-abc\n" }),
    );
    expect(err.message).toMatch(/model\.yaml: apiKeyEnv: must be the NAME/);
  });

  it("refuses broken YAML and an accent that could break out of CSS", () => {
    expect(loadError(tenantDir({ "brand.yaml": "name: [unclosed\n" })).message).toMatch(
      /^brand\.yaml: is not valid YAML/,
    );
    expect(loadError(tenantDir({ "brand.yaml": 'accent: "red; background: url(x)"\n' })).message).toMatch(
      /brand\.yaml: accent/,
    );
  });

  it("refuses duplicate agent ids and skill names", () => {
    expect(
      loadError(tenantDir({ "agents.yaml": "agents:\n  - { id: a, name: A }\n  - { id: a, name: B }\n" }))
        .message,
    ).toContain('agents[1].id: "a" is used twice');
    const skill = "  - { name: s, description: d, instructions: i }\n";
    expect(loadError(tenantDir({ "skills.yaml": `skills:\n${skill}${skill}` })).message).toContain(
      '"s" is used twice',
    );
  });

  it("says when the folder does not exist", () => {
    expect(() => loadTenant(join(tmpdir(), "no-such-tenant-folder-xyz"))).toThrow(/Tenant folder not found/);
  });
});
