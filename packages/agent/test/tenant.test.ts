import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BRAND, DEFAULT_MODEL, DEFAULT_STARTERS, loadTenant, TenantError } from "../src/tenant.ts";
import { TENANT_ALLOW_GUARD } from "../src/tenant-rules.ts";

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
    expect(err.message).toMatch(/^agents\.yaml line 2: agents\[0\]\.id: id must be lower case/);
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
    ).toBe("rules.yaml line 3: rules[0].effect: must be one of allow, ask, deny");
    expect(loadError(tenantDir({ "model.yaml": "provider: skynet\nmodel: x\n" })).message).toMatch(
      /^model\.yaml line 1: provider: must be one of openrouter, openai, /,
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
    expect(err.message).toBe(
      'agents.yaml line 4: agents[0].skills[0]: no skill named "missing" (skills.yaml has none)',
    );
  });

  it("refuses a key where the name of its environment variable belongs", () => {
    const err = loadError(
      tenantDir({ "model.yaml": "provider: openrouter\nmodel: x\napiKeyEnv: sk-or-v1-abc\n" }),
    );
    expect(err.message).toMatch(/^model\.yaml line 3: apiKeyEnv: must be the NAME/);
  });

  it("refuses broken YAML and an accent that could break out of CSS", () => {
    expect(loadError(tenantDir({ "brand.yaml": "name: [unclosed\n" })).message).toMatch(
      /^brand\.yaml: is not valid YAML/,
    );
    expect(loadError(tenantDir({ "brand.yaml": 'accent: "red; background: url(x)"\n' })).message).toMatch(
      /^brand\.yaml line 1: accent: must be a colour/,
    );
  });

  it("says what is wrong in plain words, on the line it is on", () => {
    const missing = loadError(
      tenantDir({ "skills.yaml": "skills:\n  - name: weekly-review\n    instructions: List it.\n" }),
    );
    expect(missing.message).toBe("skills.yaml line 2: skills[0].description: is missing");
    expect(loadError(tenantDir({ "brand.yaml": "tagline: Hi\nname: 7\n" })).message).toBe(
      "brand.yaml line 2: name: must be text",
    );
    const starters = Array.from({ length: 9 }, (_, i) => `  - Ask ${i}`).join("\n");
    expect(loadError(tenantDir({ "brand.yaml": `starters:\n${starters}\n` })).message).toBe(
      "brand.yaml line 2: starters: can have at most 8 items",
    );
    expect(loadError(tenantDir({ "agents.yaml": "agents: []\n" })).message).toBe(
      "agents.yaml line 1: agents: needs at least 1 item",
    );
    expect(
      loadError(tenantDir({ "agents.yaml": "agents:\n  - id: a\n    name: A\n    nmae: B\n" })).message,
    ).toBe('agents.yaml line 4: agents[0]: unknown field "nmae"');
    expect(
      loadError(
        tenantDir({ "skills.yaml": "skills:\n  - name: s\n    description: d\n    instructions: ''\n" }),
      ).message,
    ).toBe("skills.yaml line 4: skills[0].instructions: needs some text");
  });

  it("lists every problem in a file, each with its line", () => {
    const err = loadError(tenantDir({ "brand.yaml": "name: 7\ntagline: Hi\nvoice: [a]\n" }));
    expect(err.message).toBe("brand.yaml line 1: name: must be text; line 3: voice: must be text");
  });

  it("shows how the file starts when the list's name is left out", () => {
    const err = loadError(tenantDir({ "agents.yaml": "id: helper\nname: Helper\n" }));
    expect(err.message).toBe(
      'agents.yaml: the file must start with "agents:" and list each one under it, starting with "- ", like this:\n\n  agents:\n    - id: helper\n      name: Helper\n',
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

  it("says when the folder does not exist, and which packages do", () => {
    expect(() => loadTenant(join(tmpdir(), "no-such-tenant-folder-xyz"))).toThrow(/Tenant folder not found/);
    const acme = tenantDir({});
    const err = loadError(join(acme, "..", "acmee"));
    expect(err.message).toMatch(/Tenant folder not found: .*acmee\. The packages there are: acme$/);
  });
});

/** A rules.yaml with one rule. */
function oneRule(effect: string, when: string, name = "Mine"): Record<string, string> {
  return { "rules.yaml": `rules:\n  - name: ${name}\n    effect: ${effect}\n    when: '${when}'\n` };
}

describe("loadTenant: rules.yaml", () => {
  it("names the file, the rule and the reason when a condition does not compile", () => {
    const err = loadError(tenantDir(oneRule("deny", 'tool.kind = "pay"', "Bad")));
    expect(err.file).toBe("rules.yaml");
    expect(err.message).toMatch(/^rules\.yaml line 4: rules\[0\] "Bad": it is not valid CEL: /);
    expect(err.message).not.toContain("cannot be used");
    expect(loadError(tenantDir(oneRule("ask", "tool.knd == 1"))).message).toMatch(
      /^rules\.yaml line 4: rules\[0\] "Mine": tool has no field 'knd'/,
    );
  });

  it("refuses two rules with the same name, since rules are matched by name", () => {
    const rule = "  - name: Same\n    effect: deny\n    when: 'false'\n";
    expect(loadError(tenantDir({ "rules.yaml": `rules:\n${rule}${rule}` })).message).toBe(
      'rules.yaml line 5: rules[1].name: "Same" is used twice',
    );
  });

  it("refuses an allow rule that would let Steward send, pay, sign, delete or run a command unasked", () => {
    const cases: [string, RegExp][] = [
      ["true", /would allow /],
      ['tool.name == "mail_send"', /would allow mail_send/],
      ['tool.kind == "shell"', /would allow shell_run/],
      ['tool.name == "browser_click"', /would allow a click on "Send"/],
      ['tool.surface == "mcp"', /would allow a connected app's tool that would send/],
      ['initiator.kind == "routine"', /would allow /],
    ];
    for (const [when, reason] of cases) {
      const err = loadError(tenantDir(oneRule("allow", when, "Loose")));
      expect(err.file, when).toBe("rules.yaml");
      expect(err.message, when).toMatch(
        /^rules\.yaml line 3: rules\[0\] "Loose": an allow rule cannot let Steward send, pay, sign, delete or run a command without asking you/,
      );
      expect(err.message, when).toMatch(reason);
    }
  });

  it("keeps an allow rule for writes, limited to reads and writes whatever its arguments say", () => {
    const calendar = loadTenant(tenantDir(oneRule("allow", 'tool.surface == "calendar"')));
    expect(calendar.rules[0]?.when).toBe(`${TENANT_ALLOW_GUARD} && (tool.surface == "calendar"\n)`);
    const byArgs = loadTenant(tenantDir(oneRule("allow", 'contains(args.to, "boss@acme.example")')));
    expect(byArgs.rules[0]?.when.startsWith(`${TENANT_ALLOW_GUARD} && (`)).toBe(true);
    // Ask and deny rules only make Steward stricter, so they are kept as written.
    expect(loadTenant(tenantDir(oneRule("deny", "true"))).rules[0]?.when).toBe("true");
  });
});

describe("loadTenant: brand.yaml accent", () => {
  it("takes #rrggbb that white text can be read on, in lower case", () => {
    expect(loadTenant(tenantDir({ "brand.yaml": 'accent: "#B45309"\n' })).brand.accent).toBe("#b45309");
  });

  it("refuses other colour forms and colours too light for white text", () => {
    expect(loadError(tenantDir({ "brand.yaml": "accent: teal\n" })).message).toBe(
      'brand.yaml line 1: accent: must be a colour written as # and six hex digits, such as "#0f6e66"',
    );
    expect(loadError(tenantDir({ "brand.yaml": 'accent: "#f0c419"\n' })).message).toMatch(
      /^brand\.yaml line 1: accent: "#f0c419" is too light for white text on it \(1\.\d:1\)\. Pick a darker colour/,
    );
  });
});

describe("loadTenant: model.yaml addresses and keys", () => {
  const model = (lines: string) => tenantDir({ "model.yaml": lines });

  it("takes an address only for a provider that has none of its own, and only over https off this machine", () => {
    expect(
      loadTenant(model("provider: ollama\nmodel: llama3.2\nbaseUrl: http://127.0.0.1:11434/v1\n")).model
        .baseUrl,
    ).toBe("http://127.0.0.1:11434/v1");
    expect(
      loadTenant(
        model(
          "provider: openai-compatible\nmodel: m\nbaseUrl: https://models.acme.example/v1\napiKeyEnv: ACME_MODEL_KEY\n",
        ),
      ).model,
    ).toMatchObject({ baseUrl: "https://models.acme.example/v1", apiKeyEnv: "ACME_MODEL_KEY" });
    expect(
      loadTenant(model("provider: ollama\nmodel: m\nbaseUrl: http://gpu-box.local:11434/v1\n")).model.baseUrl,
    ).toBe("http://gpu-box.local:11434/v1");
  });

  it("refuses an address that would send a provider's key somewhere else", () => {
    expect(
      loadError(model("provider: openrouter\nmodel: m\nbaseUrl: https://collector.example/v1\n")).message,
    ).toMatch(
      /^model\.yaml line 3: baseUrl: openrouter has its own address, so its key only ever goes there/,
    );
    expect(
      loadError(model("provider: openai-compatible\nmodel: m\nbaseUrl: file:///etc/passwd\n")).message,
    ).toMatch(/^model\.yaml line 3: baseUrl: must be a web address that starts with https:\/\//);
    expect(
      loadError(model("provider: openai-compatible\nmodel: m\nbaseUrl: http://collector.example/v1\n"))
        .message,
    ).toMatch(/^model\.yaml line 3: baseUrl: must use https:\/\/ for collector\.example/);
    expect(
      loadError(model("provider: ollama\nmodel: m\nbaseUrl: http://169.254.169.254/v1\n")).message,
    ).toMatch(/must use https:\/\/ for 169\.254\.169\.254/);
  });

  it("refuses a variable that holds another secret or another provider's key", () => {
    expect(
      loadError(
        model(
          "provider: openai-compatible\nmodel: m\nbaseUrl: https://x.example/v1\napiKeyEnv: GITHUB_TOKEN\n",
        ),
      ).message,
    ).toMatch(
      /^model\.yaml line 4: apiKeyEnv: must be the NAME of an environment variable that ends in _KEY/,
    );
    expect(
      loadError(
        model(
          "provider: openai-compatible\nmodel: m\nbaseUrl: https://x.example/v1\napiKeyEnv: OPENAI_API_KEY\n",
        ),
      ).message,
    ).toBe(
      "model.yaml line 4: apiKeyEnv: OPENAI_API_KEY is the key for openai, and Steward never sends it anywhere else. Name a variable of your own, such as ACME_MODEL_KEY",
    );
    expect(
      loadError(model("provider: openrouter\nmodel: m\napiKeyEnv: AWS_SECRET_ACCESS_KEY\n")).message,
    ).toMatch(/apiKeyEnv: must name a model key, not another secret/);
  });
});
