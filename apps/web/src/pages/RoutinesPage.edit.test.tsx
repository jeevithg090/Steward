import type { Routine } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { routineChanges } from "./RoutineEditDialog.tsx";
import { RoutinesPage } from "./RoutinesPage.tsx";

// The real list holds every time zone the browser knows, which makes each render slow in a test.
vi.mock("@/components/forms/TimezoneSelect.tsx", async () => {
  const { Select } = await import("@/components/ui/Field.tsx");
  return {
    TimezoneSelect: ({ value, onChange }: { value: string; onChange: (zone: string) => void }) => (
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {[...new Set(["Europe/London", "Asia/Tokyo", "UTC", value])].map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </Select>
    ),
  };
});

const BRIEF: Routine = {
  id: "rtn_1",
  title: "Morning brief",
  prompt: "Tell me what needs me",
  schedule: "0 8 * * 1-5",
  scheduleText: "Weekdays at 08:00",
  timezone: "Europe/London",
  enabled: true,
  agentId: "steward",
  threadId: "thr_r1",
  consecutiveFailures: 0,
  createdAt: "2026-11-01T08:00:00.000Z",
};

const SETTINGS = {
  model: { provider: "scripted", model: "demo" },
  plainLanguage: false,
  briefTime: "08:00",
  timezone: "Asia/Tokyo",
  approvalExpiryHours: 24,
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(
  routines: Routine[],
  patch?: (body: Record<string, unknown>) => { status?: number; body: unknown },
) {
  let list = [...routines];
  return mockFetch((req) => {
    if (req.method === "GET" && req.path === "/api/routines") return { body: list };
    if (req.method === "GET" && req.path === "/api/settings") return { body: SETTINGS };
    if (req.method === "PATCH" && req.path === "/api/routines/rtn_1") {
      const answer = patch?.(req.body as Record<string, unknown>) ?? {
        body: { ...list[0], ...(req.body as object) },
      };
      if (!answer.status || answer.status < 400) list = [answer.body as Routine];
      return answer;
    }
    return undefined;
  });
}

/** Looks inside the routine's own card and the dialog, as a person would. */
async function card(title: string): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector: "h3" }, { timeout: 5000 });
  return heading.closest("article") as HTMLElement;
}

async function openEdit(title: string): Promise<HTMLDialogElement> {
  fireEvent.click(within(await card(title)).getByRole("button", { name: new RegExp(`^Edit ?: ${title}$`) }));
  const heading = await screen.findByText(`Edit “${title}”`, { selector: "h2" });
  return heading.closest("dialog") as HTMLDialogElement;
}

describe("routineChanges", () => {
  it("names only the fields that changed, tidied", () => {
    const form = {
      title: "Morning brief ",
      prompt: "Tell me what needs me",
      schedule: "0  9 * * 1-5",
      timezone: "Europe/London",
    };
    expect(routineChanges(BRIEF, form)).toEqual({ schedule: "0 9 * * 1-5" });
    expect(routineChanges(BRIEF, { ...form, schedule: "0 8 * * 1-5" })).toEqual({});
  });
});

describe("RoutinesPage", () => {
  it("edits a routine in place, sending only what changed", async () => {
    const { calls } = serve([BRIEF]);
    renderWithProviders(<RoutinesPage />);
    const dialog = await openEdit("Morning brief");
    expect((within(dialog).getByLabelText("Name", { exact: false }) as HTMLInputElement).value).toBe(
      "Morning brief",
    );
    const cron = within(dialog).getByLabelText("Schedule (cron)") as HTMLInputElement;
    expect(cron.value).toBe("0 8 * * 1-5");
    fireEvent.change(cron, { target: { value: "0 9 * * 1-5" } });
    fireEvent.click(within(dialog).getByText("Save changes"));
    await waitFor(() => expect(dialog.open).toBe(false));
    const sent = calls.find((c) => c.method === "PATCH");
    expect(sent?.body).toEqual({ schedule: "0 9 * * 1-5" });
  });

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    serve([BRIEF], () => ({ status: 400, body: { error: "That is not a time zone I know." } }));
    renderWithProviders(<RoutinesPage />);
    const dialog = await openEdit("Morning brief");
    fireEvent.change(within(dialog).getByLabelText("Time zone"), { target: { value: "UTC" } });
    fireEvent.click(within(dialog).getByText("Save changes"));
    expect(await within(dialog).findByText("That is not a time zone I know.")).toHaveProperty(
      "role",
      "alert",
    );
    expect(dialog.open).toBe(true);
  });

  it("won't run a paused routine, and says why", async () => {
    serve([{ ...BRIEF, enabled: false }]);
    renderWithProviders(<RoutinesPage />);
    const run = within(await card("Morning brief")).getByRole("button", { name: "Run now" });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("This routine is paused. Turn it on to run it.")).toBeTruthy();
  });

  it("links to what a routine did only once it has run", async () => {
    // A routine Steward set up by asking has no conversation until its first run.
    serve([
      BRIEF,
      {
        ...BRIEF,
        id: "rtn_2",
        title: "Evening wrap",
        threadId: "thr_r2",
        lastRunAt: "2026-11-09T18:00:00.000Z",
        lastStatus: "ok",
      },
    ]);
    renderWithProviders(<RoutinesPage />);
    const fresh = await card("Morning brief");
    expect(within(fresh).queryByRole("link", { name: /See what it did/ })).toBeNull();
    const ran = await card("Evening wrap");
    expect(
      within(ran)
        .getByRole("link", { name: /See what it did/ })
        .getAttribute("href"),
    ).toBe("/chat/thr_r2");
  });

  it("starts a new routine in the time zone Settings names", async () => {
    serve([]);
    renderWithProviders(<RoutinesPage />);
    const zone = (await screen.findByLabelText("Time zone")) as HTMLSelectElement;
    await waitFor(() => expect(zone.value).toBe("Asia/Tokyo"));
  });
});
