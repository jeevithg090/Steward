import type { AuditEvent, ChainCheck } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api.ts";
import { type FakeRequest, type FakeResponse, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { RecordPage } from "./RecordPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entry = (over: Partial<AuditEvent> & Pick<AuditEvent, "seq" | "type">): AuditEvent => ({
  id: `aud_${over.seq}`,
  at: "2026-11-10T08:00:00Z",
  actorId: "local",
  detail: {},
  prevHash: "0".repeat(64),
  hash: `${over.seq}`.padStart(64, "a"),
  ...over,
});

const tool = { name: "mail_send", kind: "send" as const, surface: "mail" as const, source: "builtin" };

/** A record where a routine sent a mail: the decision names who started it, the outcome doesn't. */
const ROUTINE_SEND = [
  entry({ seq: 2, type: "tool.completed", toolCallId: "call_1", runId: "run_1", threadId: "thr_9", tool }),
  entry({
    seq: 1,
    type: "tool.decided",
    toolCallId: "call_1",
    runId: "run_1",
    threadId: "thr_9",
    tool,
    effect: "allow",
    detail: { initiator: { kind: "routine", id: "rtn_1" } },
  }),
];

function serve({
  events = ROUTINE_SEND,
  total,
  verify = { body: { ok: true, count: events.length } satisfies ChainCheck },
}: {
  events?: AuditEvent[];
  total?: (req: FakeRequest) => number;
  verify?: FakeResponse | (() => FakeResponse);
} = {}) {
  return mockFetch((req) => {
    if (req.path === "/api/audit/verify") return typeof verify === "function" ? verify() : verify;
    if (req.path === "/api/audit") return { body: { events, total: total?.(req) ?? events.length } };
    return undefined;
  });
}

const auditCalls = (server: ReturnType<typeof mockFetch>) =>
  server.calls.filter((c) => c.path === "/api/audit");

describe("RecordPage: the chain badge", () => {
  it("says what a broken chain means, what still holds, and opens the record at the break", async () => {
    const server = serve({ verify: { body: { ok: false, count: 6, brokenAt: 7 } } });
    renderWithProviders(<RecordPage />, { route: "/record?effect=deny" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The record has been changed");
    expect(alert.textContent).toContain("Entry #7 is missing, out of order, or no longer seals");
    expect(alert.textContent).toContain("The 6 entries before it still check out");
    expect(alert.textContent).toContain("Steward still checks every action against your rules");
    expect(alert.textContent).toContain(".steward-data/steward.db");

    fireEvent.click(within(alert).getByRole("button", { name: "Show entry #7" }));
    await waitFor(() => expect(auditCalls(server).at(-1)?.url).toBe("/api/audit?limit=50&before=8"));
    expect(await screen.findByText("Showing entry #7 and older.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the newest" }));
    await waitFor(() => expect(auditCalls(server).at(-1)?.url).toBe("/api/audit?limit=50"));
  });

  it("says when it couldn't check, and Try again checks again", async () => {
    let fail = true;
    serve({
      verify: () =>
        fail
          ? { status: 500, body: { error: "Steward couldn't read the record." } }
          : { body: { ok: true, count: 2 } },
    });
    renderWithProviders(<RecordPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't check the record");
    expect(alert.textContent).toContain("Steward couldn't read the record.");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("status")).textContent).toBe("Record intact");
    expect(screen.getByText(/2 entries verified/)).toBeTruthy();
  });

  it("isn't checked again when a new entry arrives", async () => {
    const server = serve();
    const { client } = renderWithProviders(<RecordPage />);
    await screen.findByText(/2 entries verified/);
    await client.invalidateQueries({ queryKey: queryKeys.audit });
    await waitFor(() => expect(auditCalls(server)).toHaveLength(2));
    expect(server.calls.filter((c) => c.path === "/api/audit/verify")).toHaveLength(1);
  });
});

describe("RecordPage: entries and filters", () => {
  it("says who started an action: a routine, not you", async () => {
    serve();
    renderWithProviders(<RecordPage />);
    const rows = await screen.findAllByRole("button", { name: /Show details/ });
    expect(rows).toHaveLength(2);
    // The outcome row has no initiator of its own; it takes the one its decision recorded.
    for (const row of rows) expect(row.textContent).toContain("Started by a routine");
    fireEvent.click(rows[0]!);
    expect(screen.getAllByText("A routine, for you").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^You$/)).toBeNull();
    const link = screen.getAllByRole("link", { name: "Open the conversation" })[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/chat/thr_9");
  });

  it("says You for what the person started", async () => {
    serve({
      events: [
        entry({
          seq: 1,
          type: "tool.decided",
          toolCallId: "c",
          tool,
          effect: "ask",
          detail: { initiator: { kind: "person", id: "local" } },
        }),
      ],
    });
    renderWithProviders(<RecordPage />);
    const row = await screen.findByRole("button", { name: /Show details/ });
    expect(row.textContent).not.toContain("Started by");
    fireEvent.click(row);
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("says a routine started a run, and an action, when no decision is on screen", async () => {
    serve({
      events: [
        // A run's row names its starter as a word.
        entry({
          seq: 3,
          type: "run.finished",
          runId: "run_7",
          detail: { outcome: "success", initiator: "routine" },
        }),
        // A failure carries its own initiator, so the Failed filter, which hides decisions, still knows.
        entry({
          seq: 2,
          type: "tool.failed",
          toolCallId: "call_8",
          runId: "run_8",
          tool,
          detail: { error: "The server said no.", initiator: { kind: "routine", id: "rtn_1" } },
        }),
      ],
    });
    renderWithProviders(<RecordPage />, { route: "/record?effect=failed" });
    const rows = await screen.findAllByRole("button", { name: /Show details/ });
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.textContent).toContain("Started by a routine");
    expect(screen.getAllByText("A routine, for you")).toHaveLength(2);
    expect(screen.queryByText(/^You$/)).toBeNull();
  });

  it("keeps the space after a word while the search runs, so the next word isn't joined on", async () => {
    const server = serve();
    renderWithProviders(<RecordPage />);
    const search = (await screen.findByRole("searchbox", { name: "Search" })) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "web " } });
    await waitFor(() => expect(auditCalls(server).at(-1)?.query.get("q")).toBe("web"));
    expect(search.value).toBe("web ");
  });

  it("reads its filters from the address and keeps them there, Failed included", async () => {
    const server = serve({ total: (req) => (req.query.get("effect") === "failed" ? 1 : 2) });
    renderWithProviders(<RecordPage />, { route: "/record?effect=deny&q=example.com" });
    await waitFor(() =>
      expect(auditCalls(server)[0]?.url).toBe("/api/audit?effect=deny&q=example.com&limit=50"),
    );
    const outcome = screen.getByRole("combobox", { name: "Outcome" }) as HTMLSelectElement;
    expect(outcome.value).toBe("deny");
    expect((screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement).value).toBe("example.com");

    fireEvent.change(outcome, { target: { value: "failed" } });
    await waitFor(() =>
      expect(auditCalls(server).at(-1)?.url).toBe("/api/audit?effect=failed&q=example.com&limit=50"),
    );
    expect((await screen.findAllByText("1 entry matches.")).length).toBeGreaterThan(0);
  });

  it("announces the count after a filter changes, not when new entries arrive", async () => {
    let count = 2;
    const server = serve({ total: () => count });
    const { client } = renderWithProviders(<RecordPage />);
    await screen.findByText("2 entries.");
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toBe("");

    count = 3;
    await client.invalidateQueries({ queryKey: queryKeys.audit });
    await screen.findByText("3 entries.");
    expect(live.textContent).toBe("");

    fireEvent.change(screen.getByRole("combobox", { name: "Outcome" }), { target: { value: "deny" } });
    await waitFor(() => expect(live.textContent).toBe("3 entries match."));
    expect(auditCalls(server).at(-1)?.query.get("effect")).toBe("deny");
  });

  it("shows the empty state for an empty record", async () => {
    serve({ events: [] });
    renderWithProviders(<RecordPage />);
    expect(await screen.findByText("Nothing recorded yet")).toBeTruthy();
  });
});
