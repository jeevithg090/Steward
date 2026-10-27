import { describe, expect, it } from "vitest";
import {
  isLocalDate,
  localDate,
  localMinutes,
  parseClock,
  zonedDayRange,
  zonedInstant,
} from "../src/util/time.ts";

describe("time helpers", () => {
  it("finds the person's local date and time", () => {
    const at = new Date("2026-10-27T23:30:00Z");
    expect(localDate(at, "UTC")).toBe("2026-10-27");
    expect(localDate(at, "Asia/Tokyo")).toBe("2026-10-28");
    expect(localDate(at, "America/Los_Angeles")).toBe("2026-10-27");
    expect(localMinutes(at, "UTC")).toBe(23 * 60 + 30);
  });

  it("gives a local day's bounds, across a clock change", () => {
    // London leaves summer time on Sunday 25 October 2026: that day is 25 hours long.
    const day = zonedDayRange("2026-10-25", "Europe/London");
    expect(day.from).toBe("2026-10-24T23:00:00.000Z");
    expect(day.to).toBe("2026-10-26T00:00:00.000Z");
    expect(zonedDayRange("2026-10-27", "America/New_York")).toEqual({
      from: "2026-10-27T04:00:00.000Z",
      to: "2026-10-28T04:00:00.000Z",
    });
    expect(zonedInstant("2026-10-27", "Asia/Kolkata", 8 * 60).toISOString()).toBe("2026-10-27T02:30:00.000Z");
  });

  it("reads clock times and dates strictly", () => {
    expect(parseClock("08:30")).toBe(510);
    expect(parseClock("24:00")).toBeUndefined();
    expect(parseClock("8:30")).toBeUndefined();
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("27/10/2026")).toBe(false);
  });
});
