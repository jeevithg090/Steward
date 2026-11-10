import type { Settings, Task } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finishWelcome } from "@/lib/onboarding.ts";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { TodayPage } from "./TodayPage.tsx";

// Today's newest suggestion, with Start and Hide. Kept apart from TodayPage.test.tsx, which is
// about the brief.

const settings: Settings = {
  model: { provider: "scripted", model: "steward-scripted" },
  plainLanguage: false,
  briefTime: "08:00",
  timezone: "Europe/London",
  approvalExpiryHours: 24,
};

function suggestion(id: string, title: string, createdAt: string, emailId?: string): Task {
  return {
    id,
    title,
    detail: "",
    state: "suggested",
    source: "suggestion",
    ...(emailId ? { emailId } : {}),
    createdAt,
    updatedAt: createdAt,
  } as Task;
}

/** A server that keeps tasks and their states, as the real one does. */
function serve(tasks: Task[]) {
  const store = new Map(tasks.map((t) => [t.id, { ...t }]));
  return mockFetch((req) => {
    if (req.path === "/api/settings") return { body: settings };
    if (req.path === "/api/brief") return { body: null };
    if (req.path === "/api/info") return { body: {} };
    if (req.path === "/api/approvals") return { body: [] };
    if (req.path === "/api/tasks") {
      const wanted = req.query.get("state")?.split(",");
      const list = [...store.values()].filter((t) => !wanted || wanted.includes(t.state));
      return { body: { tasks: list, counts: {} } };
    }
    const id = /^\/api\/tasks\/([^/]+)$/.exec(req.path)?.[1];
    if (id && req.method === "PATCH") {
      const task = store.get(id);
      if (!task) return { status: 404, body: { error: "Couldn't find that task." } };
      Object.assign(task, req.body as Partial<Task>);
      return { body: task };
    }
    return undefined;
  });
}

function renderToday() {
  return renderWithProviders(
    <>
      <TodayPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => finishWelcome());

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Today's suggestion: Hide", () => {
  it("hides it, keeps focus on the section as the next one takes its place, and Undo brings it back", async () => {
    const server = serve([
      suggestion("tsk_new", "Reply to Sam about Friday", "2026-10-27T09:00:00Z", "msg_1"),
      suggestion("tsk_old", "Pay the window cleaner", "2026-10-26T09:00:00Z", "msg_2"),
    ]);
    renderToday();
    expect(await screen.findByText("Reply to Sam about Friday")).toBeTruthy();
    const hide = screen.getByRole("button", { name: "Hide" });
    hide.focus();
    fireEvent.click(hide);

    expect(await screen.findByText("Hidden. Steward won't suggest this email again.")).toBeTruthy();
    const section = () => screen.getByRole("region", { name: "Steward could take this on" });
    expect(await within(section()).findByText("Pay the window cleaner")).toBeTruthy();
    const heading = within(section()).getByRole("heading", { name: "Steward could take this on" });
    await waitFor(() => expect(document.activeElement).toBe(heading));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    const [hidden, undone] = server.calls.filter((c) => c.method === "PATCH");
    expect(hidden?.path).toBe("/api/tasks/tsk_new");
    expect(hidden?.body).toEqual({ state: "hidden" });
    expect(undone?.path).toBe("/api/tasks/tsk_new");
    expect(undone?.body).toEqual({ state: "suggested" });
    // Back on offer, as the newest.
    expect(await within(section()).findByText("Reply to Sam about Friday")).toBeTruthy();
  });

  it("moves focus to the page's heading when no suggestion is left", async () => {
    serve([suggestion("tsk_1", "Book the dentist", "2026-10-27T09:00:00Z")]);
    renderToday();
    const hide = await screen.findByRole("button", { name: "Hide" });
    hide.focus();
    fireEvent.click(hide);

    // A task the person made has no email, so the toast doesn't speak of one.
    expect(await screen.findByText("Hidden.")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Steward could take this on" })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement?.id).toBe("page-title"));
  });
});
