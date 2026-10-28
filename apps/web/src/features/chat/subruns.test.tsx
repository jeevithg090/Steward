import type { Message } from "@copilotkit/react-core/v2";
import { cleanup, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { askedByOf } from "./ApprovalInterrupts.tsx";
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

  it("reads which agent asks from an interrupt", () => {
    expect(
      askedByOf({ id: "i", reason: "steward_approval", metadata: { askedBy: { name: "Codex" } } } as never),
    ).toBe("Codex");
    expect(askedByOf({ id: "i", reason: "steward_approval", metadata: {} } as never)).toBeUndefined();
  });
});
