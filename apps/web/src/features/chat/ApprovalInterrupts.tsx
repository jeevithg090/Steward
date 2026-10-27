/**
 * Approvals inside a conversation.
 *
 * When the gateway parks a call, the run ends with an AG-UI interrupt (`reason: steward_approval`,
 * `metadata.approvalId`). Each open interrupt draws the shell's `ApprovalCard`. The card posts the
 * answer to the server; this then resumes the run: `cancel` for a refusal, `resolve({ answer })`
 * otherwise. The server trusts its own record of the answer, never the resume payload.
 *
 * The same approval can be answered somewhere else (the Tasks page, a notification). A live
 * `approval.decided` event, or loading an approval that is already decided, settles the interrupt
 * here too, so the conversation never waits on a question that has been answered.
 */
import { type Interrupt, useInterrupt } from "@copilotkit/react-core/v2";
import { APPROVAL_INTERRUPT_REASON, type Approval, type ApprovalAnswer } from "@steward/shared";
import { useCallback, useEffect, useRef } from "react";
import { ApprovalCard } from "@/components/cards/ApprovalCard.tsx";
import { useApproval } from "@/lib/api.ts";
import { useLiveEvents } from "@/lib/live.ts";

/** Whether an interrupt is one of Steward's approvals. */
export function isStewardApproval(interrupt: unknown): interrupt is Interrupt {
  return (
    typeof interrupt === "object" &&
    interrupt !== null &&
    (interrupt as { reason?: unknown }).reason === APPROVAL_INTERRUPT_REASON
  );
}

export function approvalIdOf(interrupt: Interrupt): string | undefined {
  const id = (interrupt.metadata as { approvalId?: unknown } | undefined)?.approvalId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** The answer an approval ended with: what the person chose, or a refusal when it expired or was cancelled. */
export function answerOf(approval: Pick<Approval, "status" | "answer">): ApprovalAnswer | undefined {
  if (approval.status === "pending") return undefined;
  if (approval.status === "allowed") return approval.answer === "always" ? "always" : "once";
  return "refuse";
}

export interface PendingApproval {
  toolCallId: string;
  approvalId?: string;
}

/**
 * Renders the open approvals of one conversation and reports which calls are waiting. Mount it only
 * once the conversation's agent is registered (`useAgent` reports `isReady`), and before the thread
 * is connected, so a replayed interrupt is seen.
 */
export function ApprovalInterrupts({
  agentId,
  onPending,
}: {
  /** The local id of the conversation's agent (`thread:<id>`). */
  agentId: string;
  onPending: (pending: PendingApproval[]) => void;
}) {
  const element = useInterrupt({
    agentId,
    renderInChat: false,
    enabled: (event) => isStewardApproval(event.value),
    render: ({ interrupts, resolve, cancel }) => (
      <ApprovalStack
        interrupts={interrupts.filter(isStewardApproval)}
        onAnswer={(interrupt, answer) =>
          answer === "refuse" ? cancel(interrupt.id) : resolve({ answer }, interrupt.id)
        }
        onPending={onPending}
      />
    ),
  });

  // No element means nothing is waiting.
  const hasElement = element !== null;
  useEffect(() => {
    if (!hasElement) onPending([]);
  }, [hasElement, onPending]);

  return element;
}

function ApprovalStack({
  interrupts,
  onAnswer,
  onPending,
}: {
  interrupts: Interrupt[];
  onAnswer: (interrupt: Interrupt, answer: ApprovalAnswer) => Promise<unknown>;
  onPending: (pending: PendingApproval[]) => void;
}) {
  const key = interrupts.map((interrupt) => interrupt.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ids in `key` are what change.
  useEffect(() => {
    onPending(
      interrupts.map((interrupt) => ({
        toolCallId: interrupt.toolCallId ?? interrupt.id,
        approvalId: approvalIdOf(interrupt),
      })),
    );
  }, [key, onPending]);

  if (interrupts.length === 0) return null;
  return (
    <section aria-label="Steward is asking before it acts" className="flex flex-col gap-3">
      {interrupts.map((interrupt) => (
        <InterruptApproval key={interrupt.id} interrupt={interrupt} onAnswer={onAnswer} />
      ))}
    </section>
  );
}

function InterruptApproval({
  interrupt,
  onAnswer,
}: {
  interrupt: Interrupt;
  onAnswer: (interrupt: Interrupt, answer: ApprovalAnswer) => Promise<unknown>;
}) {
  const approvalId = approvalIdOf(interrupt);
  const settled = useRef(false);

  /** Resumes the run once, however many places report the answer. */
  const settle = useCallback(
    (answer: ApprovalAnswer | undefined) => {
      if (!answer || settled.current) return;
      settled.current = true;
      onAnswer(interrupt, answer).catch((error: unknown) => {
        settled.current = false;
        console.error("Couldn't carry on after the answer", error);
      });
    },
    [interrupt, onAnswer],
  );

  // Already decided when it loaded (answered elsewhere, claimed, expired): carry on with that outcome.
  const approval = useApproval(approvalId ?? "", undefined, { enabled: Boolean(approvalId) });
  const loaded = approval.data;
  useEffect(() => {
    if (loaded && loaded.status !== "pending") settle(answerOf(loaded));
  }, [loaded, settle]);

  // Decided somewhere else while this was on screen.
  useLiveEvents((event) => {
    if (event.type === "approval.decided" && event.approval.id === approvalId)
      settle(answerOf(event.approval));
  });

  if (!approvalId) {
    return (
      <div role="alert" className="rounded-card bg-needs-soft px-4 py-3 text-ink text-sub">
        {interrupt.message ?? "Steward is waiting for an answer it can't show here."} Answer it from Tasks.
      </div>
    );
  }

  return (
    <div data-approval-id={approvalId} tabIndex={-1} className="outline-none">
      <ApprovalCard
        approvalId={approvalId}
        headingLevel={3}
        onDecided={(decided) => settle(answerOf(decided))}
      />
    </div>
  );
}
