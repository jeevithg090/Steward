/**
 * Every tenant package loads, its rules compile in the real gateway, and its promises hold: the
 * decisions below are the ones its README and docs say it makes. Runs with the unit tests once
 * `tenants/*.test.ts` is in vitest.config.ts.
 *
 * Imports the packages' public entry points by path, because the repository root does not depend on
 * the workspace packages by name.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTenant } from "../packages/agent/src/index.ts";
import { memoryDb } from "../packages/db/src/index.ts";
import { createGateway } from "../packages/gateway/src/index.ts";
import type { Decision, GateCall, TenantPackage } from "../packages/shared/src/index.ts";

const TENANTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const TENANT_IDS = readdirSync(TENANTS_DIR).filter((name) => statSync(join(TENANTS_DIR, name)).isDirectory());

const KINDS: Record<string, [GateCall["tool"]["kind"], GateCall["tool"]["surface"]]> = {
  mail_send: ["send", "mail"],
  calendar_create: ["write", "calendar"],
  browser_type: ["write", "browser"],
  browser_click: ["write", "browser"],
  request_secret: ["write", "browser"],
  shell_run: ["shell", "shell"],
};

let seq = 0;
function call(
  tool: keyof typeof KINDS,
  opts: {
    args?: Record<string, unknown>;
    target?: GateCall["target"];
    routine?: boolean;
    tainted?: boolean;
  } = {},
): GateCall {
  const [kind, surface] = KINDS[tool] ?? ["write", "mcp"];
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

/** WCAG relative luminance contrast of a #rrggbb colour against white. */
function contrastWithWhite(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (l + 0.05);
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
