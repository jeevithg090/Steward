import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ChatPage } from "./ChatPage.tsx";

// The conversation needs CopilotKit and has its own test; here only which agent it opens with matters.
const mounts = vi.hoisted(() => [] as { threadId: string; runtimeAgentId: string }[]);
vi.mock("./ChatThread.tsx", () => ({
  ChatThread: (props: { threadId: string; runtimeAgentId: string }) => {
    mounts.push({ threadId: props.threadId, runtimeAgentId: props.runtimeAgentId });
    return <p>Conversation with {props.runtimeAgentId}</p>;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mounts.length = 0;
});

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function draw(route: string) {
  return renderWithProviders(
    <Routes>
      {["/chat", "/chat/:threadId"].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <>
              <ChatPage />
              <Where />
            </>
          }
        />
      ))}
    </Routes>,
    { route },
  );
}

const summary = (id: string, agentId: string) => ({
  id,
  agentId,
  title: "",
  kind: "chat",
  updatedAt: "2026-11-10T09:00:00.000Z",
  running: false,
});

/** A list that never arrives, like a slow server. */
const never = () => new Promise<undefined>(() => {});

describe("which agent a conversation opens with", () => {
  it("opens a new conversation with a bot as that bot from the first draw, with a slow list", async () => {
    mockFetch((req) => {
      if (req.path === "/api/threads" && req.method === "POST")
        return { status: 201, body: summary("thr_new", "bot1") };
      if (req.path === "/api/threads") return never();
      return undefined;
    });
    draw("/chat?agent=bot1&prompt=Plan%20my%20week");
    expect(await screen.findByText("Conversation with bot1")).toBeTruthy();
    expect(mounts.every((mount) => mount.runtimeAgentId === "bot1")).toBe(true);
    const where = new URL(screen.getByTestId("where").textContent ?? "", "http://x");
    expect(where.pathname).toBe("/chat/thr_new");
    expect(where.searchParams.get("agent")).toBe("bot1");
    expect(where.searchParams.get("prompt")).toBe("Plan my week");
  });

  it("asks the server about a conversation the list does not have, and waits rather than guess", async () => {
    const { calls } = mockFetch((req) => {
      if (req.path === "/api/threads") return { body: [] };
      if (req.path === "/api/threads/thr_old") return { body: summary("thr_old", "bot1") };
      return undefined;
    });
    draw("/chat/thr_old");
    expect(screen.getByText("Opening the conversation…")).toBeTruthy();
    expect(await screen.findByText("Conversation with bot1")).toBeTruthy();
    expect(mounts.map((mount) => mount.runtimeAgentId)).not.toContain("steward");
    expect(calls.some((call) => call.path === "/api/threads/thr_old")).toBe(true);
  });

  it("says plainly when the conversation is gone, and offers a new one", async () => {
    mockFetch((req) => {
      if (req.path === "/api/threads" && req.method === "GET") return { body: [] };
      if (req.path === "/api/threads" && req.method === "POST")
        return { status: 201, body: summary("thr_new", "steward") };
      return undefined;
    });
    draw("/chat/thr_gone");
    expect(await screen.findByText("This conversation isn't here any more")).toBeTruthy();
    expect(mounts).toHaveLength(0);
    fireEvent.click(screen.getByRole("link", { name: "Start a new one" }));
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toMatch(/^\/chat\/thr_new\?agent=steward$/),
    );
  });
});
