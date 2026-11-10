/**
 * Every tenant package loads, its rules compile in the real gateway, and its promises hold: the
 * decisions below are the ones its README and docs say it makes. Runs with the unit tests
 * (`tenants/*.test.ts` is in vitest.config.ts).
 *
 * Imports the packages' public entry points by path, because the repository root does not depend on
 * the workspace packages by name.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { contrastWithWhite, loadTenant } from "../packages/agent/src/index.ts";
import { memoryDb } from "../packages/db/src/index.ts";
import { createGateway } from "../packages/gateway/src/index.ts";
import { loadHarnesses } from "../packages/harnesses/src/index.ts";
import { loadTenantShortcuts } from "../packages/phone/src/index.ts";
import type { Decision, GateCall, TenantPackage } from "../packages/shared/src/index.ts";

const TENANTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const TENANT_IDS = readdirSync(TENANTS_DIR).filter((name) => statSync(join(TENANTS_DIR, name)).isDirectory());

const KINDS: Record<string, [GateCall["tool"]["kind"], GateCall["tool"]["surface"]]> = {
  mail_send: ["send", "mail"],
  calendar_create: ["write", "calendar"],
  browser_type: ["write", "browser"],
  browser_click: ["write", "browser"],
  browser_press: ["write", "browser"],
  request_secret: ["write", "browser"],
  shell_run: ["shell", "shell"],
};

let seq = 0;
function call(
  tool: keyof typeof KINDS | `mcp__${string}`,
  opts: {
    args?: Record<string, unknown>;
    target?: GateCall["target"];
    routine?: boolean;
    tainted?: boolean;
  } = {},
): GateCall {
  const [kind, surface] = KINDS[tool as keyof typeof KINDS] ?? ["write", "mcp"];
  seq += 1;
  return {
    toolCallId: `tc_${seq}`,
    runId: "run_test",
    threadId: "thr_test",
    agentId: "steward",
    actorId: "local",
    initiator: opts.routine ? { kind: "routine", id: "rtn_test" } : { kind: "person", id: "local" },
    tool: { name: tool, kind, surface, source: "builtin" },
    args: opts.args ?? {},
    target: opts.target ?? {},
    tainted: opts.tainted ?? false,
  };
}

function decider(tenant: TenantPackage): (c: GateCall) => Decision {
  const gateway = createGateway({ db: memoryDb(), tenantRules: tenant.rules });
  return (c) => gateway.governance.dryRun(c);
}

/** "Hi Sam", "Dear Maya,", "Morning, Alex": a greeting that uses a name. */
const GREETING_WITH_NAME = /\b(Hi|Hello|Hey|Dear|Morning|Evening|Welcome)[,!]? [A-Z][a-z]+\b/;

describe.each(TENANT_IDS)("tenant package %s", (id) => {
  const tenant = loadTenant(join(TENANTS_DIR, id));

  it("loads, with one agent at least and every skill it names", () => {
    expect(tenant.id).toBe(id);
    expect(tenant.agents.length).toBeGreaterThan(0);
    const skills = new Set(tenant.skills.map((s) => s.name));
    for (const agent of tenant.agents) for (const skill of agent.skills) expect(skills).toContain(skill);
  });

  it("has an accent white text can be read on", () => {
    expect(tenant.brand.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastWithWhite(tenant.brand.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("names its key by variable, never by value", () => {
    if (tenant.model.apiKeyEnv) expect(tenant.model.apiKeyEnv).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("never greets the person by a name", () => {
    const text = [
      tenant.brand.voice,
      ...tenant.starters,
      ...tenant.agents.map((a) => a.instructions),
      ...tenant.skills.map((s) => s.instructions),
    ].join("\n");
    expect(text).not.toMatch(GREETING_WITH_NAME);
  });

  it("declares only coding agents Steward can run safely, with ids no agent uses", () => {
    const harnesses = loadHarnesses(join(TENANTS_DIR, id));
    const agentIds = new Set(tenant.agents.map((a) => a.id));
    for (const harness of harnesses) {
      expect(agentIds.has(harness.id), harness.id).toBe(false);
      expect(harness.args.join(" ")).not.toMatch(/dangerously|bypass|yolo|full-auto/i);
    }
  });

  it("offers only phone shortcuts that work: each names a skill the package has, and a shared one says where the words go", () => {
    const shortcuts = loadTenantShortcuts(join(TENANTS_DIR, id), {
      skills: tenant.skills.map((s) => s.name),
    });
    const skills = new Set(tenant.skills.map((s) => s.name));
    for (const shortcut of shortcuts) {
      if (shortcut.skill) expect(skills, shortcut.id).toContain(shortcut.skill);
      if (shortcut.share) expect(shortcut.prompt, shortcut.id).toContain("{input}");
    }
  });

  it("has rules the gateway accepts", () => {
    expect(() => decider(tenant)).not.toThrow();
  });

  it("keeps the safety floor: payments and passwords never run unasked", () => {
    const decide = decider(tenant);
    const pay = decide(
      call("browser_click", {
        args: { ref: "e1" },
        target: { host: "shop.example", element: { ref: "e1", role: "button", name: "Place order" } },
      }),
    );
    expect(pay.effect).not.toBe("allow");
    const password = decide(call("request_secret", { args: { ref: "e2", label: "Password" } }));
    expect(password.effect).not.toBe("allow");
  });

  it("asks before sending after reading untrusted content", () => {
    const decide = decider(tenant);
    const send = decide(
      call("mail_send", { args: { to: ["sam@example.com"], subject: "Hi", body: "See you" }, tainted: true }),
    );
    expect(send.effect).toBe("ask");
  });
});

describe("the steward package", () => {
  const steward = loadTenant(join(TENANTS_DIR, "steward"));
  const decide = decider(steward);
  const mail = { to: ["sam@example.com"], subject: "Friday", body: "See you at 10" };

  it("offers Steward on Claude and Steward on Grok: the same Steward, each pinned to its own model", () => {
    const [main, claude, grok] = ["steward", "steward-claude", "steward-grok"].map((id) =>
      steward.agents.find((a) => a.id === id),
    );
    expect(main?.model).toBeUndefined();
    expect(claude).toMatchObject({ name: "Steward on Claude", model: "anthropic/claude-sonnet-5.5" });
    expect(grok).toMatchObject({ name: "Steward on Grok", model: "xai/grok-4.7" });
    for (const other of [claude, grok]) {
      expect(other?.instructions).toBe(main?.instructions);
      expect(other?.skills).toEqual(main?.skills);
      expect(other?.tools).toEqual(main?.tools);
    }
  });

  it("asks before an email, as a default that Always allow can lift", () => {
    const d = decide(call("mail_send", { args: mail }));
    expect(d.effect).toBe("ask");
    expect(d.rule?.source).toBe("preset");
  });

  it("refuses a routine that would send", () => {
    const d = decide(call("mail_send", { args: mail, routine: true }));
    expect(d.effect).toBe("deny");
    expect(d.rule?.name).toBe("Routines never send");
  });

  it("asks before every calendar change, by its own rule", () => {
    const d = decide(
      call("calendar_create", {
        args: { title: "Coffee", start: "2026-10-28T10:00:00Z", end: "2026-10-28T10:30:00Z" },
      }),
    );
    expect(d.effect).toBe("ask");
    expect(d.rule?.name).toBe("Calendar changes always ask");
  });

  it("asks before mail to a crowd", () => {
    const to = ["a", "b", "c", "d", "e", "f"].map((n) => `${n}@example.com`);
    const d = decide(call("mail_send", { args: { ...mail, to } }));
    expect(d.rule?.name).toBe("Mail to a crowd asks every time");
  });
});

describe("the tempo package", () => {
  const decide = decider(loadTenant(join(TENANTS_DIR, "tempo")));
  const claimForm = (name: string, text: string) =>
    call("browser_type", {
      args: { ref: "e3", text },
      target: { host: "claims.example", element: { ref: "e3", role: "textbox", name } },
    });

  it("never pays, even for a button that only looks like paying", () => {
    const d = decide(
      call("browser_click", {
        args: { ref: "e1" },
        target: { host: "shop.example", element: { ref: "e1", role: "button", name: "Pay now" } },
      }),
    );
    expect(d.effect).toBe("deny");
    expect(d.rule?.name).toBe("Tempo never pays");
  });

  it("never types bank or card details, and hands them to the person instead", () => {
    expect(decide(claimForm("Sort code", "12-34-56")).effect).toBe("deny");
    expect(decide(claimForm("Account number", "12345678")).effect).toBe("deny");
    expect(decide(call("request_secret", { args: { ref: "e4", label: "Card number" } })).effect).toBe("deny");
  });

  it("still fills in the rest of a claim form", () => {
    expect(decide(claimForm("Booking reference", "RH7-4KQ-2MZ")).effect).toBe("allow");
  });

  // A key press acts on the focused field, so typing a sort code one digit at a time is typing it.
  const press = (name: string, key: string, sensitive = false) =>
    call("browser_press", {
      args: { key },
      target: {
        host: "claims.example",
        element: { ref: "", role: "textbox", name, ...(sensitive ? { sensitive: true } : {}) },
      },
    });

  it("never types bank or card details one key at a time either", () => {
    expect(decide(press("Sort code", "1")).rule?.name).toBe("Tempo never types bank or card details");
    expect(decide(press("Account number", "7")).effect).toBe("deny");
    expect(decide(press("Card number", "Backspace")).effect).toBe("deny");
    expect(decide(press("Card number", "Control+V")).effect).toBe("deny");
    // A field the page marks as secret hides the key from the rules; the press is still refused.
    expect(decide(press("Card number", "4", true)).effect).toBe("deny");
  });

  it("still moves through a form, and types into the other fields key by key", () => {
    expect(decide(press("Sort code", "Tab")).effect).not.toBe("deny");
    expect(decide(press("Sort code", "Shift+Tab")).effect).not.toBe("deny");
    expect(decide(press("Account number", "ArrowDown")).effect).not.toBe("deny");
    expect(decide(press("Booking reference", "1")).effect).toBe("allow");
  });

  it("never lets a card number or IBAN leave", () => {
    const iban = decide(
      call("mail_send", {
        args: { to: ["sam@example.com"], subject: "Refund", body: "Pay it to GB82 WEST 1234 5698 7654 32" },
      }),
    );
    expect(iban.effect).toBe("deny");
    expect(decide(claimForm("Search", "4242 4242 4242 4242")).effect).toBe("deny");
  });
});

describe("a package that tries to be looser than Steward", () => {
  const root = mkdtempSync(join(tmpdir(), "steward-loose-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const loose = (rules: string): string => {
    const dir = mkdtempSync(join(root, "pkg-"));
    const tenant = join(dir, "loose");
    mkdirSync(tenant);
    writeFileSync(join(tenant, "rules.yaml"), rules);
    return tenant;
  };
  const allow = (when: string) => `rules:\n  - name: Loose\n    effect: allow\n    when: '${when}'\n`;

  it("does not start with an allow rule that lets everything run", () => {
    expect(() => loadTenant(loose(allow("true")))).toThrow(
      /^rules\.yaml line 3: rules\[0\] "Loose": an allow rule cannot let Steward send, pay, sign, delete or run a command without asking you/,
    );
    expect(() => loadTenant(loose(allow('tool.surface == "mcp"')))).toThrow(/would allow a connected app/);
  });

  it("still asks before a send, a delete or a command an allow rule names only by its arguments or target", () => {
    const tenant = loadTenant(
      loose(
        allow(
          'contains(args.to, "boss@acme.example") || target.host == "acme.example" || contains(args.command, "ls")',
        ),
      ),
    );
    const decide = decider(tenant);
    const send = decide(
      call("mail_send", { args: { to: ["boss@acme.example"], subject: "Hi", body: "See you" } }),
    );
    expect(send.effect).toBe("ask");
    const del = decide(
      call("browser_click", {
        args: { ref: "e1" },
        target: { host: "acme.example", element: { ref: "e1", role: "button", name: "Delete account" } },
      }),
    );
    expect(del.effect).toBe("ask");
    expect(decide(call("shell_run", { args: { command: "ls" }, target: { command: "ls" } })).effect).toBe(
      "ask",
    );
  });

  it("can still let a write on the calendar or a connected app run without asking", () => {
    const tenant = loadTenant(
      loose(
        'rules:\n  - name: Calendar runs\n    effect: allow\n    when: \'tool.surface == "calendar"\'\n  - name: Notes app writes run\n    effect: allow\n    when: \'tool.surface == "mcp" && tool.kind == "write"\'\n',
      ),
    );
    const decide = decider(tenant);
    const event = decide(
      call("calendar_create", {
        args: { title: "Coffee", start: "2026-10-28T10:00:00Z", end: "2026-10-28T10:30:00Z" },
      }),
    );
    expect(event).toMatchObject({ effect: "allow", rule: { name: "Calendar runs" } });
    expect(decide(call("mcp__notes__add", { args: { text: "milk" } })).effect).toBe("allow");
  });
});
