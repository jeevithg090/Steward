import type { Message } from "@copilotkit/react-core/v2";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESSIBILITY_STORAGE_KEY, AccessibilityProvider } from "@/app/accessibility.tsx";
import { ChatThread } from "./ChatThread.tsx";

/**
 * A stand-in for CopilotKit: one agent whose messages, run state and subscribers the test controls,
 * and a core whose connect, run and stop are spies. Everything else in the conversation is real.
 */
const kit = vi.hoisted(() => {
  type Subscriber = Record<string, ((params: Record<string, unknown>) => void) | undefined>;
  const state = {
    messages: [] as unknown[],
    isRunning: false,
    subscribers: new Set<Subscriber>(),
    rerender: () => {},
    interrupts: [] as {
      id: string;
      reason: string;
      toolCallId?: string;
      metadata?: Record<string, unknown>;
    }[],
  };
  const agent = {
    threadId: "thr_1",
    get messages() {
      return state.messages;
    },
    get isRunning() {
      return state.isRunning;
    },
    addMessage(message: unknown) {
      state.messages = [...state.messages, message];
      state.rerender();
    },
    subscribe(subscriber: Subscriber) {
      state.subscribers.add(subscriber);
      return { unsubscribe: () => state.subscribers.delete(subscriber) };
    },
  };
  const copilotkit = {
    connectAgent: vi.fn(async () => ({ newMessages: [] })),
    runAgent: vi.fn(async () => ({ newMessages: [] })),
    stopAgent: vi.fn(),
  };
  const emit = (name: string, params: Record<string, unknown> = {}) => {
    for (const subscriber of [...state.subscribers])
      subscriber[name]?.({ messages: state.messages, ...params });
  };
  return { state, agent, copilotkit, emit };
});

vi.mock("@copilotkit/react-core/v2", async () => {
  const React = await import("react");
  return {
    useAgent: () => {
      const [, force] = React.useReducer((n: number) => n + 1, 0);
      kit.state.rerender = force;
      return { agent: kit.agent, isReady: true };
    },
    useCopilotKit: () => ({ copilotkit: kit.copilotkit }),
    useRenderToolCall: () => () => null,
    useRenderTool: () => {},
    useInterrupt: (config: { render: (props: unknown) => unknown }) =>
      kit.state.interrupts.length > 0
        ? config.render({ interrupts: kit.state.interrupts, resolve: vi.fn(), cancel: vi.fn() })
        : null,
    CopilotChatConfigurationProvider: ({ children }: { children: unknown }) => children,
    CopilotKitProvider: ({ children }: { children: unknown }) => children,
    CopilotKitCoreErrorCode: {
      AGENT_RUN_FAILED: "agent_run_failed",
      AGENT_RUN_FAILED_EVENT: "agent_run_failed_event",
      AGENT_RUN_ERROR_EVENT: "agent_run_error_event",
      AGENT_THREAD_LOCKED: "agent_thread_locked",
    },
  };
});

vi.mock("@/lib/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api.ts")>()),
  useInfo: () => ({ data: undefined }),
  useApprovals: () => ({ data: [] }),
  useApproval: () => ({ data: undefined }),
  useSkills: () => ({ data: [] }),
  useComputerStatus: () => ({ data: undefined }),
  useComputerActivity: () => ({ data: [] }),
}));

vi.mock("@/components/cards/ApprovalCard.tsx", () => ({
  ApprovalCard: ({ approvalId }: { approvalId: string }) => <p>Approval {approvalId}</p>,
}));

// The conversation's computer connection; nothing answers it here.
class QuietSocket {
  readyState = 0;
  onopen = null;
  onclose = null;
  onerror = null;
  onmessage = null;
  send() {}
  close() {}
}

function draw(props: Partial<Parameters<typeof ChatThread>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccessibilityProvider savePlainLanguage={async () => {}}>
        <MemoryRouter>
          <ChatThread threadId="thr_1" runtimeAgentId="steward" {...props} />
        </MemoryRouter>
      </AccessibilityProvider>
    </QueryClientProvider>,
  );
}

const textbox = () => screen.getByRole("textbox", { name: "Message Steward" }) as HTMLTextAreaElement;
const userMessages = () => (kit.state.messages as Message[]).filter((m) => m.role === "user");

beforeEach(() => {
  kit.state.messages = [];
  kit.state.isRunning = false;
  kit.state.subscribers.clear();
  kit.state.interrupts = [];
  kit.copilotkit.connectAgent.mockClear();
  kit.copilotkit.runAgent.mockClear();
  kit.copilotkit.stopAgent.mockClear();
  vi.stubGlobal("WebSocket", QuietSocket);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatThread", () => {
  it("loads the thread's history and offers starters while it is empty", async () => {
    draw();
    expect(kit.copilotkit.connectAgent).toHaveBeenCalledWith({ agent: kit.agent });
    expect(await screen.findByRole("heading", { name: /What can Steward do for you\?/ })).toBeTruthy();
    expect(screen.getByRole("log", { name: "Conversation" })).toBeTruthy();
  });

  it("never greets the person by a name", async () => {
    draw();
    const heading = await screen.findByRole("heading", { name: /What can Steward do for you\?/ });
    expect(heading.textContent).toMatch(
      /^(Hi|Good morning|Good afternoon|Good evening)\. What can Steward do for you\?$/,
    );
  });

  it("sends a starter as the person's message and runs the agent", async () => {
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "What needs me today?" }));
    expect(userMessages().map((m) => m.content)).toEqual(["What needs me today?"]);
    expect(kit.copilotkit.runAgent).toHaveBeenCalledWith({ agent: kit.agent });
  });

  it("sends with Enter and keeps a new line with Shift+Enter", async () => {
    draw();
    await screen.findByRole("heading", { name: /What can Steward do for you/ });
    fireEvent.change(textbox(), { target: { value: "Line one" } });
    fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true });
    expect(userMessages()).toHaveLength(0);
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(userMessages().map((m) => m.content)).toEqual(["Line one"]);
    expect(textbox().value).toBe("");
  });

  it("sends ?prompt= once, after the history has loaded, and lets the page drop it", async () => {
    const onPromptConsumed = vi.fn();
    const { rerender } = draw({ initialPrompt: "Open news.ycombinator.com", onPromptConsumed });
    await screen.findByText("Open news.ycombinator.com");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AccessibilityProvider savePlainLanguage={async () => {}}>
          <MemoryRouter>
            <ChatThread
              threadId="thr_1"
              runtimeAgentId="steward"
              initialPrompt="Open news.ycombinator.com"
              onPromptConsumed={onPromptConsumed}
            />
          </MemoryRouter>
        </AccessibilityProvider>
      </QueryClientProvider>,
    );
    expect(userMessages()).toHaveLength(1);
    expect(onPromptConsumed).toHaveBeenCalled();
  });

  it("holds sending while an approval waits, and says why", async () => {
    kit.state.interrupts = [
      { id: "call_1", toolCallId: "call_1", reason: "steward_approval", metadata: { approvalId: "apr_1" } },
    ];
    draw();
    expect(await screen.findByText("Approval apr_1")).toBeTruthy();
    expect(screen.getByText("Answer the request above first.")).toBeTruthy();
    fireEvent.change(textbox(), { target: { value: "Hello" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(userMessages()).toHaveLength(0);
    expect(screen.getAllByText("Waiting for your answer").length).toBeGreaterThan(0);
  });

  it("shows a failed reply in place with Try again", async () => {
    draw();
    await screen.findByRole("heading", { name: /What can Steward do for you/ });
    act(() => kit.emit("onRunFailed", { error: new TypeError("Failed to fetch") }));
    const alert = await screen.findByText(/Couldn't reach Steward/);
    expect(alert).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(kit.copilotkit.runAgent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Couldn't reach Steward/)).toBeNull();
  });

  it("names the current step while Steward works, and Stop ends the run", async () => {
    draw();
    await screen.findByRole("heading", { name: /What can Steward do for you/ });
    act(() => {
      kit.state.isRunning = true;
      kit.state.messages = [
        { id: "u1", role: "user", content: "Read my mail" },
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", type: "function", function: { name: "mail_list", arguments: "{}" } }],
        },
      ];
      kit.state.rerender();
    });
    expect(screen.getByText("Steward is working: Reading your mail.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop Steward" }));
    expect(kit.copilotkit.stopAgent).toHaveBeenCalledWith({ agent: kit.agent });
  });

  it("reads new replies aloud when asked to, but never the history", async () => {
    localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify({ readAloud: true }));
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        constructor(readonly text: string) {}
      },
    );
    kit.state.messages = [{ id: "old", role: "assistant", content: "An old reply." }];
    draw();
    await screen.findByText("An old reply.");
    act(() => {
      kit.state.messages = [
        ...(kit.state.messages as Message[]),
        { id: "u1", role: "user", content: "Hi" },
        { id: "new", role: "assistant", content: "Your **brief** is ready." },
      ];
      kit.emit("onRunFinalized");
    });
    expect(speak).toHaveBeenCalledTimes(1);
    const [utterance] = speak.mock.calls[0] ?? [];
    expect((utterance as { text: string } | undefined)?.text).toBe("Your brief is ready.");
  });
});
