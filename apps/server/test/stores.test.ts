import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.ts";
import { SettingsStore } from "../src/store/settings.ts";
import { ThreadStore, titleFrom } from "../src/store/threads.ts";
import { collect, EchoAgent, runInput, runnerOnMemoryDb, startRun } from "./helpers.ts";

describe("SettingsStore", () => {
  it("has defaults and keeps what the person sets", () => {
    const { db } = runnerOnMemoryDb();
    const settings = new SettingsStore(db, "Europe/London");
    const model = { provider: "scripted", model: "steward-scripted" };
    expect(settings.read(model)).toEqual({
      model,
      plainLanguage: false,
      briefTime: "08:00",
      timezone: "Europe/London",
      approvalExpiryHours: 24,
    });
    settings.update({
      plainLanguage: true,
      briefTime: "07:30",
      timezone: "America/New_York",
      approvalExpiryHours: 4,
    });
    expect(settings.read(model)).toMatchObject({
      plainLanguage: true,
      briefTime: "07:30",
      timezone: "America/New_York",
      approvalExpiryHours: 4,
    });
    settings.update({ model: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" } });
    expect(settings.modelChoice()).toEqual({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5" });
  });

  it("refuses a time zone it does not know and a brief time that is not a time", () => {
    const { db } = runnerOnMemoryDb();
    const settings = new SettingsStore(db, "UTC");
    expect(() => settings.update({ timezone: "Mars/Olympus" })).toThrow(HttpError);
    expect(() => settings.update({ briefTime: "25:00" })).toThrow(/HH:MM/);
    expect(settings.timezone()).toBe("UTC");
  });
});

describe("ThreadStore", () => {
  it("lists threads the server made and threads the browser started, newest first", async () => {
    const { db, runner } = runnerOnMemoryDb();
    const threads = new ThreadStore(db, runner);
    threads.upsertMeta({ id: "made", agentId: "steward", kind: "routine", title: "Morning mail" });
    const agent = new EchoAgent({ agentId: "steward" });
    await collect(startRun(runner, agent, runInput("browser", "r1", "what needs me")));

    const list = threads.list();
    expect(list.map((t) => t.id)).toEqual(["browser", "made"]);
    expect(list[0]).toMatchObject({
      title: "New conversation",
      kind: "chat",
      running: false,
      lastMessagePreview: "echo: what needs me",
    });
    expect(list[1]).toMatchObject({ title: "Morning mail", kind: "routine" });
    expect(threads.list({ kind: "routine" }).map((t) => t.id)).toEqual(["made"]);
    expect(threads.summary("nope")).toBeUndefined();
  });

  it("keeps a title once given, and changes it only when asked", () => {
    const { db, runner } = runnerOnMemoryDb();
    const threads = new ThreadStore(db, runner);
    threads.upsertMeta({ id: "t", agentId: "steward", title: "First" });
    threads.upsertMeta({ id: "t", agentId: "steward" });
    expect(threads.getMeta("t")?.title).toBe("First");
    threads.setTitle("t", "Second");
    expect(threads.summary("t")?.title).toBe("Second");
    threads.deleteMeta("t");
    expect(threads.exists("t")).toBe(false);
  });
});

describe("titleFrom", () => {
  it("uses the first line and cuts at a word", () => {
    expect(titleFrom("  Hello there \n second line")).toBe("Hello there");
    const long = titleFrom(
      "Open news.ycombinator.com and tell me the top story and then summarise it for me please",
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });
});
