import { memoryDb } from "@steward/db";
import type { Skill } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { createProactive, migrations } from "../src/index.ts";
import { setup } from "./helpers.ts";

const tenantSkills: Skill[] = [
  {
    id: "skl_morning",
    name: "morning-brief",
    description: "What needs you today.",
    instructions: "Call brief_today.",
    tools: ["brief_today"],
    source: "tenant",
  },
  {
    id: "",
    name: "reply-to-an-email",
    description: "Draft a reply.",
    instructions: "Read it, then draft.",
    tools: [],
    source: "tenant",
  },
];

const mine = {
  name: "weekly-review",
  description: "Look back at the week.",
  instructions: "List what moved.",
  tools: ["mail_list"],
};

describe("skills", () => {
  it("seeds the tenant's skills as read only, and keeps the person's editable", () => {
    const { skills } = setup({ tenantSkills });
    expect(skills.list().map((s) => [s.name, s.source])).toEqual([
      ["morning-brief", "tenant"],
      ["reply-to-an-email", "tenant"],
    ]);
    expect(skills.get("skl_morning")?.name).toBe("morning-brief");
    expect(skills.get("reply-to-an-email")?.id).toBe("skl_tenant_reply-to-an-email");
    expect(() => skills.update("skl_morning", mine)).toThrow(
      "This skill comes with Steward and can't be changed.",
    );
    expect(() => skills.remove("skl_morning")).toThrow(expect.objectContaining({ status: 403 }));

    const created = skills.create(mine);
    expect(created).toMatchObject({ name: "weekly-review", source: "person", tools: ["mail_list"] });
    expect(skills.get("/Weekly-Review")?.id).toBe(created.id);
    const changed = skills.update(created.id, { ...mine, instructions: "List what moved, newest first." });
    expect(changed.instructions).toBe("List what moved, newest first.");
    skills.remove(created.id);
    expect(skills.get(created.id)).toBeUndefined();
  });

  it("keeps names unique, ignoring case, across tenant and person skills", () => {
    const { skills } = setup({ tenantSkills });
    expect(() => skills.create({ ...mine, name: "Morning-Brief" })).toThrow(
      expect.objectContaining({ code: "conflict" }),
    );
    const a = skills.create(mine);
    const b = skills.create({ ...mine, name: "daily-review" });
    expect(() => skills.update(b.id, { ...mine })).toThrow("There is already a skill called /weekly-review.");
    expect(skills.update(a.id, { ...mine, description: "Same name is fine for itself." }).name).toBe(
      "weekly-review",
    );
  });

  it("refuses names that cannot be typed after a slash", () => {
    const { skills } = setup();
    for (const name of ["", "has space", "-leading", "a".repeat(42), "émoji"]) {
      expect(() => skills.create({ ...mine, name })).toThrow(expect.objectContaining({ code: "invalid" }));
    }
  });

  it("re-seeds on start: a skill gone from the package goes, and the person's own skill wins a name clash", () => {
    const db = memoryDb(migrations);
    const base = { db, mail: () => undefined, model: () => undefined, timezone: () => "UTC" };
    const first = createProactive({ ...base, tenantSkills });
    first.skills.create({ ...mine, name: "standup" });
    const second = createProactive({
      ...base,
      tenantSkills: [
        { ...tenantSkills[0]!, id: "skl_standup", name: "standup", description: "Tenant standup." },
      ],
    });
    expect(second.skills.list().map((s) => [s.name, s.source])).toEqual([["standup", "person"]]);
  });
});

describe("memory", () => {
  it("adds, lists newest first, does not repeat itself, and forgets", () => {
    const { memory } = setup();
    const a = memory.add("Works  from the studio on Fridays.", "you");
    const b = memory.add("Prefers short replies.", "learned");
    expect(a.text).toBe("Works from the studio on Fridays.");
    expect(memory.list().map((f) => f.id)).toEqual([b.id, a.id]);
    expect(memory.add("works from the studio on fridays.", "you").id).toBe(a.id);
    memory.remove(a.id);
    expect(memory.list().map((f) => f.id)).toEqual([b.id]);
    expect(() => memory.remove(a.id)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => memory.add("   ", "you")).toThrow("Say what to remember.");
  });
});

describe("notifications", () => {
  it("adds and announces, lists newest first, and marks all read", () => {
    const { notifications, bus } = setup();
    const a = notifications.add({
      title: "Your brief is ready",
      body: "Two things need you.",
      href: "/",
      level: "info",
    });
    const b = notifications.add({ title: "A routine didn't finish", body: "", level: "problem" });
    expect(bus.of("notification").map((e) => e.notification.id)).toEqual([a.id, b.id]);
    expect(notifications.list().map((n) => n.id)).toEqual([b.id, a.id]);
    expect(notifications.list({ limit: 1 })).toHaveLength(1);
    expect(b.href).toBeUndefined();
    notifications.readAll();
    expect(notifications.list({ unreadOnly: true })).toEqual([]);
    expect(notifications.list()[0]?.readAt).toBeDefined();
    expect(() => notifications.add({ title: "x", body: "", level: "loud" as never })).toThrow();
  });
});

describe("createProactive", () => {
  it("applies its migrations once, whoever runs them first", () => {
    const db = memoryDb(migrations);
    const opts = { db, mail: () => undefined, model: () => undefined, timezone: () => "UTC" };
    createProactive(opts);
    const again = createProactive(opts);
    expect(again.tasks.counts().needs_you).toBe(0);
    expect(migrations.every((m) => m.id.startsWith("proactive."))).toBe(true);
  });
});
