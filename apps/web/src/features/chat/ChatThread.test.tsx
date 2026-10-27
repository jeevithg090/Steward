import type { Message } from "@copilotkit/react-core/v2";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESSIBILITY_STORAGE_KEY, AccessibilityProvider } from "@/app/accessibility.tsx";
import { live } from "@/lib/live.ts";
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

// The live event stream; the tests deliver events with `live.dispatch`.
class QuietEventSource {
  onopen = null;
  onmessage = null;
  onerror = null;
  addEventListener() {}
  close() {}
}

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
  kit.copilotkit.connectAgent.mockReset();
  kit.copilotkit.connectAgent.mockImplementation(async () => ({ newMessages: [] }));
  kit.copilotkit.runAgent.mockClear();
  kit.copilotkit.stopAgent.mockClear();
  vi.stubGlobal("WebSocket", QuietSocket);
  vi.stubGlobal("EventSource", QuietEventSource);
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

  describe("runs the server starts in the conversation", () => {
    const run = (type: "run.started" | "run.finished", runId: string, threadId = "thr_1") =>
      act(() => live.dispatch({ type, threadId, runId, agentId: "steward" }));
    const loaded = () => screen.findByRole("heading", { name: /What can Steward do for you/ });

    it("connects again to follow a run it did not start, so its messages and approvals appear", async () => {
      draw();
      await loaded();
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(1);
      run("run.started", "run_routine");
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(2);
      // The followed run is now on screen; its end needs no second connect.
      act(() => kit.emit("onRunStartedEvent", { event: { type: "RUN_STARTED", runId: "run_routine" } }));
      run("run.finished", "run_routine");
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(2);
    });

    it("catches up when only the end of a run is heard", async () => {
      draw();
      await loaded();
      run("run.finished", "run_sweep");
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(2);
    });

    it("leaves its own runs, other conversations, and a run that is streaming here alone", async () => {
      draw();
      await loaded();
      act(() => kit.emit("onRunInitialized", { input: { runId: "run_mine" } }));
      run("run.started", "run_mine");
      run("run.finished", "run_mine");
      run("run.started", "run_elsewhere", "thr_2");
      act(() => {
        kit.state.isRunning = true;
        kit.state.rerender();
      });
      run("run.started", "run_other");
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(1);
    });

    it("does not write what is already on screen a second time when it connects again", async () => {
      kit.state.messages = [
        {
          id: "a1",
          role: "assistant",
          content: "Checked.",
          toolCalls: [{ id: "c1", type: "function", function: { name: "mail_list", arguments: "{}" } }],
        },
      ];
      draw();
      await screen.findByText("Checked.");
      let finish = () => {};
      kit.copilotkit.connectAgent.mockImplementation(
        () => new Promise((resolve) => (finish = () => resolve({ newMessages: [] }))),
      );
      run("run.finished", "run_routine");
      const replay = (event: Record<string, unknown>) =>
        [...kit.state.subscribers].map((subscriber) => subscriber.onEvent?.({ event }))[0];
      expect(replay({ type: "TEXT_MESSAGE_CONTENT", messageId: "a1", delta: "Checked." })).toEqual({
        stopPropagation: true,
      });
      expect(replay({ type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: "{}" })).toEqual({
        stopPropagation: true,
      });
      expect(replay({ type: "TEXT_MESSAGE_CONTENT", messageId: "a2", delta: "New" })).toBeUndefined();
      await act(async () => finish());
      // Outside a connect, nothing is held back.
      expect(replay({ type: "TEXT_MESSAGE_CONTENT", messageId: "a1", delta: "!" })).toBeUndefined();
    });

    it("reads a followed run's reply aloud, but never the history it loads", async () => {
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
      // A real connect ends its replay with onRunFinalized, as a run does.
      kit.copilotkit.connectAgent.mockImplementation(async () => {
        kit.emit("onRunFinalized");
        return { newMessages: [] };
      });
      draw();
      await screen.findByText("An old reply.");
      expect(speak).not.toHaveBeenCalled();
      kit.copilotkit.connectAgent.mockImplementation(async () => {
        kit.state.messages = [
          ...(kit.state.messages as Message[]),
          { id: "new", role: "assistant", content: "Your routine is done." },
        ];
        kit.emit("onRunFinalized");
        return { newMessages: [] };
      });
      run("run.finished", "run_routine");
      await act(async () => {});
      expect(speak).toHaveBeenCalledTimes(1);
      expect((speak.mock.calls[0]?.[0] as { text: string } | undefined)?.text).toBe("Your routine is done.");
    });
  });
});
