import type { Approval, Task, TaskState, TasksResponse } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { TasksPage } from "./TasksPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
function task(state: TaskState, title: string, over: Partial<Task> = {}): Task {
  n++;
  return {
    id: `tsk_${n}`,
    title,
    detail: "",
    state,
    source: "suggestion",
    createdAt: `2026-10-27T08:${String(n).padStart(2, "0")}:00Z`,
    updatedAt: `2026-10-27T08:${String(n).padStart(2, "0")}:00Z`,
    ...over,
  };
}

function response(tasks: Task[]): TasksResponse {
  const counts = {
    needs_you: 0,
    suggested: 0,
    working: 0,
    ready_for_review: 0,
    needs_input: 0,
    resolved: 0,
    failed: 0,
    hidden: 0,
  } satisfies Record<TaskState, number>;
  for (const t of tasks) counts[t.state]++;
  return { tasks, counts };
}

const looseApproval = {
  id: "apr_loose",
  toolCallId: "call_1",
  runId: "run_1",
  threadId: "thr_1",
  agentId: "steward",
  status: "pending",
  summary: "Send an email to orders@example.com",
  tool: { name: "mail_send", kind: "send", surface: "mail", source: "builtin" },
  args: {},
  target: { recipients: ["orders@example.com"] },
  decision: { effect: "ask", reason: "Sending always asks.", findings: [] },
  canAlways: true,
  createdAt: "2026-10-27T08:00:00Z",
  expiresAt: "2026-10-28T08:00:00Z",
} satisfies Approval;

const TASKS = [
  task("needs_you", "Confirm Thursday's delivery"),
  task("failed", "Book the venue", { error: "the site didn't answer" }),
  task("suggested", "Reply to the supplier"),
  task("suggested", "Chase the unpaid invoice"),
  task("working", "Compare three quotes", { threadId: "thr_9" }),
  task("ready_for_review", "Draft the newsletter", { threadId: "thr_8" }),
  task("resolved", "Renew the domain"),
  task("hidden", "Something hidden"),
];

/** Lists the states asked for, as the server does; hidden only when asked. Counts cover every task. */
function serve(tasks: Task[] = TASKS, approvals: Approval[] = [looseApproval], limit = 500) {
  return mockFetch((req) => {
    if (req.path === "/api/tasks" && req.method === "GET") {
      const wanted = req.query.get("state")?.split(",");
      const listed = tasks.filter((t) => (wanted ? wanted.includes(t.state) : t.state !== "hidden"));
      return { body: { ...response(tasks), tasks: listed.slice(0, limit) } };
    }
    if (req.path === "/api/approvals") return { body: approvals };
    if (req.path.startsWith("/api/approvals/")) return { body: approvals[0] };
    if (req.method === "PATCH") return { body: { ...tasks[0], ...(req.body as object) } };
    return undefined;
  });
}

describe("TasksPage", () => {
  it("shows a count on every segment", async () => {
    serve();
    renderWithProviders(<TasksPage />, { route: "/tasks" });
    // Needs you = 1 task that needs you + 1 that failed + 1 approval no task stands for.
    expect(await screen.findByRole("tab", { name: "Needs you 3" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Suggested 2" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Working 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Ready for review 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Needs input 0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Resolved 1" })).toBeTruthy();
  });

  it("puts approvals and failed work under Needs you", async () => {
    serve();
    renderWithProviders(<TasksPage />, { route: "/tasks" });
    expect(await screen.findByText("Confirm Thursday's delivery")).toBeTruthy();
    expect(screen.getByText("Book the venue")).toBeTruthy();
    expect(screen.getByText("Couldn't finish: the site didn't answer")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Send an email to orders@example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Reply to the supplier")).toBeNull();
    expect(screen.queryByText("Something hidden")).toBeNull();
  });

  it("switches segment with a click and with the arrow keys", async () => {
    serve();
    renderWithProviders(<TasksPage />, { route: "/tasks" });
    fireEvent.click(await screen.findByRole("tab", { name: "Suggested 2" }));
    expect(screen.getByRole("tab", { name: "Suggested 2" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Reply to the supplier")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Start" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Hide" })).toHaveLength(2);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Suggested 2" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Working 1" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Compare three quotes")).toBeTruthy();
  });

  it("asks the server for each view's own tasks", async () => {
    const { calls } = serve();
    renderWithProviders(<TasksPage />, { route: "/tasks?view=resolved" });
    expect(await screen.findByText("Renew the domain")).toBeTruthy();
    const asked = calls.filter((c) => c.path === "/api/tasks").map((c) => c.query.get("state"));
    expect(asked).toEqual(expect.arrayContaining(["needs_you,failed", "resolved"]));
    expect(asked).not.toContain(null);
  });

  it("never says a view is empty while its count says otherwise", async () => {
    const old = Array.from({ length: 4 }, (_, i) => task("resolved", `Old job ${i}`));
    serve([...TASKS, ...old], [], 2);
    renderWithProviders(<TasksPage />, { route: "/tasks?view=resolved" });
    expect(await screen.findByRole("tab", { name: "Resolved 5" })).toBeTruthy();
    expect(await screen.findByText("3 older tasks aren't listed here.")).toBeTruthy();
    expect(screen.queryByText("Nothing resolved yet")).toBeNull();
  });

  it("opens on the segment named in the address", async () => {
    serve();
    renderWithProviders(<TasksPage />, { route: "/tasks?view=resolved" });
    expect(await screen.findByText("Renew the domain")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("marks finished work done", async () => {
    const { calls } = serve();
    renderWithProviders(<TasksPage />, { route: "/tasks?view=ready_for_review" });
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.path).toMatch(/^\/api\/tasks\/tsk_\d+$/);
    expect(patch.body).toEqual({ state: "resolved" });
  });

  it("hides a suggestion, and Undo on the toast puts it back", async () => {
    const { calls } = serve();
    renderWithProviders(
      <>
        <TasksPage />
        <Toaster />
      </>,
      { route: "/tasks?view=suggested" },
    );
    fireEvent.click((await screen.findAllByRole("button", { name: "Hide" }))[0]!);
    const toast = await screen.findByText("Hidden. Steward won't suggest it again.");
    expect(toast).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    const [hidden, undone] = calls.filter((c) => c.method === "PATCH");
    expect(hidden?.body).toEqual({ state: "hidden" });
    expect(undone?.path).toBe(hidden?.path);
    expect(undone?.body).toEqual({ state: "suggested" });
  });

  it("says when a segment is empty", async () => {
    serve();
    renderWithProviders(<TasksPage />, { route: "/tasks?view=needs_input" });
    expect(await screen.findByText("Nothing is waiting for your input")).toBeTruthy();
  });

  it("says when tasks could not load", async () => {
    mockFetch((req) =>
      req.path === "/api/tasks"
        ? { status: 503, body: { error: "Couldn't load your tasks. Try again." } }
        : { body: [] },
    );
    renderWithProviders(<TasksPage />, { route: "/tasks" });
    expect(await screen.findByText("Couldn't load your tasks. Try again.")).toBeTruthy();
  });
});
