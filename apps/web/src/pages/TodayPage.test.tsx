import type { Brief, Settings } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishWelcome } from "@/lib/onboarding.ts";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { TodayPage } from "./TodayPage.tsx";

/**
 * 10:30 UTC on 27 October is already 28 October in Kiritimati (UTC+14), and still the 27th in every
 * zone from UTC-12 to UTC+13. So with Settings on Kiritimati the right day is the 28th, whatever
 * zone this machine is in.
 */
const NOW = new Date("2026-10-27T10:30:00Z");
const DAY = "2026-10-28";

const settings: Settings = {
  model: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" },
  plainLanguage: false,
  briefTime: "08:00",
  timezone: "Pacific/Kiritimati",
  approvalExpiryHours: 24,
};

function brief(date: string): Brief {
  return {
    id: "brf_1",
    date,
    summary: "Nothing needs you today.",
    needsYou: [],
    canWait: [],
    calendar: [],
    tasks: [],
    couldNotCheck: [],
    createdAt: NOW.toISOString(),
  };
}

/** A server that keeps briefs by date, as the real one does. */
function serve(settingsResponse: () => Promise<{ body: Settings }> | { body: Settings }) {
  const stored = new Map<string, Brief>();
  const fetch = mockFetch((req) => {
    if (req.path === "/api/settings") return settingsResponse();
    if (req.path === "/api/brief") return { body: stored.get(req.query.get("date") ?? "") ?? null };
    if (req.path === "/api/brief/generate") {
      const made = brief((req.body as { date?: string } | undefined)?.date ?? "server-chosen");
      stored.set(made.date, made);
      return { body: made };
    }
    if (req.path === "/api/info") return { body: {} };
    if (req.path === "/api/approvals") return { body: [] };
    if (req.path === "/api/tasks") return { body: { tasks: [], counts: {} } };
    return undefined;
  });
  const briefReads = () => fetch.calls.filter((c: FakeRequest) => c.path === "/api/brief");
  return { ...fetch, briefReads };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  finishWelcome();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Today's brief", () => {
  it("asks for the brief by the day in the Settings time zone, once the settings are known", async () => {
    let answer: (value: { body: Settings }) => void = () => {};
    const server = serve(() => new Promise((resolve) => (answer = resolve)));
    renderWithProviders(<TodayPage />);
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/settings")).toBe(true));
    expect(server.briefReads()).toHaveLength(0);

    answer({ body: settings });
    await waitFor(() => expect(server.briefReads()).toHaveLength(1));
    expect(server.briefReads()[0]!.query.get("date")).toBe(DAY);
  });

  it("makes the brief for that same day, then shows it", async () => {
    const server = serve(() => ({ body: settings }));
    renderWithProviders(<TodayPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Make my brief" }));

    expect(await screen.findByText("Nothing needs you today.")).toBeTruthy();
    const made = server.calls.find((c) => c.path === "/api/brief/generate");
    expect(made?.body).toEqual({ date: DAY });
    // The brief on screen is read back afterwards, whichever day it was made for.
    await waitFor(() => expect(server.briefReads()).toHaveLength(2));
    expect(server.briefReads().every((c) => c.query.get("date") === DAY)).toBe(true);
  });
});
