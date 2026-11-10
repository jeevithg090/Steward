import { describe, expect, it } from "vitest";
import { CHECKED_ON_SAVE, checkCron } from "./cron.ts";
import { humanise, targetSummary, toolLabel } from "./labels.ts";
import { formatBytes, greeting, listNames, localDate, plural, relativeTime } from "./utils.ts";

describe("relativeTime", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("reads like speech", () => {
    expect(relativeTime("2026-10-27T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-27T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-27T15:00:00Z", now)).toBe("in 3 hours");
    expect(relativeTime("2026-10-26T12:00:00Z", now)).toBe("yesterday");
  });
  it("is empty for missing or broken dates", () => {
    expect(relativeTime(undefined, now)).toBe("");
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("small formatters", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2150)).toBe("2.1 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(-1)).toBe("");
  });
  it("pluralises", () => {
    expect(plural(1, "task")).toBe("1 task");
    expect(plural(3, "email")).toBe("3 emails");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });
  it("lists names the way people say them", () => {
    expect(listNames(["Ana"])).toBe("Ana");
    expect(listNames(["Ana", "Ben"])).toBe("Ana and Ben");
    expect(listNames(["Ana", "Ben", "Ana", "Chloe"])).toBe("Ana, Ben and Chloe");
    expect(listNames(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
  it("uses the local date, not UTC", () => {
    expect(localDate(new Date(2026, 9, 27, 23, 30))).toBe("2026-10-27");
  });
  it("gives the date in a time zone when asked", () => {
    const at = new Date("2026-10-27T01:00:00Z");
    expect(localDate(at, "America/New_York")).toBe("2026-10-26");
    expect(localDate(at, "Europe/London")).toBe("2026-10-27");
    expect(localDate(at, "Pacific/Kiritimati")).toBe("2026-10-27");
    expect(localDate(new Date("2026-10-27T10:30:00Z"), "Pacific/Kiritimati")).toBe("2026-10-28");
    expect(localDate(new Date(2026, 9, 27, 23, 30), "Not/AZone")).toBe("2026-10-27");
  });
  it("greets without a name", () => {
    expect(greeting(new Date(2026, 9, 27, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 9, 27, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 9, 27, 20))).toBe("Good evening");
  });
});

describe("labels", () => {
  it("never shows a raw tool id", () => {
    expect(toolLabel("mail_send")).toBe("Send an email");
    expect(toolLabel("mcp__notion__search_pages")).toBe("notion: Search pages");
    expect(toolLabel("some_new_tool")).toBe("Some new tool");
    expect(humanise("fetchPage")).toBe("Fetch page");
  });
  it("summarises a target", () => {
    expect(targetSummary({ recipients: ["a@example.com"], host: "example.com" })).toBe(
      "To a@example.com · example.com",
    );
    expect(targetSummary({ command: "ls -la" })).toBe("$ ls -la");
    expect(targetSummary(undefined)).toBe("");
  });
});

describe("checkCron", () => {
  it("describes common schedules", () => {
    expect(checkCron("0 8 * * 1-5")).toEqual({ ok: true, text: "Weekdays at 08:00" });
    expect(checkCron("30 7 * * *").text).toBe("Every day at 07:30");
    expect(checkCron("0 9 * * 1").text).toBe("Mondays at 09:00");
    expect(checkCron("0 * * * *").text).toBe("Every hour");
    expect(checkCron("*/30 * * * *").text).toBe("Every 30 minutes");
  });
  // The same table as the server's describer tests (packages/proactive/test/routines.test.ts):
  // the form and the routine card must never word one schedule two ways.
  it.each([
    ["0 8 * * *", "Every day at 08:00"],
    ["0 8 * * 1-5", "Weekdays at 08:00"],
    ["0 8 * * MON-FRI", "Weekdays at 08:00"],
    ["30 9 * * 1", "Mondays at 09:30"],
    ["30 9 * * 1,4", "Mondays and Thursdays at 09:30"],
    ["0 10 * * 6,0", "Weekends at 10:00"],
    ["0 9 * * 7", "Sundays at 09:00"],
    ["0 9 * * 5-7", "Fridays, Saturdays and Sundays at 09:00"],
    ["0 9 * * 0-6", "Every day at 09:00"],
    ["0 * * * *", "Every hour"],
    ["30 * * * *", "Every hour at 30 minutes past"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["*/45 * * * *", "Custom schedule (*/45 * * * *)"],
    ["0 */2 * * *", "Every 2 hours"],
    ["0 8,17 * * *", "Every day at 08:00 and 17:00"],
    ["0,30 9 * * *", "Every day at 09:00 and 09:30"],
    ["0 9 1 * *", "On the 1st of every month at 09:00"],
    ["0 9 22 * *", "On the 22nd of every month at 09:00"],
    ["0 9 1 1 *", "Every year on 1 January at 09:00"],
    ["0 8-17 * * *", "Custom schedule (0 8-17 * * *)"],
  ])("%s reads as %s", (cron, words) => {
    expect(checkCron(cron)).toEqual({ ok: true, text: words });
  });
  it("only says every N minutes when N divides the hour", () => {
    // */40 runs at :00 and :40, so the gaps are 40 and 20 minutes, not every 40.
    expect(checkCron("*/40 * * * *").text).toBe("Custom schedule (*/40 * * * *)");
    expect(checkCron("*/20 * * * *").text).toBe("Every 20 minutes");
  });
  it("reads day and month names, in any case, like the server", () => {
    expect(checkCron("0 9 * * mon")).toEqual({ ok: true, text: "Mondays at 09:00" });
    expect(checkCron("0 9 * * Fri-Sun")).toEqual({
      ok: true,
      text: "Fridays, Saturdays and Sundays at 09:00",
    });
    expect(checkCron("0 9 1 JAN *")).toEqual({ ok: true, text: "Every year on 1 January at 09:00" });
    expect(checkCron("0 9 * jan-mar *").ok).toBe(true);
    expect(checkCron("0 9 * * funday").ok).toBe(false);
  });
  it("leaves L, W, # and ? to the server instead of blocking them", () => {
    for (const cron of ["0 9 L * *", "0 9 ? * *", "0 9 15W * *", "0 9 * * 5#2", "0 9 * * FRIL"]) {
      // No words to show beside a bot's routine, only a note for the form.
      expect(checkCron(cron)).toEqual({ ok: true, text: "", note: CHECKED_ON_SAVE });
    }
    // The times still keep to the floor.
    expect(checkCron("*/5 9 L * *").ok).toBe(false);
    expect(checkCron("61 9 L * *").ok).toBe(false);
  });
  it("refuses anything more often than every 15 minutes", () => {
    expect(checkCron("*/15 * * * *").ok).toBe(true);
    const tooOften = checkCron("*/5 * * * *");
    expect(tooOften.ok).toBe(false);
    expect(tooOften.error).toMatch(/at most every 15 minutes/);
    expect(checkCron("0,10 9 * * *").ok).toBe(false);
  });
  it("refuses what it cannot read", () => {
    expect(checkCron("every day").ok).toBe(false);
    expect(checkCron("61 * * * *").ok).toBe(false);
    expect(checkCron("").error).toBe("Choose when it runs.");
  });
});
