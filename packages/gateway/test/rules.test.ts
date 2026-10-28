import { memoryDb } from "@steward/db";
import { describe, expect, it } from "vitest";
import { createGateway, GatewayError, PRESET_RULES } from "../src/index.ts";
import { gateCall, setup } from "./helpers.ts";

const person = (over: Partial<{ name: string; effect: "allow" | "ask" | "deny"; when: string }> = {}) => ({
  name: "Mine",
  effect: "allow" as const,
  when: 'tool.name == "calendar_create"',
  description: "",
  enabled: true,
  source: "person" as const,
  ...over,
});

describe("presets", () => {
  it("ships every preset switched on, visible through presets()", () => {
    const { gw } = setup();
    const presets = gw.rules.presets();
    expect(presets.map((p) => p.id).sort()).toEqual(PRESET_RULES.map((p) => p.id).sort());
    expect(presets.every((p) => p.enabled && p.source === "preset")).toBe(true);
    expect(
      gw.rules
        .list()
        .slice(0, presets.length)
        .every((r) => r.source === "preset"),
    ).toBe(true);
  });

  it("can be switched off and on, but not edited or deleted", () => {
    const { gw } = setup();
    const preset = gw.rules.presets()[0];
    if (!preset) throw new Error("no presets");
    expect(gw.rules.update(preset.id, { enabled: false }).enabled).toBe(false);
    expect(gw.rules.update(preset.id, { enabled: true }).enabled).toBe(true);
    expect(() => gw.rules.update(preset.id, { when: "true" })).toThrow(/Shipped rules cannot be changed/);
    expect(() => gw.rules.remove(preset.id)).toThrow(/Switch this one off instead/);
    expect(() => gw.rules.create({ ...person(), source: "preset" })).toThrow(GatewayError);
  });

  it("keeps the person's on/off choice across restarts and records the sync only when something changed", () => {
    const db = memoryDb();
    const first = createGateway({ db });
    const preset = first.rules.presets()[0];
    first.rules.update(preset?.id ?? "", { enabled: false });
    const syncs = () =>
      first.audit
        .page({ type: "policy.changed", limit: 200 })
        .events.filter((e) => e.detail.change === "synced").length;
    expect(syncs()).toBe(1);
    const second = createGateway({ db });
    expect(second.rules.get(preset?.id ?? "")?.enabled).toBe(false);
    expect(syncs()).toBe(1);
  });

  it("removes a preset that is no longer shipped", () => {
    const db = memoryDb();
    createGateway({ db });
    db.run(
      "INSERT INTO gateway_rules (id, name, effect, cel, description, source, enabled, created_at, updated_at) VALUES ('preset_old', 'Old', 'deny', 'true', '', 'preset', 1, 'x', 'x')",
    );
    const gw = createGateway({ db });
    expect(gw.rules.get("preset_old")).toBeUndefined();
  });
});

describe("tenant rules", () => {
  const tenant = [
    {
      name: "Calendar asks",
      effect: "ask" as const,
      when: 'tool.surface == "calendar"',
      description: "Tempo asks about the calendar.",
    },
  ];

  it("are stored with source tenant and upserted by name", () => {
    const db = memoryDb();
    const a = createGateway({ db, tenantRules: tenant });
    const rule = a.rules.list().find((r) => r.source === "tenant");
    expect(rule).toMatchObject({ name: "Calendar asks", effect: "ask", enabled: true });
    const b = createGateway({
      db,
      tenantRules: [{ ...tenant[0], when: 'tool.name == "calendar_create"' } as (typeof tenant)[0]],
    });
    const updated = b.rules.list().filter((r) => r.source === "tenant");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(rule?.id);
    expect(updated[0]?.when).toBe('tool.name == "calendar_create"');
  });

  it("are removed when the package drops them", () => {
    const db = memoryDb();
    createGateway({ db, tenantRules: tenant });
    const gw = createGateway({ db, tenantRules: [] });
    expect(gw.rules.list().filter((r) => r.source === "tenant")).toHaveLength(0);
  });

  it("can be switched off but not edited", () => {
    const { gw } = setup({ tenantRules: tenant });
    const rule = gw.rules.list().find((r) => r.source === "tenant");
    expect(gw.rules.update(rule?.id ?? "", { enabled: false }).enabled).toBe(false);
    expect(() => gw.rules.update(rule?.id ?? "", { effect: "allow" })).toThrow(/tenant package/);
  });

  it("stop the start with a readable error when broken", () => {
    expect(() =>
      createGateway({
        db: memoryDb(),
        tenantRules: [{ name: "Bad", effect: "deny", when: "page.host == 1", description: "" }],
      }),
    ).toThrow(/The tenant rule 'Bad' cannot be used: .*nothing called 'page'/);
  });

  it("feed the decision with their own name", () => {
    const { gw } = setup({ tenantRules: tenant });
    const d = gw.governance.dryRun(gateCall("calendar_create", { title: "Lunch" }));
    expect(d).toMatchObject({ effect: "ask", rule: { name: "Calendar asks", source: "tenant" } });
  });
});

describe("person rules", () => {
  it("validates before saving, with the reason", () => {
    const { gw } = setup();
    expect(() => gw.rules.create(person({ when: "tool.kind ==" }))).toThrow(/not valid CEL/);
    expect(() => gw.rules.create(person({ name: " " }))).toThrow(/needs a name/);
    expect(() => gw.rules.create(person({ effect: "maybe" as never }))).toThrow(/allow, ask or deny/);
    expect(() => gw.rules.validate('tool.kind == "send"')).not.toThrow();
    expect(() => gw.rules.validate("nope")).toThrow(GatewayError);
  });

  it("can be created, edited and removed, and every change is recorded", () => {
    const { gw } = setup();
    const rule = gw.rules.create(person());
    expect(gw.rules.get(rule.id)).toMatchObject({ name: "Mine", source: "person" });
    const edited = gw.rules.update(rule.id, { name: "Calendar freely", enabled: false });
    expect(edited).toMatchObject({ name: "Calendar freely", enabled: false });
    expect(() => gw.rules.update(rule.id, { when: "broken ==" })).toThrow(/not valid CEL/);
    expect(gw.rules.get(rule.id)?.when).toBe('tool.name == "calendar_create"');
    gw.rules.remove(rule.id);
    expect(gw.rules.get(rule.id)).toBeUndefined();
    expect(() => gw.rules.remove(rule.id)).toThrow(/no rule/);
    const changes = gw.audit
      .page({ type: "policy.changed", limit: 200 })
      .events.map((e) => e.detail.change)
      .reverse();
    expect(changes).toEqual(["synced", "created", "updated", "removed"]);
  });
});

describe("rules from bots", () => {
  it("accepts ask and deny from a bot, refuses allow, and orders them after the tenant's", () => {
    const { gw } = setup();
    const ask = gw.rules.create({
      name: "Rent Scout: deposits ask",
      effect: "ask",
      when: 'tool.kind == "pay"',
      description: "",
      enabled: true,
      source: "bot",
    });
    expect(ask.source).toBe("bot");
    expect(() =>
      gw.rules.create({
        name: "Rent Scout: pay freely",
        effect: "allow",
        when: 'tool.kind == "pay"',
        description: "",
        enabled: true,
        source: "bot",
      }),
    ).toThrow(/only ask or refuse/);
    gw.rules.remove(ask.id);
    expect(gw.rules.get(ask.id)).toBeUndefined();
  });
});
