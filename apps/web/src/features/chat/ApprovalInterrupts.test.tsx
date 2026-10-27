import type { Approval, LiveEvent } from "@steward/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { live } from "@/lib/live.ts";
import { ApprovalInterrupts, answerOf } from "./ApprovalInterrupts.tsx";

/** What the interrupt hook hands to `render`: the open interrupts and the resume calls. */
const interruptState = vi.hoisted(() => ({
  interrupts: [] as { id: string; reason: string; toolCallId?: string; metadata?: Record<string, unknown> }[],
  resolve: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  /** The approval each id loads as. */
  approvals: new Map<string, unknown>(),
}));

// CopilotKit's `useInterrupt`, reduced to what this component relies on: it renders the open
// interrupts with `resolve` and `cancel`, honouring `enabled`.
vi.mock("@copilotkit/react-core/v2", () => ({
  useInterrupt: (config: {
    enabled?: (event: { name: string; value: unknown }) => boolean;
    render: (props: unknown) => unknown;
  }) => {
    const [first] = interruptState.interrupts;
    if (!first) return null;
    if (config.enabled && !config.enabled({ name: "on_interrupt", value: first })) return null;
    return config.render({
      interrupt: first,
      interrupts: interruptState.interrupts,
      resolve: interruptState.resolve,
      cancel: interruptState.cancel,
    });
  },
}));

vi.mock("@/lib/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api.ts")>()),
  useApproval: (id: string) => ({ data: interruptState.approvals.get(id) }),
}));

// The shell's card, reduced to its answers.
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
        Allow once
      </button>
      <button
        type="button"
        onClick={() => onDecided?.({ id: approvalId, status: "allowed", answer: "always" })}
      >
        Always allow
      </button>
      <button
        type="button"
        onClick={() => onDecided?.({ id: approvalId, status: "refused", answer: "refuse" })}
      >
        Refuse
      </button>
    </div>
  ),
}));

const approval = (id: string, patch: Partial<Approval>): Approval =>
  ({ id, status: "pending", ...patch }) as Approval;

function open(...ids: string[]) {
  interruptState.interrupts = ids.map((id) => ({
    id: `call_${id}`,
    toolCallId: `call_${id}`,
    reason: "steward_approval",
    metadata: { approvalId: id },
  }));
}

beforeEach(() => {
  interruptState.interrupts = [];
  interruptState.approvals.clear();
  interruptState.resolve.mockClear();
  interruptState.cancel.mockClear();
});

afterEach(cleanup);

describe("answerOf", () => {
  it("reads the answer an approval ended with", () => {
    expect(answerOf({ status: "pending" })).toBeUndefined();
    expect(answerOf({ status: "allowed", answer: "once" })).toBe("once");
    expect(answerOf({ status: "allowed", answer: "always" })).toBe("always");
    expect(answerOf({ status: "refused", answer: "refuse" })).toBe("refuse");
    expect(answerOf({ status: "expired" })).toBe("refuse");
  });
});

describe("ApprovalInterrupts", () => {
  it("shows one card per open approval and reports the waiting calls", () => {
    open("apr_1", "apr_2");
    const onPending = vi.fn();
    render(<ApprovalInterrupts agentId="thread:t1" onPending={onPending} />);
    expect(screen.getByText("Approval apr_1")).toBeTruthy();
    expect(screen.getByText("Approval apr_2")).toBeTruthy();
    expect(onPending).toHaveBeenLastCalledWith([
      { toolCallId: "call_apr_1", approvalId: "apr_1" },
      { toolCallId: "call_apr_2", approvalId: "apr_2" },
    ]);
  });

  it("reports nothing waiting when there is no interrupt, and ignores other kinds", () => {
    interruptState.interrupts = [{ id: "x", reason: "tool_call" }];
    const onPending = vi.fn();
    const { container } = render(<ApprovalInterrupts agentId="thread:t1" onPending={onPending} />);
    expect(container.textContent).toBe("");
    expect(onPending).toHaveBeenLastCalledWith([]);
  });

  it("resumes with the answer, and cancels on a refusal", () => {
    open("apr_1");
    render(<ApprovalInterrupts agentId="thread:t1" onPending={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(interruptState.resolve).toHaveBeenCalledWith({ answer: "always" }, "call_apr_1");
    cleanup();

    open("apr_2");
    render(<ApprovalInterrupts agentId="thread:t1" onPending={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    expect(interruptState.cancel).toHaveBeenCalledWith("call_apr_2");
  });

  it("carries on when the approval is decided somewhere else, once however many times it hears", () => {
    open("apr_1");
    render(<ApprovalInterrupts agentId="thread:t1" onPending={() => {}} />);
    const decided: LiveEvent = {
      type: "approval.decided",
      approval: approval("apr_1", { status: "allowed", answer: "once" }),
    };
    act(() => live.dispatch(decided));
    act(() => live.dispatch(decided));
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(interruptState.resolve).toHaveBeenCalledTimes(1);
    expect(interruptState.resolve).toHaveBeenCalledWith({ answer: "once" }, "call_apr_1");
  });

  it("ignores decisions about other approvals", () => {
    open("apr_1");
    render(<ApprovalInterrupts agentId="thread:t1" onPending={() => {}} />);
    act(() =>
      live.dispatch({ type: "approval.decided", approval: approval("apr_9", { status: "refused" }) }),
    );
    expect(interruptState.resolve).not.toHaveBeenCalled();
    expect(interruptState.cancel).not.toHaveBeenCalled();
  });

  it("settles at once when the approval it loads was already answered or expired", () => {
    interruptState.approvals.set("apr_1", approval("apr_1", { status: "expired" }));
    open("apr_1");
    render(<ApprovalInterrupts agentId="thread:t1" onPending={() => {}} />);
    expect(interruptState.cancel).toHaveBeenCalledWith("call_apr_1");
  });
});
