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
  const coreSubscribers = new Set<Subscriber>();
  const copilotkit = {
    connectAgent: vi.fn(async () => ({ newMessages: [] })),
    runAgent: vi.fn(async () => ({ newMessages: [] })),
    stopAgent: vi.fn(),
    subscribe(subscriber: Subscriber) {
      coreSubscribers.add(subscriber);
      return { unsubscribe: () => coreSubscribers.delete(subscriber) };
    },
  };
  const emit = (name: string, params: Record<string, unknown> = {}) => {
    for (const subscriber of [...state.subscribers])
      subscriber[name]?.({ messages: state.messages, ...params });
  };
  /** CopilotKit's own error report, as its `onError` subscribers hear it. */
  const coreError = (code: string, context: Record<string, unknown> = {}) => {
    for (const subscriber of [...coreSubscribers])
      subscriber.onError?.({ code, context, error: new Error(code) });
  };
  return { state, agent, copilotkit, emit, coreError, coreSubscribers };
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
      AGENT_CONNECT_FAILED: "agent_connect_failed",
      AGENT_RUN_FAILED: "agent_run_failed",
      AGENT_RUN_FAILED_EVENT: "agent_run_failed_event",
      AGENT_RUN_ERROR_EVENT: "agent_run_error_event",
      AGENT_THREAD_LOCKED: "agent_thread_locked",
    },
  };
});

/** What /api/info says; most tests run before it has answered. */
const info = vi.hoisted(() => ({ data: undefined as unknown }));
/** The pending approvals the server lists. */
const listed = vi.hoisted(() => ({ approvals: [] as unknown[] }));

vi.mock("@/lib/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api.ts")>()),
  useInfo: () => ({ data: info.data }),
  useApprovals: () => ({ data: listed.approvals }),
  useApproval: () => ({ data: undefined }),
  useSkills: () => ({ data: [] }),
  useComputerStatus: () => ({ data: undefined }),
  useComputerActivity: () => ({ data: [] }),
}));

vi.mock("@/components/cards/ApprovalCard.tsx", () => ({
  ApprovalCard: ({
    approvalId,
    onDecided,
  }: {
    approvalId: string;
    onDecided?: (approval: unknown) => void;
  }) => (
    <div>
      <p>Approval {approvalId}</p>
      <button
        type="button"
        onClick={() => onDecided?.({ id: approvalId, status: "allowed", answer: "once" })}
      >
        Allow once {approvalId}
      </button>
    </div>
  ),
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
  kit.coreSubscribers.clear();
  kit.state.interrupts = [];
  info.data = undefined;
  listed.approvals = [];
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

  it("keeps the log quiet while the history replays, and live once it has", async () => {
    let finish = () => {};
    kit.copilotkit.connectAgent.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ newMessages: [] }))),
    );
    kit.state.messages = [{ id: "old", role: "assistant", content: "An old reply." }];
    draw();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.getAttribute("aria-live")).toBe("off");
    await act(async () => finish());
    expect(log.getAttribute("aria-live")).toBe("polite");
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

  describe("after an approval is answered", () => {
    const wide = () =>
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(min-width: 64rem)",
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }));

    it("moves the keyboard to the composer, not the page, before the card goes", async () => {
      wide();
      kit.state.interrupts = [
        { id: "call_1", toolCallId: "call_1", reason: "steward_approval", metadata: { approvalId: "apr_1" } },
      ];
      draw();
      const allow = await screen.findByRole("button", { name: "Allow once apr_1" });
      allow.focus();
      fireEvent.click(allow);
      expect(document.activeElement).toBe(textbox());
    });

    it("moves it to the next request when another is waiting", async () => {
      wide();
      kit.state.interrupts = ["apr_1", "apr_2"].map((id) => ({
        id: `call_${id}`,
        toolCallId: `call_${id}`,
        reason: "steward_approval",
        metadata: { approvalId: id },
      }));
      draw();
      fireEvent.click(await screen.findByRole("button", { name: "Allow once apr_1" }));
      expect((document.activeElement as HTMLElement | null)?.dataset.approvalId).toBe("apr_2");
    });

    it("does not draw a listed approval while its run is still streaming", async () => {
      listed.approvals = [{ id: "apr_9", threadId: "thr_1", toolCallId: "call_9", status: "pending" }];
      kit.state.isRunning = true;
      draw();
      await act(async () => {});
      expect(screen.queryByText("Approval apr_9")).toBeNull();
      act(() => {
        kit.state.isRunning = false;
        kit.state.rerender();
      });
      expect(screen.getByText("Approval apr_9")).toBeTruthy();
    });
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

  describe("when the history cannot be read", () => {
    // CopilotKit 1.81 never rejects a connect: it reports the failure, then resolves.
    const failingConnect = () => {
      kit.emit("onRunInitialized", { input: { runId: "run_connect" } });
      kit.emit("onRunFailed", { error: new TypeError("Failed to fetch") });
      kit.emit("onRunFinalized");
      return Promise.resolve({ newMessages: [] });
    };

    it("says so, offers no starters (so no switch of agent), and Try again reads it again", async () => {
      kit.copilotkit.connectAgent.mockImplementation(failingConnect);
      draw();
      expect(await screen.findByText("Couldn't load the earlier messages")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /What can Steward do for you/ })).toBeNull();
      expect(screen.queryByRole("radio")).toBeNull();
      // One problem, said once: not a second "Couldn't reach Steward" with a Try again that runs the model.
      expect(screen.queryByText(/Couldn't reach Steward/)).toBeNull();
      expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);

      kit.copilotkit.connectAgent.mockImplementation(async () => ({ newMessages: [] }));
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("heading", { name: /What can Steward do for you/ })).toBeTruthy();
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(2);
      expect(kit.copilotkit.runAgent).not.toHaveBeenCalled();
      expect(screen.queryByText("Couldn't load the earlier messages")).toBeNull();
    });

    it("also hears a failure CopilotKit reports only through its own errors", async () => {
      kit.copilotkit.connectAgent.mockImplementation(async () => {
        kit.coreError("agent_connect_failed", { agentId: undefined });
        return { newMessages: [] };
      });
      draw();
      expect(await screen.findByText("Couldn't load the earlier messages")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /What can Steward do for you/ })).toBeNull();
    });

    it("says the newest messages could not be read when following a run fails", async () => {
      draw();
      await screen.findByRole("heading", { name: /What can Steward do for you/ });
      kit.copilotkit.connectAgent.mockImplementation(failingConnect);
      act(() =>
        live.dispatch({ type: "run.finished", threadId: "thr_1", runId: "run_sweep", agentId: "steward" }),
      );
      expect(await screen.findByText("Couldn't load Steward's newest messages")).toBeTruthy();
      kit.copilotkit.connectAgent.mockImplementation(async () => ({ newMessages: [] }));
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await act(async () => {});
      expect(kit.copilotkit.connectAgent).toHaveBeenCalledTimes(3);
      expect(kit.copilotkit.runAgent).not.toHaveBeenCalled();
      expect(screen.queryByText("Couldn't load Steward's newest messages")).toBeNull();
    });
  });

  describe("failures read back from the history", () => {
    const replay = (...runs: ("ok" | "failed")[]) =>
      kit.copilotkit.connectAgent.mockImplementation(async () => {
        kit.emit("onRunInitialized", { input: { runId: "run_connect" } });
        runs.forEach((outcome, index) => {
          kit.emit("onRunStartedEvent", { event: { type: "RUN_STARTED", runId: `run_${index}` } });
          if (outcome === "failed")
            kit.emit("onRunErrorEvent", { event: { type: "RUN_ERROR", message: "429 rate limit" } });
        });
        kit.emit("onRunFinalized");
        return { newMessages: [] };
      });

    it("are not news when a later run worked", async () => {
      kit.state.messages = [{ id: "a1", role: "assistant", content: "All done." }];
      replay("failed", "ok");
      draw();
      await screen.findByText("All done.");
      await act(async () => {});
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(/model provider is busy/)).toBeNull();
      expect(kit.copilotkit.runAgent).not.toHaveBeenCalled();
    });

    it("say the last reply didn't finish when the newest run failed, and Try again runs it", async () => {
      kit.state.messages = [{ id: "u1", role: "user", content: "What needs me today?" }];
      replay("ok", "failed");
      draw();
      expect(await screen.findByText("Steward's last reply didn't finish")).toBeTruthy();
      expect(screen.getByText("The model provider is busy. Try again in a minute.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(kit.copilotkit.runAgent).toHaveBeenCalledTimes(1);
    });

    it("show a followed run's own failure as it is", async () => {
      draw();
      await screen.findByRole("heading", { name: /What can Steward do for you/ });
      replay("ok", "failed");
      act(() =>
        live.dispatch({ type: "run.finished", threadId: "thr_1", runId: "run_sweep", agentId: "steward" }),
      );
      expect(await screen.findByText("The model provider is busy. Try again in a minute.")).toBeTruthy();
      expect(screen.queryByText("Steward's last reply didn't finish")).toBeNull();
    });
  });

  it("says who answers: a bot's conversation names the bot, not Steward", async () => {
    info.data = {
      brand: { name: "Steward" },
      agents: [
        { id: "steward", name: "Steward", title: "" },
        { id: "bot1", name: "Focus time guard", title: "Guards your focus time", source: "bot:focus" },
      ],
      starters: [],
      model: { scripted: true },
      mail: { isDemo: true },
    };
    kit.state.messages = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "Hi." },
    ];
    draw({ runtimeAgentId: "bot1", title: "hello" });
    await screen.findByText("Hi.");
    expect(screen.getByText("With Focus time guard")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message Focus time guard" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Ask Focus time guard, or type / for a skill")).toBeTruthy();
    expect(screen.getByText("Focus time guard said:", { exact: false })).toBeTruthy();
    expect(screen.queryByText("Steward said:", { exact: false })).toBeNull();
    // Its computer is its own, and is named so.
    expect(screen.getAllByText("Focus time guard's computer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Steward's computer")).toBeNull();
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

  describe("a step its run left open", () => {
    const OPEN = [
      { id: "u1", role: "user", content: "Read my mail" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", type: "function", function: { name: "mail_list", arguments: "{}" } }],
      },
    ];

    it("shows as stopped once the person stops the run", async () => {
      draw();
      await screen.findByRole("heading", { name: /What can Steward do for you/ });
      act(() => {
        kit.state.isRunning = true;
        kit.state.messages = OPEN;
        kit.state.rerender();
      });
      expect(screen.queryByText(/Stopped before it finished/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Stop Steward" }));
      act(() => {
        kit.state.isRunning = false;
        kit.emit("onRunFinalized");
        kit.state.rerender();
      });
      expect(screen.getByText("Stopped before it finished: Check your mail")).toBeTruthy();
    });

    it("shows as stopped after a reload when the newest run was stopped", async () => {
      kit.state.messages = OPEN;
      kit.copilotkit.connectAgent.mockImplementation(async () => {
        kit.emit("onRunInitialized", { input: { runId: "run_connect" } });
        kit.emit("onRunStartedEvent", { event: { type: "RUN_STARTED", runId: "run_1" } });
        kit.emit("onRunFinishedEvent", { event: { type: "RUN_FINISHED" }, outcome: "cancelled" });
        kit.emit("onRunFinalized");
        return { newMessages: [] };
      });
      draw();
      expect(await screen.findByText("Stopped before it finished: Check your mail")).toBeTruthy();
    });
  });

  describe("reading aloud", () => {
    let speak: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify({ readAloud: true }));
      speak = vi.fn();
      vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), getVoices: () => [] });
      vi.stubGlobal(
        "SpeechSynthesisUtterance",
        class {
          constructor(readonly text: string) {}
        },
      );
    });
    const said = () => speak.mock.calls.map(([utterance]) => (utterance as { text: string }).text).join(" ");

    it("does not speak a handed-on agent's words as the conversation's own", async () => {
      draw();
      await screen.findByRole("heading", { name: /What can Steward do for you/ });
      act(() => {
        kit.state.messages = [
          { id: "u1", role: "user", content: "Ask Codex to run the tests" },
          { id: "c1", role: "assistant", content: "Running the tests now.", subagentRunId: "sub-call_1" },
          { id: "a1", role: "assistant", content: "Codex says all tests pass." },
        ];
        kit.emit("onRunFinalized");
      });
      expect(said()).toBe("Codex says all tests pass.");
    });

    it("says when the run stopped to ask, and what it asks", async () => {
      draw();
      await screen.findByRole("heading", { name: /What can Steward do for you/ });
      act(() => {
        kit.state.messages = [{ id: "u1", role: "user", content: "Email Sam" }];
        kit.emit("onRunFinishedEvent", {
          event: { type: "RUN_FINISHED" },
          outcome: "interrupt",
          interrupts: [
            {
              id: "call_1",
              reason: "steward_approval",
              metadata: { approvalId: "apr_1", summary: "Send an email to sam@example.com: “Friday”." },
            },
          ],
        });
        kit.emit("onRunFinalized");
      });
      expect(said()).toBe(
        "Steward is asking before it acts: Send an email to sam@example.com: “Friday”. The request is below.",
      );
    });

    it("says nothing about an old request replayed with the history", async () => {
      kit.copilotkit.connectAgent.mockImplementation(async () => {
        kit.emit("onRunFinishedEvent", {
          event: { type: "RUN_FINISHED" },
          outcome: "interrupt",
          interrupts: [{ id: "call_1", reason: "steward_approval", metadata: { summary: "Pay an invoice" } }],
        });
        kit.emit("onRunFinalized");
        return { newMessages: [] };
      });
      draw();
      await screen.findByRole("heading", { name: /What can Steward do for you/ });
      expect(speak).not.toHaveBeenCalled();
    });
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
