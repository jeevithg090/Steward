import type { AgentProfile, AgentsResponse, AppInfo } from "@steward/shared";
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

const STEWARD: AgentProfile = {
  id: "steward",
  name: "Steward",
  title: "",
  instructions: "",
  skills: [],
  tools: ["*"],
  source: "tenant",
};

const GROK: AgentProfile = {
  id: "steward-grok",
  name: "Steward on Grok",
  title: "Your steward, thinking with Grok",
  instructions: "",
  skills: [],
  tools: ["*"],
  model: "xai/grok-4.7",
  source: "tenant",
};

const RENT_SCOUT: AgentProfile = {
  id: "rent-scout",
  name: "Rent Scout",
  title: "Finds flats",
  instructions: "",
  skills: [],
  tools: [],
  source: "bot:rent-scout",
};

const INFO = {
  brand: { name: "Steward", tagline: "", accent: "#0f6e66", voice: "" },
  agents: [STEWARD, GROK, RENT_SCOUT],
  starters: ["What needs me today?"],
  model: { provider: "scripted", model: "-", scripted: true },
  mail: { connected: false, label: "Demo inbox", isDemo: true },
  version: "0.1.0",
  singleUser: true,
} satisfies AppInfo;

const AGENTS = {
  agents: [
    { ...STEWARD, available: true, provider: "scripted", model: "steward-scripted", signIn: "scripted" },
    {
      ...GROK,
      available: false,
      provider: "xai",
      model: "grok-4.7",
      signIn: "api-key",
      reason: "No xAI key is set. Add one in .env, then restart Steward.",
    },
    {
      ...RENT_SCOUT,
      available: true,
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      signIn: "api-key",
    },
  ],
} satisfies AgentsResponse;

function serve(createStatus = 500) {
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/info") return { body: INFO };
    if (req.path === "/api/agents") return { body: AGENTS };
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
  it("keeps the default first, marks bots, and carries each agent's model and availability", () => {
    expect(agentChoices(AGENTS.agents)).toEqual([
      {
        id: "steward",
        label: "Steward",
        bot: false,
        available: true,
        model: "Scripted demo model · steward-scripted",
      },
      {
        id: "steward-grok",
        label: "Steward on Grok",
        bot: false,
        available: false,
        model: "xAI · grok-4.7",
        reason: "No xAI key is set. Add one in .env, then restart Steward.",
      },
      {
        id: "rent-scout",
        label: "Rent Scout (bot)",
        bot: true,
        available: true,
        model: "OpenRouter · anthropic/claude-sonnet-5.5",
      },
    ]);
    expect(agentChoices(undefined)).toEqual([]);
  });
});

describe("the agent picker in an empty conversation", () => {
  it("shows each agent's model, greys out one without a key and says why", async () => {
    serve();
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
      </Routes>,
      { route: "/chat/thr_empty" },
    );
    const group = await screen.findByRole("group", { name: "Who should take this?" });
    expect(group.getAttribute("aria-describedby")).toBeTruthy();
    const steward = screen.getByRole("radio", { name: "Steward" }) as HTMLInputElement;
    expect(steward.checked).toBe(true);
    expect(steward.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Scripted demo model · steward-scripted")).toBeTruthy();

    const grok = screen.getByRole("radio", { name: "Steward on Grok" }) as HTMLInputElement;
    expect(grok.disabled).toBe(true);
    expect(screen.getByText("No xAI key is set. Add one in .env, then restart Steward.")).toBeTruthy();
    expect(screen.queryByText("xAI · grok-4.7")).toBeNull();
  });

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
    const bot = (await screen.findByRole("radio", { name: "Rent Scout (bot)" })) as HTMLInputElement;
    expect(bot.checked).toBe(false);
    expect(screen.getByText("OpenRouter · anthropic/claude-sonnet-5.5")).toBeTruthy();

    fireEvent.click(bot);
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
    const bot = await screen.findByRole("radio", { name: "Rent Scout (bot)" });
    fireEvent.click(bot);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/chat?agent=rent-scout"));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "POST" && c.path === "/api/threads")).toHaveLength(2),
    );
    expect(calls.filter((c) => c.method === "POST").at(-1)?.body).toEqual({ agentId: "rent-scout" });
  });
});
