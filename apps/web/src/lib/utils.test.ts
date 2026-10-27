import { describe, expect, it } from "vitest";
import { checkCron } from "./cron.ts";
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
    expect(checkCron("0 * * * *").text).toBe("Every hour, on the hour");
    expect(checkCron("*/30 * * * *").text).toBe("Every 30 minutes");
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
