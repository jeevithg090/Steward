import { ROUTINE_LIMITS } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { ProactiveError } from "../src/errors.ts";
import { createProactive } from "../src/index.ts";
import { ROUTINE_MESSAGES } from "../src/routines.ts";
import { checkSchedule, describeSchedule, latestRun, nextRun, SCHEDULE_MESSAGES } from "../src/schedule.ts";
import { setup } from "./helpers.ts";

const base = {
  title: "Morning check",
  prompt: "Read my mail and tell me what needs me.",
  agentId: "steward",
};

function refusal(fn: () => unknown): ProactiveError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProactiveError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("schedule checks", () => {
  it("allows every 15 minutes and refuses anything more often", () => {
    expect(checkSchedule("*/15 * * * *", "UTC")).toBe("*/15 * * * *");
    expect(checkSchedule("  0   8 * *  1-5 ", "UTC")).toBe("0 8 * * 1-5");
    for (const cron of ["* * * * *", "*/5 * * * *", "*/10 * * * *", "0,10 8 * * *", "0,50 */1 * * *"]) {
      expect(refusal(() => checkSchedule(cron, "UTC")).message).toBe(SCHEDULE_MESSAGES.tooOften);
    }
  });

  it("refuses a too-frequent pair whatever the time of asking (scanned from a fixed start)", () => {
    // Asked at 08:50 the next two firings are 08:55 and tomorrow 08:45; the scan still sees 08:45→08:55.
    const { routines, clock } = setup({ at: "2026-10-22T08:50:00Z" });
    expect(() =>
      routines.create({ ...base, schedule: "45,55 8 * * *", timezone: "UTC", enabled: true }),
    ).toThrow(SCHEDULE_MESSAGES.tooOften);
    clock.set("2026-10-22T03:00:00Z");
    expect(() =>
      routines.create({ ...base, schedule: "45,55 8 * * *", timezone: "UTC", enabled: true }),
    ).toThrow(SCHEDULE_MESSAGES.tooOften);
  });

  it("refuses unreadable schedules, nicknames, six fields, unknown timezones and dates that never come", () => {
    expect(refusal(() => checkSchedule("every morning", "UTC")).message).toBe(SCHEDULE_MESSAGES.unreadable);
    expect(refusal(() => checkSchedule("@daily", "UTC")).message).toBe(SCHEDULE_MESSAGES.unreadable);
    expect(refusal(() => checkSchedule("0 0 8 * * *", "UTC")).message).toBe(SCHEDULE_MESSAGES.unreadable);
    expect(refusal(() => checkSchedule("61 8 * * *", "UTC")).message).toBe(SCHEDULE_MESSAGES.unreadable);
    expect(refusal(() => checkSchedule("0 8 * * *", "Mars/Olympus")).message).toBe(
      SCHEDULE_MESSAGES.unknownTimezone,
    );
    expect(refusal(() => checkSchedule("0 9 31 2 *", "UTC")).message).toBe(SCHEDULE_MESSAGES.neverRuns);
    expect(refusal(() => checkSchedule("0 9 31 2 *", "UTC")).status).toBe(400);
    // 29 February is real: the scan starts in a leap year.
    expect(checkSchedule("0 9 29 2 *", "UTC")).toBe("0 9 29 2 *");
  });

  it("computes the next run in the routine's own timezone, across daylight saving", () => {
    // London left summer time on 25 Oct 2026: 08:00 local is 08:00Z after it and 07:00Z before it.
    expect(nextRun("0 8 * * 1-5", "Europe/London", new Date("2026-10-27T06:00:00Z"))?.toISOString()).toBe(
      "2026-10-27T08:00:00.000Z",
    );
    expect(nextRun("0 8 * * 1-5", "Europe/London", new Date("2026-07-01T06:00:00Z"))?.toISOString()).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    // New York is still on summer time on 27 Oct (UTC-4).
    expect(nextRun("0 8 * * *", "America/New_York", new Date("2026-10-27T10:00:00Z"))?.toISOString()).toBe(
      "2026-10-27T12:00:00.000Z",
    );
    // Strictly after: asking exactly at a firing gives the next one.
    expect(nextRun("0 8 * * *", "UTC", new Date("2026-10-27T08:00:00Z"))?.toISOString()).toBe(
      "2026-10-28T08:00:00.000Z",
    );
  });

  it("skips a firing closer than the floor to the previous one", () => {
    const previous = new Date("2026-10-27T08:00:00Z");
    expect(nextRun("*/15 * * * *", "UTC", new Date("2026-10-27T08:00:01Z"), previous)?.toISOString()).toBe(
      "2026-10-27T08:15:00.000Z",
    );
  });
});

describe("the newest slot that has passed", () => {
  it("is the last firing at or before now, never before the one already due", () => {
    const from = new Date("2026-10-22T07:15:00Z");
    expect(latestRun("*/15 * * * *", "UTC", from, new Date("2026-10-22T19:30:20Z")).toISOString()).toBe(
      "2026-10-22T19:30:00.000Z",
    );
    // Exactly on a firing counts that firing.
    expect(latestRun("*/15 * * * *", "UTC", from, new Date("2026-10-22T19:30:00Z")).toISOString()).toBe(
      "2026-10-22T19:30:00.000Z",
    );
    expect(
      latestRun("0 8 * * *", "UTC", new Date("2026-10-22T08:00:00Z"), new Date("2026-10-22T19:30:00Z")),
    ).toEqual(new Date("2026-10-22T08:00:00Z"));
  });
});

describe("schedule in plain words", () => {
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
    ["*/45 * * * *", "*/45 * * * *"],
    ["0 */2 * * *", "Every 2 hours"],
    ["0 8,17 * * *", "Every day at 08:00 and 17:00"],
    ["0,30 9 * * *", "Every day at 09:00 and 09:30"],
    ["0 9 1 * *", "On the 1st of every month at 09:00"],
    ["0 9 22 * *", "On the 22nd of every month at 09:00"],
    ["0 9 1 1 *", "Every year on 1 January at 09:00"],
    ["0 8-17 * * *", "0 8-17 * * *"],
    ["not a cron", "not a cron"],
  ])("%s reads as %s", (cron, words) => {
    expect(describeSchedule(cron)).toBe(words);
  });
});

describe("routine store", () => {
  it("creates a routine with its own thread, its schedule in words and its next run", () => {
    const { routines, bus } = setup({ at: "2026-10-27T06:00:00Z" });
    const routine = routines.create({
      ...base,
      schedule: "0 8 * * 1-5",
      timezone: "Europe/London",
      enabled: true,
    });
    expect(routine.threadId).toMatch(/^thr_/);
    expect(routine.scheduleText).toBe("Weekdays at 08:00");
    expect(routine.nextRunAt).toBe("2026-10-27T08:00:00.000Z");
    expect(routine.consecutiveFailures).toBe(0);
    const other = routines.create({ ...base, schedule: "0 9 * * *", timezone: "UTC", enabled: true });
    expect(other.threadId).not.toBe(routine.threadId);
    expect(bus.of("routine.updated").map((e) => e.routineId)).toEqual([routine.id, other.id]);
  });

  it("refuses an empty instruction and a blank timezone becomes UTC", () => {
    const { routines } = setup();
    expect(() =>
      routines.create({ ...base, prompt: "  ", schedule: "0 8 * * *", timezone: "UTC", enabled: true }),
    ).toThrow(ROUTINE_MESSAGES.noPrompt);
    expect(routines.create({ ...base, schedule: "0 8 * * *", timezone: " ", enabled: true }).timezone).toBe(
      "UTC",
    );
  });

  it("refuses a 21st routine switched on, but keeps one switched off", () => {
    const { routines } = setup();
    for (let i = 0; i < ROUTINE_LIMITS.maxEnabled; i++) {
      routines.create({ ...base, title: `R${i}`, schedule: `${i} 8 * * *`, timezone: "UTC", enabled: true });
    }
    const tooMany = refusal(() =>
      routines.create({ ...base, schedule: "30 9 * * *", timezone: "UTC", enabled: true }),
    );
    expect(tooMany.message).toBe(ROUTINE_MESSAGES.tooMany);
    expect(tooMany.code).toBe("limit");
    const off = routines.create({ ...base, schedule: "30 9 * * *", timezone: "UTC", enabled: false });
    expect(off.enabled).toBe(false);
    expect(off.nextRunAt).toBeUndefined();
    expect(() => routines.update(off.id, { enabled: true })).toThrow(ROUTINE_MESSAGES.tooMany);
    // Switching one off makes room.
    routines.update(routines.list()[0]!.id, { enabled: false });
    expect(routines.update(off.id, { enabled: true }).enabled).toBe(true);
  });

  it("switches a routine off after ten failures in a row and tells the person", () => {
    const { routines, notifications, bus } = setup();
    const routine = routines.create({ ...base, schedule: "0 8 * * *", timezone: "UTC", enabled: true });
    for (let i = 1; i < ROUTINE_LIMITS.maxConsecutiveFailures; i++) {
      const after = routines.recordRun(routine.id, i % 2 ? "failed" : "refused", "The site was down.");
      expect(after.enabled).toBe(true);
      expect(after.consecutiveFailures).toBe(i);
    }
    // Only the first failure after a success notified.
    expect(notifications.list().map((n) => n.title)).toEqual(["A routine didn't finish"]);

    bus.events.length = 0;
    const off = routines.recordRun(routine.id, "failed", "The site was down.");
    expect(off.enabled).toBe(false);
    expect(off.nextRunAt).toBeUndefined();
    expect(off.lastStatus).toBe("failed");
    expect(off.lastError).toBe("The site was down.");
    expect(bus.of("routine.updated")).toEqual([{ type: "routine.updated", routineId: routine.id }]);
    const latest = notifications.list()[0]!;
    expect(latest).toMatchObject({
      title: "A routine was switched off",
      level: "problem",
      href: "/routines",
    });
    expect(latest.body).toContain("failed 10 times in a row");
    expect(bus.of("notification")[0]?.notification.id).toBe(latest.id);
  });

  it("a firing skipped because an answer is still owed never counts as a failure", () => {
    const { routines, notifications } = setup();
    const routine = routines.create({ ...base, schedule: "0 8 * * *", timezone: "UTC", enabled: true });
    routines.recordRun(routine.id, "failed");
    for (let i = 0; i < 20; i++) routines.recordRun(routine.id, "skipped");
    const after = routines.get(routine.id)!;
    expect(after.enabled).toBe(true);
    expect(after.consecutiveFailures).toBe(1);
    expect(after.lastStatus).toBe("skipped");
    expect(after.lastError).toBe("Its last run is still waiting for your answer.");
    // Only the one real failure notified.
    expect(notifications.list().map((n) => n.title)).toEqual(["A routine didn't finish"]);
  });

  it("an ok run resets the count, and switching back on starts the count again", () => {
    const { routines } = setup();
    const routine = routines.create({ ...base, schedule: "0 8 * * *", timezone: "UTC", enabled: true });
    routines.recordRun(routine.id, "failed");
    routines.recordRun(routine.id, "failed");
    const ok = routines.recordRun(routine.id, "ok");
    expect(ok.consecutiveFailures).toBe(0);
    expect(ok.lastError).toBeUndefined();
    for (let i = 0; i < 10; i++) routines.recordRun(routine.id, "failed");
    expect(routines.get(routine.id)?.enabled).toBe(false);
    const back = routines.update(routine.id, { enabled: true });
    expect(back.enabled).toBe(true);
    expect(back.consecutiveFailures).toBe(0);
    expect(back.nextRunAt).toBeDefined();
  });

  it("gives a failed run a plain reason when none was given", () => {
    const { routines } = setup();
    const routine = routines.create({ ...base, schedule: "0 8 * * *", timezone: "UTC", enabled: true });
    expect(routines.recordRun(routine.id, "refused").lastError).toBe("Steward's rules refused part of it.");
    expect(routines.recordRun(routine.id, "failed", "  ").lastError).toBe("It didn't finish.");
  });

  it("hands out each firing once, moves the next run on, and does not overlap a slow run", () => {
    const { routines, clock } = setup({ at: "2026-10-22T07:59:00Z" });
    const routine = routines.create({ ...base, schedule: "*/15 * * * *", timezone: "UTC", enabled: true });
    expect(routine.nextRunAt).toBe("2026-10-22T08:00:00.000Z");
    expect(routines.due()).toEqual([]);

    clock.set("2026-10-22T08:00:30Z");
    const due = routines.due();
    expect(due.map((r) => r.id)).toEqual([routine.id]);
    expect(due[0]?.nextRunAt).toBe("2026-10-22T08:15:00.000Z");
    expect(routines.due()).toEqual([]); // claimed

    // Still running at 08:16: the 08:15 slot is skipped, not doubled.
    clock.set("2026-10-22T08:16:00Z");
    expect(routines.due()).toEqual([]);
    const done = routines.recordRun(routine.id, "ok");
    expect(done.nextRunAt).toBe("2026-10-22T08:30:00.000Z");
    expect(done.lastRunAt).toBe("2026-10-22T08:16:00.000Z");

    clock.set("2026-10-22T08:30:00Z");
    expect(routines.due().map((r) => r.id)).toEqual([routine.id]);
  });

  it("takes a claimed run that never reported back for a run that died with the server", () => {
    const { routines, clock } = setup({ at: "2026-10-22T07:59:00Z" });
    const routine = routines.create({ ...base, schedule: "0 * * * *", timezone: "UTC", enabled: true });
    clock.set("2026-10-22T08:00:00Z");
    expect(routines.due()).toHaveLength(1);
    clock.set("2026-10-22T09:00:00Z");
    expect(routines.due()).toEqual([]); // the 08:00 run is still out
    clock.set("2026-10-22T10:00:01Z");
    expect(routines.due().map((r) => r.id)).toEqual([routine.id]);
  });

  it("records a run the last server died in as failed, says so, and schedules it from now", () => {
    const { routines, clock, db, bus } = setup({ at: "2026-10-22T08:59:00Z" });
    const routine = routines.create({ ...base, schedule: "*/15 * * * *", timezone: "UTC", enabled: true });
    clock.set("2026-10-22T09:00:00Z");
    expect(routines.due()).toHaveLength(1);

    // The server stops mid-run and starts again at 09:50, on the same database.
    clock.set("2026-10-22T09:50:00Z");
    const restarted = createProactive({
      db,
      bus,
      mail: () => undefined,
      model: () => undefined,
      timezone: () => "UTC",
      now: clock.now,
    });
    expect(restarted.routines.recover()).toBe(1);
    const after = restarted.routines.get(routine.id)!;
    expect(after).toMatchObject({
      lastStatus: "failed",
      lastError: ROUTINE_MESSAGES.stopped,
      consecutiveFailures: 1,
      nextRunAt: "2026-10-22T10:00:00.000Z",
      lastRunAt: "2026-10-22T09:50:00.000Z",
    });
    expect(restarted.notifications.list()[0]).toMatchObject({
      title: "A routine didn't finish",
      body: `“${base.title}”: Steward stopped while this was running.`,
      href: `/chat/${routine.threadId}`,
    });
    // Nothing is left marked as running, so the next slot is handed out on time, once.
    expect(restarted.routines.recover()).toBe(0);
    clock.set("2026-10-22T10:00:10Z");
    expect(restarted.routines.due().map((r) => r.id)).toEqual([routine.id]);
  });

  it("claims a late slot within its grace and says which slot it was", () => {
    const { routines, clock } = setup({ at: "2026-10-22T06:00:00Z" });
    const routine = routines.create({
      ...base,
      schedule: "0 8 * * *",
      timezone: "Europe/London",
      enabled: true,
    });
    expect(routine.nextRunAt).toBe("2026-10-22T07:00:00.000Z");
    clock.set("2026-10-22T07:40:00Z"); // 08:40 in London, 40 minutes late
    const [due] = routines.due();
    expect(due).toMatchObject({ id: routine.id, dueAt: "2026-10-22T07:00:00.000Z" });
    expect(due?.nextRunAt).toBe("2026-10-23T07:00:00.000Z");
    // Only the claim carries dueAt; the stored routine does not.
    expect(routines.get(routine.id)?.dueAt).toBeUndefined();
  });

  it("measures lateness from the newest slot that passed, so a frequent routine just runs", () => {
    const { routines, clock, notifications } = setup({ at: "2026-10-22T07:00:00Z" });
    const routine = routines.create({ ...base, schedule: "*/15 * * * *", timezone: "UTC", enabled: true });
    clock.set("2026-10-22T19:30:20Z"); // asleep since 07:00
    const [due] = routines.due();
    expect(due).toMatchObject({ id: routine.id, dueAt: "2026-10-22T19:30:00.000Z" });
    expect(due?.nextRunAt).toBe("2026-10-22T19:45:00.000Z");
    expect(notifications.list()).toEqual([]);
  });

  it("marks a slot missed past its grace, moves on, and tells the person once", () => {
    const { routines, clock, notifications, bus } = setup({ at: "2026-10-22T06:00:00Z" });
    const morning = routines.create({
      ...base,
      title: "Morning inbox",
      schedule: "0 8 * * *",
      timezone: "Europe/London",
      enabled: true,
    });
    clock.set("2026-10-22T18:30:00Z"); // 19:30 in London: the server slept through 08:00
    bus.events.length = 0;
    expect(routines.due()).toEqual([]);
    const after = routines.get(morning.id)!;
    expect(after).toMatchObject({
      lastStatus: "missed",
      lastError: "Missed the run due at 08:00 while Steward wasn't running.",
      lastRunAt: "2026-10-22T18:30:00.000Z",
      nextRunAt: "2026-10-23T07:00:00.000Z",
      consecutiveFailures: 0,
      enabled: true,
    });
    expect(bus.of("routine.updated").map((e) => e.routineId)).toEqual([morning.id]);
    expect(notifications.list()).toHaveLength(1);
    expect(notifications.list()[0]).toMatchObject({
      title: "A routine missed its time",
      body: "“Morning inbox” was due at 08:00 while Steward wasn't running. Press Run now on Routines if you still need it.",
      href: "/routines",
      level: "problem",
    });
    // Nothing more until tomorrow's slot.
    expect(routines.due()).toEqual([]);
    expect(notifications.list()).toHaveLength(1);
  });

  it("names an earlier day, and puts several missed routines in one notification", () => {
    const { routines, clock, notifications } = setup({ at: "2026-10-21T06:00:00Z" });
    routines.create({
      ...base,
      title: "Morning inbox",
      schedule: "0 8 * * *",
      timezone: "UTC",
      enabled: true,
    });
    const weekly = routines.create({
      ...base,
      title: "Weekly review",
      schedule: "0 17 * * 3",
      timezone: "UTC",
      enabled: true,
    });
    clock.set("2026-10-22T07:00:00Z"); // Thursday 07:00: yesterday's 08:00 and 17:00 both passed
    expect(routines.due()).toEqual([]);
    expect(routines.get(weekly.id)?.lastError).toBe(
      "Missed the run due on Wednesday 21 October at 17:00 while Steward wasn't running.",
    );
    expect(notifications.list().map((n) => [n.title, n.body])).toEqual([
      [
        "2 routines missed their time",
        "“Morning inbox” and 1 more were due while Steward wasn't running. Press Run now on Routines for any you still need.",
      ],
    ]);
  });

  it("does not hand out switched-off routines, and fires a missed routine once, not once per slot", () => {
    const { routines, clock } = setup({ at: "2026-10-22T07:59:00Z" });
    const on = routines.create({ ...base, schedule: "0 * * * *", timezone: "UTC", enabled: true });
    routines.create({ ...base, schedule: "0 * * * *", timezone: "UTC", enabled: false });
    clock.set("2026-10-22T13:20:00Z"); // asleep for five slots
    const due = routines.due();
    expect(due.map((r) => r.id)).toEqual([on.id]);
    expect(due[0]?.nextRunAt).toBe("2026-10-22T14:00:00.000Z");
  });

  it("updates the schedule, recomputes the next run, and removes", () => {
    const { routines } = setup({ at: "2026-10-22T06:00:00Z" });
    const routine = routines.create({ ...base, schedule: "0 8 * * *", timezone: "UTC", enabled: true });
    const moved = routines.update(routine.id, { schedule: "30 9 * * 1", timezone: "Europe/London" });
    expect(moved.scheduleText).toBe("Mondays at 09:30");
    expect(moved.nextRunAt).toBe("2026-10-26T09:30:00.000Z");
    expect(() => routines.update(routine.id, { schedule: "*/5 * * * *" })).toThrow(
      SCHEDULE_MESSAGES.tooOften,
    );
    routines.remove(routine.id);
    expect(routines.get(routine.id)).toBeUndefined();
    expect(refusal(() => routines.remove(routine.id)).status).toBe(404);
  });
});
