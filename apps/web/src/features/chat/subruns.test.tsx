import type { Message } from "@copilotkit/react-core/v2";
import type { ComputerStatus } from "@steward/shared";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { FakeSocket } from "../computer/fake-socket.ts";
import { ComputerSession } from "../computer/session.tsx";
import { askedByOf } from "./ApprovalInterrupts.tsx";
import { type ChatActions, ChatActionsContext } from "./chat-context.tsx";
import { callOfSubRun, groupSubRuns, subRunOf } from "./subruns.tsx";
import { Transcript } from "./Transcript.tsx";
import { RENDERERS } from "./tool-registry.tsx";

// CopilotKit draws each tool call through Steward's own table, as `tools.tsx` registers it. The
// table is handed over after the imports, because it imports this mocked module itself.
const table = vi.hoisted(() => ({ renderers: {} as Record<string, unknown> }));
vi.mock("@copilotkit/react-core/v2", () => ({
  useInterrupt: () => null,
  useRenderToolCall:
    () =>
    ({
      toolCall,
      toolMessage,
    }: {
      toolCall: { id: string; function: { name: string; arguments: string } };
      toolMessage?: { content: string };
    }) => {
      const Renderer = table.renderers[toolCall.function.name];
      if (!Renderer) return null;
      return createElement(Renderer as never, {
        name: toolCall.function.name,
        toolCallId: toolCall.id,
        args: JSON.parse(toolCall.function.arguments || "{}"),
        status: toolMessage ? "complete" : "inProgress",
        result: toolMessage?.content,
      });
    },
}));
table.renderers = RENDERERS;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A transcript whose messages a test swaps, as a run or a history replay changes them. */
const swap = { set: (_messages: Message[]) => {} };
function Swappable({ initial }: { initial: Message[] }) {
  const [messages, setMessages] = useState(initial);
  swap.set = setMessages;
  return <Transcript messages={messages} running />;
}

const SUB = "sub-call_parent";
const MESSAGES = [
  { id: "u1", role: "user", content: "Ask Codex to run the tests" },
  {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call_parent",
        type: "function",
        function: {
          name: "delegate_task",
          arguments: JSON.stringify({ agentId: "codex", task: "run the tests" }),
        },
      },
    ],
  },
  { id: "c1", role: "assistant", content: "Running the tests now.", subagentRunId: SUB },
  {
    id: "c2",
    role: "assistant",
    content: "",
    subagentRunId: SUB,
    toolCalls: [
      {
        id: "codex-x:call_1",
        type: "function",
        function: { name: "shell", arguments: '{"command":"npm test"}' },
      },
    ],
  },
  {
    id: "c3",
    role: "tool",
    toolCallId: "codex-x:call_1",
    content: '{"ok":true,"data":"12 passed"}',
    subagentRunId: SUB,
  },
  { id: "c4", role: "assistant", content: "All tests pass.", subagentRunId: SUB },
  {
    id: "t1",
    role: "tool",
    toolCallId: "call_parent",
    content: JSON.stringify({
      ok: true,
      data: {
        untrusted: true,
        data: { status: "Codex finished working. Its answer follows, verbatim.", answer: "All tests pass." },
      },
    }),
  },
  { id: "a2", role: "assistant", content: "Codex says all tests pass." },
] as unknown as Message[];

describe("handed-on tasks in the conversation", () => {
  it("groups a task's messages under the call that started it", () => {
    expect(subRunOf(MESSAGES[2])).toBe(SUB);
    expect(subRunOf(MESSAGES[0])).toBeUndefined();
    expect(callOfSubRun("sub-call_parent-1a2b", ["call_parent"])).toBe("call_parent");
    expect([...groupSubRuns(MESSAGES).entries()].map(([k, v]) => [k, v.map((m) => m.id)])).toEqual([
      ["call_parent", ["c1", "c2", "c3", "c4"]],
    ]);
  });

  it("folds the task under '<Agent> worked on: <task>', out of the conversation's own flow", async () => {
    mockFetch((req) =>
      req.path === "/api/info"
        ? {
            body: {
              brand: { name: "Steward" },
              agents: [{ id: "codex", name: "Codex", title: "" }],
              starters: [],
              model: {},
              mail: {},
              version: "0",
              singleUser: true,
            },
          }
        : undefined,
    );
    renderWithProviders(<Transcript messages={MESSAGES} running={false} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    const summary = await within(log).findByText("Codex worked on: run the tests");
    const details = summary.closest("details") as HTMLElement;
    expect(details).toBeTruthy();
    // The child's words are inside the fold, in a list of its own that is not a second live log.
    const nested = within(details).getByRole("list", { name: "What Codex did" });
    expect(nested.getAttribute("aria-live")).toBeNull();
    expect(within(nested).getByText("Running the tests now.")).toBeTruthy();
    expect(within(nested).getByText("All tests pass.")).toBeTruthy();
    // A screen reader hears who said it.
    expect(within(nested).getAllByText("Codex said:", { exact: false }).length).toBeGreaterThan(0);
    // The parent's own reply is in the flow; the child's is not, outside the fold.
    expect(within(log).getByText("Codex says all tests pass.")).toBeTruthy();
    expect(
      within(log)
        .getAllByText("All tests pass.")
        .every((el) => details.contains(el)),
    ).toBe(true);
  });

  it("says a task is still going while it has no answer", async () => {
    mockFetch(() => undefined);
    renderWithProviders(<Transcript messages={MESSAGES.slice(0, 4)} running />);
    expect(await screen.findByText("codex is working on: run the tests")).toBeTruthy();
  });

  describe("the other agent's computer", () => {
    /** Every socket the page opens, by the computer it reaches. */
    let opened: FakeSocket[];
    const socketFor = (agentId: string) =>
      opened.find((socket) => socket.url.endsWith(`/ws/computer/${agentId}`));
    const status = (socket: FakeSocket, patch: Partial<ComputerStatus>) =>
      act(() =>
        socket.receive({
          type: "status",
          status: {
            agentId: "codex",
            running: true,
            controller: "agent",
            viewport: { width: 1280, height: 800 },
            ...patch,
          },
        }),
      );

    beforeEach(() => {
      opened = [];
      vi.stubGlobal(
        "WebSocket",
        class extends FakeSocket {
          constructor(url: string) {
            super(url);
            opened.push(this);
          }
        },
      );
      HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
      HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      };
      mockFetch((req) =>
        req.path === "/api/info"
          ? {
              body: {
                brand: { name: "Steward" },
                agents: [
                  { id: "steward", name: "Steward", title: "" },
                  { id: "codex", name: "Codex", title: "" },
                ],
                starters: [],
                model: {},
                mail: {},
                version: "0",
                singleUser: true,
              },
            }
          : undefined,
      );
    });

    const parent: ChatActions = {
      threadId: "thr_1",
      agentId: "steward",
      agentName: "Steward",
      send: vi.fn(),
      busy: false,
      isLatestTurn: () => true,
      isAwaitingApproval: () => false,
      showComputer: vi.fn(),
    };

    /** A task still running, whose agent is asking for help and for a password on its own computer. */
    const RUNNING = [
      ...MESSAGES.slice(0, 2),
      {
        id: "c5",
        role: "assistant",
        content: "",
        subagentRunId: SUB,
        toolCalls: [
          {
            id: "codex-x:help",
            type: "function",
            function: {
              name: "request_help",
              arguments: JSON.stringify({ reason: "A sign-in page needs you." }),
            },
          },
        ],
      },
    ] as unknown as Message[];

    function draw(messages: Message[]) {
      return renderWithProviders(
        <ChatActionsContext.Provider value={parent}>
          <ComputerSession agentId="steward">
            <Transcript messages={messages} running />
          </ComputerSession>
        </ChatActionsContext.Provider>,
      );
    }

    it("sends a running task's secret on that agent's own computer, never this conversation's", async () => {
      draw(RUNNING);
      await screen.findByText("Codex is working on: run the tests");
      const codex = socketFor("codex");
      const steward = socketFor("steward");
      expect(codex).toBeTruthy();
      act(() => codex?.open());
      act(() => steward?.open());
      status(codex!, {
        secret: {
          id: "sec_1",
          ref: "e7",
          label: "Password",
          host: "example.com",
          requestedAt: "2026-11-10T09:00:00Z",
        },
      });
      const dialog = await screen.findByRole("dialog", {
        name: /Codex needs something only you should type/,
      });
      const field = within(dialog).getByLabelText("Password") as HTMLInputElement;
      field.value = "hunter2";
      fireEvent.click(within(dialog).getByRole("button", { name: "Send to the page" }));
      expect(codex?.sent).toContainEqual({ type: "secret", requestId: "sec_1", value: "hunter2" });
      expect(steward?.sent.some((message) => message.type === "secret")).toBe(false);
    });

    it("says when that agent needs the person on its computer, and Take the wheel reaches it", async () => {
      draw(RUNNING);
      await screen.findByText("Codex is working on: run the tests");
      const codex = socketFor("codex")!;
      act(() => codex.open());
      act(() => socketFor("steward")?.open());
      status(codex, { help: { reason: "A sign-in page needs you.", requestedAt: "2026-11-10T09:00:00Z" } });
      expect(screen.getByText("Codex needs you on its computer")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Take the wheel" }));
      expect(codex.sent).toContainEqual({ type: "take" });
      expect(socketFor("steward")?.sent.some((message) => message.type === "take")).toBe(false);
      // Its screen opens over the conversation, not this conversation's own computer.
      expect(await screen.findByRole("dialog", { name: "Codex's computer" })).toBeTruthy();
      expect(parent.showComputer).not.toHaveBeenCalled();
    });

    it("opens no connection for a task that was already finished", async () => {
      draw(MESSAGES);
      await screen.findByText("Codex worked on: run the tests");
      expect(socketFor("codex")).toBeUndefined();
    });

    it("lets go of that computer once the task is over, and connects again only to show it", async () => {
      const opening = {
        id: "c6",
        role: "assistant",
        content: "",
        subagentRunId: SUB,
        toolCalls: [
          {
            id: "codex-x:open",
            type: "function",
            function: { name: "browser_navigate", arguments: '{"url":"https://example.com"}' },
          },
        ],
      };
      const opened_ = {
        id: "c7",
        role: "tool",
        toolCallId: "codex-x:open",
        content: '{"ok":true,"data":{"title":"Example"}}',
        subagentRunId: SUB,
      };
      const working = [...MESSAGES.slice(0, 2), opening] as unknown as Message[];
      const finished = [...working, opened_, ...MESSAGES.slice(-2)] as unknown as Message[];
      // The task ends while the page watches, as a history replay also draws it: call, then answer.
      renderWithProviders(
        <ChatActionsContext.Provider value={parent}>
          <ComputerSession agentId="steward">
            <Swappable initial={working} />
          </ComputerSession>
        </ChatActionsContext.Provider>,
      );
      await screen.findByText("Codex is working on: run the tests");
      const details = document.querySelector("details") as HTMLDetailsElement;
      details.open = true;
      const first = socketFor("codex")!;
      expect(first.closed).toBe(false);

      act(() => swap.set(finished));
      await screen.findByText("Codex worked on: run the tests");
      expect(first.closed).toBe(true);
      // Nothing was drawn afresh: the card the person opened is the same, and still open.
      expect(document.querySelector("details")).toBe(details);
      expect(details.open).toBe(true);

      fireEvent.click(within(details).getByRole("button", { name: "See screen" }));
      expect(await screen.findByRole("dialog", { name: "Codex's computer" })).toBeTruthy();
      const codex = opened.filter((socket) => socket.url.endsWith("/ws/computer/codex"));
      expect(codex).toHaveLength(2);
      expect(codex[1]?.closed).toBe(false);
    });
  });

  it("reads which agent asks from an interrupt", () => {
    expect(
      askedByOf({ id: "i", reason: "steward_approval", metadata: { askedBy: { name: "Codex" } } } as never),
    ).toBe("Codex");
    expect(askedByOf({ id: "i", reason: "steward_approval", metadata: {} } as never)).toBeUndefined();
  });
});
