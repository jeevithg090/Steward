import type { Routine } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { RoutinesPage } from "./RoutinesPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
const routine = (title: string, over: Partial<Routine> = {}): Routine => {
  n++;
  return {
    id: `rtn_${n}`,
    title,
    prompt: "Check my inbox and tell me what needs me.",
    schedule: "0 8 * * 1-5",
    scheduleText: "Weekdays at 08:00",
    timezone: "Europe/London",
    enabled: true,
    agentId: "steward",
    threadId: `thr_${n}`,
    consecutiveFailures: 0,
    nextRunAt: "2026-11-11T08:00:00Z",
    createdAt: `2026-11-0${n}T08:00:00Z`,
    ...over,
  };
};

const ran = { lastRunAt: "2026-11-10T08:00:00Z" };
const ROUTINES = [
  routine("Morning inbox", { ...ran, lastStatus: "ok" }),
  routine("Pay the bills", { ...ran, lastStatus: "refused" }),
  routine("Weekly review", { ...ran, lastStatus: "skipped" }),
  routine("Backup", { ...ran, lastStatus: "failed", lastError: "the site didn't answer" }),
  routine("New one"),
];

function serve(routines: Routine[] = ROUTINES) {
  return mockFetch((req) => {
    if (req.path === "/api/routines" && req.method === "GET") return { body: routines };
    if (req.path.startsWith("/api/routines/") && req.method === "DELETE") return { body: { ok: true } };
    return undefined;
  });
}

const card = (title: string) => screen.getByRole("article", { name: title });

describe("RoutinesPage", () => {
  it("says how each routine last went, in words", async () => {
    serve();
    renderWithProviders(<RoutinesPage />);
    await screen.findByRole("article", { name: "Morning inbox" });
    expect(within(card("Morning inbox")).getByText("Worked")).toBeTruthy();
    expect(within(card("Pay the bills")).getByText("Refused")).toBeTruthy();
    expect(within(card("Weekly review")).getByText("Waiting for you")).toBeTruthy();
    expect(within(card("Backup")).getByText("Failed")).toBeTruthy();
    expect(within(card("Backup")).getByText("the site didn't answer")).toBeTruthy();
    expect(within(card("New one")).getByText("Hasn't run yet")).toBeTruthy();
  });

  it("deletes a routine only after the person confirms", async () => {
    const server = serve();
    renderWithProviders(<RoutinesPage />);
    const backup = await screen.findByRole("article", { name: "Backup" });
    fireEvent.click(within(backup).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this routine?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(within(backup).getByRole("button", { name: "Delete" }));
    const again = await screen.findByRole("dialog", { name: "Delete this routine?" });
    fireEvent.click(within(again).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(server.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/routines/rtn_4");
  });

  it("can't run a paused routine, and says why", async () => {
    serve([routine("Paused one", { enabled: false })]);
    renderWithProviders(<RoutinesPage />);
    const paused = await screen.findByRole("article", { name: "Paused one" });
    const run = within(paused).getByRole("button", { name: "Run now" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(document.getElementById(run.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /paused/,
    );
  });

  it("says when there are no routines", async () => {
    serve([]);
    renderWithProviders(<RoutinesPage />);
    expect(await screen.findByText("No routines yet")).toBeTruthy();
  });
});
