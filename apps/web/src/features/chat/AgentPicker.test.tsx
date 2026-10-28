import type { AppInfo } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { agentChoices } from "./AgentPicker.tsx";
import { ChatPage } from "./ChatPage.tsx";
import { ChatActionsContext } from "./chat-context.tsx";
import { Starters } from "./Starters.tsx";

// The conversation itself is not under test here; it needs CopilotKit, which has its own test.
vi.mock("./ChatThread.tsx", () => ({ ChatThread: () => <p>Conversation</p> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INFO = {
  brand: { name: "Steward", tagline: "", accent: "#0f6e66", voice: "" },
  agents: [
    {
      id: "steward",
      name: "Steward",
      title: "",
      instructions: "",
      skills: [],
      tools: ["*"],
      source: "tenant",
    },
    {
      id: "rent-scout",
      name: "Rent Scout",
      title: "Finds flats",
      instructions: "",
      skills: [],
      tools: [],
      source: "bot:rent-scout",
    },
  ],
  starters: ["What needs me today?"],
  model: { provider: "scripted", model: "-", scripted: true },
  mail: { connected: false, label: "Demo inbox", isDemo: true },
  version: "0.1.0",
  singleUser: true,
} satisfies AppInfo;

function serve(createStatus = 500) {
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/info") return { body: INFO };
    if (req.path === "/api/threads" && req.method === "GET") return { body: [] };
    if (req.path === "/api/threads" && req.method === "POST")
      return { status: createStatus, body: { error: "That agent is not here any more." } };
    if (req.method === "DELETE") return { status: 204 };
    return undefined;
  });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

describe("agentChoices", () => {
  it("keeps the default first and marks bots as bots", () => {
    expect(agentChoices(INFO)).toEqual([
      { id: "steward", label: "Steward", bot: false },
      { id: "rent-scout", label: "Rent Scout (bot)", bot: true },
    ]);
    expect(agentChoices(undefined)).toEqual([]);
  });
});

describe("the agent picker in an empty conversation", () => {
  it("starts a new conversation with the chosen bot and drops the empty one", async () => {
    const { calls } = serve();
    const actions = {
      threadId: "thr_empty",
      agentId: "steward",
      send: vi.fn(),
      busy: false,
      isLatestTurn: () => true,
      isAwaitingApproval: () => false,
      showComputer: vi.fn(),
    };
    renderWithProviders(
      <Routes>
        <Route
          path="/chat/:threadId"
          element={
            <ChatActionsContext.Provider value={actions}>
              <Starters onPick={() => {}} />
            </ChatActionsContext.Provider>
          }
        />
        <Route path="/chat" element={<Where />} />
      </Routes>,
      { route: "/chat/thr_empty" },
    );
    const picker = (await screen.findByRole("combobox", {
      name: "Who should take this?",
    })) as HTMLSelectElement;
    expect(picker.getAttribute("aria-describedby")).toBeTruthy();
    expect(picker.value).toBe("steward");
    expect(screen.getByRole("option", { name: "Rent Scout (bot)" })).toBeTruthy();

    fireEvent.change(picker, { target: { value: "rent-scout" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/chat?agent=rent-scout"));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/threads/thr_empty")).toBe(true),
    );
  });
});

describe("the agent picker when a conversation could not start", () => {
  it("sets ?agent= and tries again with the chosen agent", async () => {
    const { calls } = serve();
    renderWithProviders(
      <Routes>
        <Route
          path="/chat"
          element={
            <>
              <ChatPage />
              <Where />
            </>
          }
        />
      </Routes>,
      { route: "/chat?agent=ghost" },
    );
    expect(await screen.findByText("Couldn't start a conversation")).toBeTruthy();
    const picker = (await screen.findByRole("combobox", {
      name: "Who should take this?",
    })) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "rent-scout" } });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/chat?agent=rent-scout"));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST" && c.path === "/api/threads")).toHaveLength(2),
    );
    expect(calls.filter((c) => c.method === "POST").at(-1)?.body).toEqual({ agentId: "rent-scout" });
  });
});
