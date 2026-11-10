import type { InboxWatch, Routine } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKED_ON_SAVE } from "@/lib/cron.ts";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { RoutinesPage } from "./RoutinesPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MISSED: Routine = {
  id: "rtn_1",
  title: "Morning inbox",
  prompt: "Check my inbox and tell me what needs me.",
  schedule: "0 8 * * *",
  scheduleText: "Every day at 08:00",
  timezone: "Europe/London",
  enabled: true,
  agentId: "steward",
  threadId: "thr_1",
  consecutiveFailures: 0,
  lastRunAt: "2026-10-22T18:30:00Z",
  lastStatus: "missed",
  lastError: "Missed the run due at 08:00 while Steward wasn't running.",
  nextRunAt: "2026-10-23T07:00:00Z",
  createdAt: "2026-10-20T08:00:00Z",
};

/** A server with one routine and the inbox watch, keeping what is posted. */
function serve(watch: InboxWatch = { enabled: false }) {
  let current = watch;
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/routines" && req.method === "GET") return { body: [MISSED] };
    if (req.path === "/api/routines" && req.method === "POST") {
      const body = req.body as Pick<Routine, "title" | "prompt" | "schedule">;
      return { status: 201, body: { ...MISSED, ...body, id: "rtn_2", scheduleText: body.schedule } };
    }
    if (req.path === "/api/inbox-watch" && req.method === "GET") return { body: current };
    if (req.path === "/api/inbox-watch" && req.method === "PATCH") {
      current = { ...current, enabled: (req.body as { enabled: boolean }).enabled };
      return { body: current };
    }
    return undefined;
  });
}

describe("RoutinesPage", () => {
  it("shows a missed run as missed, with why", async () => {
    serve();
    renderWithProviders(<RoutinesPage />);
    const card = await screen.findByRole("article", { name: "Morning inbox" });
    expect(within(card).getByText("Missed")).toBeTruthy();
    expect(within(card).getByText("Missed the run due at 08:00 while Steward wasn't running.")).toBeTruthy();
  });

  it("switches the inbox watch on, and says it has not looked yet", async () => {
    const server = serve();
    renderWithProviders(<RoutinesPage />);
    const section = await screen.findByRole("region", { name: "Watch my inbox" });
    expect(await within(section).findByText("Hasn't looked yet")).toBeTruthy();
    const toggle = within(section).getByRole("switch", { name: /Watch my inbox/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(server.calls.some((c) => c.method === "PATCH" && c.path === "/api/inbox-watch")).toBe(true),
    );
    expect(server.calls.find((c) => c.method === "PATCH")?.body).toEqual({ enabled: true });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  });

  it("says when the watch could not look, without claiming it did", async () => {
    serve({
      enabled: true,
      checkedAt: "2026-10-22T10:30:00Z",
      note: "Couldn't look: no mailbox is connected.",
      noteAt: "2026-10-22T11:00:00Z",
    });
    renderWithProviders(<RoutinesPage />);
    const section = await screen.findByRole("region", { name: "Watch my inbox" });
    expect(await within(section).findByText(/Couldn't look: no mailbox is connected\./)).toBeTruthy();
    expect(within(section).queryByText("Hasn't looked yet")).toBeNull();
  });

  it("lets a schedule the server reads but the form cannot be saved", async () => {
    const server = serve();
    renderWithProviders(<RoutinesPage />);
    const form = await screen.findByRole("region", { name: "Add a routine" });
    fireEvent.change(within(form).getByRole("textbox", { name: /Name/ }), { target: { value: "Rent" } });
    fireEvent.change(within(form).getByRole("textbox", { name: /What should Steward do/ }), {
      target: { value: "Remind me the rent is due." },
    });
    const cron = within(form).getByRole("textbox", { name: /Schedule/ });
    fireEvent.change(cron, { target: { value: "*/45 * * * *" } });
    expect(within(form).getByText("Custom schedule (*/45 * * * *)")).toBeTruthy();
    fireEvent.change(cron, { target: { value: "0 9 L * *" } });
    expect(within(form).getByText(CHECKED_ON_SAVE)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: /Add routine/ }));
    await waitFor(() =>
      expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/routines")?.body).toMatchObject(
        {
          title: "Rent",
          schedule: "0 9 L * *",
        },
      ),
    );
  });
});
