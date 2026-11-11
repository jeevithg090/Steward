import type { ThreadSummary } from "@steward/shared";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ChatPage } from "./ChatPage.tsx";
import { reusableThread } from "./empty-thread.ts";

// The conversation itself (CopilotKit, the computer) is not under test: only which one opens.
vi.mock("./ChatThread.tsx", () => ({
  ChatThread: ({ threadId, runtimeAgentId }: { threadId: string; runtimeAgentId: string }) => (
    <p>
      Conversation {threadId} with {runtimeAgentId}
    </p>
  ),
}));

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 10, 9, minutes)).toISOString();

function thread(patch: Partial<ThreadSummary> & { id: string }): ThreadSummary {
  return {
    title: "New conversation",
    agentId: "steward",
    kind: "chat",
    updatedAt: at(0),
    running: false,
    ...patch,
  };
}

function renderChat(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/:threadId" element={<ChatPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reusableThread", () => {
  it("picks the newest empty chat with that agent, and nothing else", () => {
    const threads = [
      thread({ id: "old-empty", updatedAt: at(1) }),
      thread({ id: "new-empty", updatedAt: at(5) }),
      thread({ id: "said-something", updatedAt: at(9), lastMessagePreview: "Hello" }),
      thread({ id: "routine", updatedAt: at(9), kind: "routine" }),
      thread({ id: "working", updatedAt: at(9), running: true }),
      thread({ id: "named", updatedAt: at(9), title: "Trip planning" }),
      thread({ id: "bot", updatedAt: at(9), agentId: "helper" }),
    ];
    expect(reusableThread(threads, "steward")?.id).toBe("new-empty");
    expect(reusableThread(threads, "helper")?.id).toBe("bot");
    expect(reusableThread(threads, "nobody")).toBeUndefined();
    expect(reusableThread(undefined, "steward")).toBeUndefined();
  });
});

describe("ChatPage", () => {
  it("goes back to an empty conversation instead of making another", async () => {
    const empty = thread({ id: "thr_empty" });
    const { calls } = mockFetch((req) => {
      if (req.method === "GET" && req.path === "/api/threads") return { body: [empty] };
      if (req.method === "GET" && req.path === "/api/threads/thr_empty") return { body: empty };
      return undefined;
    });
    renderChat("/chat");
    expect(await screen.findByText("Conversation thr_empty with steward")).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("makes a new conversation when there is no empty one", async () => {
    const made = thread({ id: "thr_new" });
    const { calls } = mockFetch((req) => {
      if (req.method === "GET" && req.path === "/api/threads")
        return { body: [thread({ id: "busy", lastMessagePreview: "Hi" })] };
      if (req.method === "POST" && req.path === "/api/threads") return { status: 201, body: made };
      if (req.method === "GET" && req.path === "/api/threads/thr_new") return { body: made };
      return undefined;
    });
    renderChat("/chat");
    expect(await screen.findByText("Conversation thr_new with steward")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("says so when a conversation is not there, and offers no composer", async () => {
    const { calls } = mockFetch((req) => {
      if (req.method === "GET" && req.path === "/api/threads") return { body: [] };
      if (req.path === "/api/threads/ghost-thread")
        return { status: 404, body: { error: "Couldn't find that conversation." } };
      return undefined;
    });
    renderChat("/chat/ghost-thread");
    expect(await screen.findByText("This conversation isn't here any more")).toBeTruthy();
    expect(screen.queryByText(/Conversation ghost-thread/)).toBeNull();
    expect(screen.getByRole("link", { name: "Start a new one" }).getAttribute("href")).toBe("/chat");
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(false));
  });
});
