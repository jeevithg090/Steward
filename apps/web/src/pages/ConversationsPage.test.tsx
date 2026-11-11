import type { ThreadSummary } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ConversationsPage, matchesConversation } from "./ConversationsPage.tsx";

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const THREADS: ThreadSummary[] = Array.from({ length: 10 }, (_, i) => ({
  id: `thr_${i}`,
  title: `Chat number ${i}`,
  agentId: "steward",
  kind: "chat" as const,
  updatedAt: at(i + 10),
  running: false,
  lastMessagePreview: `Said ${i}`,
}));
THREADS.push(
  {
    id: "thr_brief",
    title: "Morning brief",
    agentId: "steward",
    kind: "routine",
    updatedAt: at(1),
    running: true,
    lastMessagePreview: "Three emails need you",
  },
  {
    id: "thr_task",
    title: "Book the dentist",
    agentId: "steward",
    kind: "task",
    updatedAt: at(2),
    running: false,
  },
);

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

function serve() {
  let threads = [...THREADS];
  return mockFetch((req) => {
    if (req.method === "GET" && req.path === "/api/threads") return { body: threads };
    const id = req.path.replace("/api/threads/", "");
    if (req.method === "PATCH") {
      const found = threads.find((t) => t.id === id);
      if (!found) return { status: 404, body: { error: "Couldn't find that conversation." } };
      const title = (req.body as { title: string }).title;
      threads = threads.map((t) => (t.id === id ? { ...t, title } : t));
      return { body: { ...found, title } };
    }
    if (req.method === "DELETE") {
      threads = threads.filter((t) => t.id !== id);
      return { body: { ok: true } };
    }
    return undefined;
  });
}

describe("matchesConversation", () => {
  it("finds words in the name or the last message, ignoring case", () => {
    const brief = THREADS.find((t) => t.id === "thr_brief")!;
    expect(matchesConversation(brief, "morning")).toBe(true);
    expect(matchesConversation(brief, "EMAILS")).toBe(true);
    expect(matchesConversation(brief, "dentist")).toBe(false);
    expect(matchesConversation(brief, "  ")).toBe(true);
  });
});

describe("ConversationsPage", () => {
  it("lists every conversation, not only the newest eight, with kind and Working", async () => {
    serve();
    renderWithProviders(<ConversationsPage />);
    expect(await screen.findByRole("link", { name: "Chat number 9" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.getByText("12 conversations")).toBeTruthy();
    const brief = screen.getByRole("link", { name: "Morning brief" }).closest("li")!;
    expect(within(brief).getByText("Working")).toBeTruthy();
    expect(within(brief).getByText(/^Routine ·/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Morning brief" }).getAttribute("href")).toBe("/chat/thr_brief");
  });

  it("narrows by words and by kind", async () => {
    serve();
    renderWithProviders(<ConversationsPage />);
    await screen.findByRole("link", { name: "Chat number 0" });
    fireEvent.change(screen.getByLabelText("Find a conversation"), { target: { value: "dentist" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("1 of 12 conversations")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find a conversation"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "Routines" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Morning brief" })).toBeTruthy();
  });

  it("renames a conversation", async () => {
    const { calls } = serve();
    renderWithProviders(<ConversationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Book the dentist" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename conversation" });
    const box = within(dialog).getByLabelText("Name");
    expect((box as HTMLInputElement).value).toBe("Book the dentist");
    fireEvent.change(box, { target: { value: "Dentist, Tuesday" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("link", { name: "Dentist, Tuesday" })).toBeTruthy();
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/api/threads/thr_task",
      body: { title: "Dentist, Tuesday" },
    });
  });

  it("deletes only after asking, and says what goes with it", async () => {
    const { calls } = serve();
    renderWithProviders(<ConversationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Morning brief" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete “Morning brief”?" });
    expect(within(dialog).getByText(/Steward is working in it now/)).toBeTruthy();
    expect(within(dialog).getByText(/allowed for this conversation only is turned off/)).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete Morning brief" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Delete “Morning brief”?" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("link", { name: "Morning brief" })).toBeNull());
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe("/api/threads/thr_brief");
  });
});
