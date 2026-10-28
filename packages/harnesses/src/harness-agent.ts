import { timingSafeEqual } from "node:crypto";
import {
  AbstractAgent,
  type AgentConfig,
  type BaseEvent,
  EventType,
  type Interrupt,
  type Message,
  type ResumeEntry,
  type RunAgentInput,
  type RunFinishedEvent,
} from "@ag-ui/client";
import {
  APPROVAL_INTERRUPT_REASON,
  type ApprovalInterruptMetadata,
  type ApprovalStore,
  CUSTOM_EVENTS,
  type GateCall,
  type GateOutcome,
  type Governance,
  type HarnessProfile,
  type Initiator,
} from "@steward/shared";
import { Observable } from "rxjs";
import type { HarnessThread, HarnessThreads, ParkedPermission } from "./session.ts";
import type { HarnessPermission, PermissionAnswer } from "./types.ts";

export interface HarnessAgentDeps {
  /** The agent's id (also its computer's) and how it is named. */
  agentId: string;
  title: string;
  harness: HarnessProfile;
  threads: HarnessThreads;
  governance: Governance;
  /** To tell an Always allow from an Allow once when a parked call is resumed. */
  approvals?: Pick<ApprovalStore, "byToolCall">;
  /** `local` in single-user mode. */
  actorId: string;
  /** Random per boot. A run whose forwarded props carry it may name its initiator (routine, task, resume). */
  serverRunToken: string;
  onError?: (error: unknown, where: string) => void;
}

/** Said when the harness asked for something while the run was being stopped. */
export const STOPPED_BEFORE_FINISHING = "Stopped before it finished.";

const INITIATOR_KINDS: readonly Initiator["kind"][] = ["person", "routine", "task", "resume", "system"];
const RESUMED_RANK: readonly Initiator["kind"][] = ["routine", "task", "resume", "system"];
/** How long a stopped or superseded turn may take to wind down before its process is replaced. */
const CANCEL_WAIT_MS = 10_000;

type Emit = (event: BaseEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameToken(given: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The words of the person's latest message, which is what the harness is asked. */
export function latestUserText(messages: readonly Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message.content as unknown;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
              .join("\n")
          : "";
    return text.trim() || undefined;
  }
  return undefined;
}

/**
 * An external coding agent (Claude Code, Codex, Gemini CLI, …) as a Steward agent. It speaks AG-UI
 * like every other agent, so the runner keeps its conversation, the chat draws it and approvals use
 * the same interrupt card. The vendor's tool runs as its own process, one per conversation, in the
 * agent's workspace, and every permission it asks for is a `GateCall` decided by the gateway:
 *
 * - allowed: the harness is answered at once and goes on;
 * - refused: it is answered "no" and carries on without it;
 * - asked: the run ends with an interrupt while the harness's request stays open; the resume run
 *   answers it with what the person chose, and the same turn carries on.
 *
 * Stop cancels the turn and answers any open request `cancelled`. A new message while a request is
 * open counts as moving on: the request is cancelled and the new message starts a new turn.
 */
export class HarnessAgent extends AbstractAgent {
  private deps: HarnessAgentDeps;
  private stopController: AbortController | undefined;

  constructor(deps: HarnessAgentDeps, config?: AgentConfig) {
    super({ agentId: deps.agentId, description: deps.title, ...config });
    this.deps = deps;
  }

  override clone(): HarnessAgent {
    const copy = super.clone() as HarnessAgent;
    copy.deps = this.deps;
    copy.stopController = undefined;
    return copy;
  }

  override abortRun(): void {
    this.stopController?.abort();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((out) => {
      const controller = new AbortController();
      this.stopController = controller;
      let ended = false;
      const emit: Emit = (event) => {
        if (out.closed || ended) return;
        if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) ended = true;
        out.next(event);
      };
      this.work(input, emit, controller.signal)
        .catch((error: unknown) => {
          this.report(error, "run");
          emit({
            type: EventType.RUN_ERROR,
            code: "STEWARD_HARNESS_ERROR",
            message: `${this.deps.harness.name} could not go on: ${error instanceof Error ? error.message : String(error)}`,
          } as BaseEvent);
        })
        .finally(() => {
          if (!ended) emit(this.finished(input));
          if (!out.closed) out.complete();
        });
      return () => controller.abort();
    });
  }

  private async work(input: RunAgentInput, emit: Emit, signal: AbortSignal): Promise<void> {
    const { harness } = this.deps;
    emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);

    const resumeEntries = input.resume ?? [];
    const running = this.deps.threads.running(input.threadId);
    const initiator = this.resumedInitiator(this.initiatorOf(input), resumeEntries, input.threadId);

    // Answers for requests no process holds any more (it stopped, or Steward restarted): the
    // approval is closed, so nothing acts and the sweep does not retry, and the person is told.
    const stale = resumeEntries.filter((entry) => !running?.parked.has(entry.interruptId));
    let thread: HarnessThread;
    let notice: string | undefined;
    try {
      ({ thread, notice } = await this.deps.threads.thread(input.threadId));
    } catch (error) {
      emit({
        type: EventType.RUN_ERROR,
        code: "STEWARD_HARNESS_UNAVAILABLE",
        message: error instanceof Error ? error.message : `${harness.name} could not be started.`,
      } as BaseEvent);
      return;
    }
    thread.stream.attach(emit);
    if (notice) thread.stream.say(notice);

    if (stale.length > 0) {
      for (const entry of stale) await this.closeStale(entry, input, initiator);
      thread.stream.say(
        `${harness.name} stopped while it waited for your answer, so nothing was done. Ask again if it is still needed.`,
      );
    }

    const resume = resumeEntries.filter((entry) => thread.parked.has(entry.interruptId));
    if (resume.length > 0) {
      for (const entry of resume) await this.answerParked(thread, entry);
    } else if (stale.length === 0) {
      // A new message. Whatever the previous turn still waits on, the person moved on from it.
      if (thread.busy || thread.parked.size > 0) {
        for (const parked of [...thread.parked.values()]) await this.moveOn(parked);
        await thread.cancelTurn();
        if (!(await thread.drainTurn(CANCEL_WAIT_MS))) {
          await this.deps.threads.close(input.threadId);
          ({ thread } = await this.deps.threads.thread(input.threadId));
          thread.stream.attach(emit);
        }
        thread.stream.close(STOPPED_BEFORE_FINISHING);
      }
      const text = latestUserText(input.messages);
      if (!text) {
        thread.stream.close();
        emit(this.finished(input));
        return;
      }
      thread.startTurn(text);
    }
    if (!thread.busy && thread.parked.size === 0) {
      thread.stream.close();
      emit(this.finished(input));
      return;
    }

    await this.follow(thread, input, emit, signal, initiator);
  }

  /** Reads the turn until it ends, parks, fails, or the run is stopped. */
  private async follow(
    thread: HarnessThread,
    input: RunAgentInput,
    emit: Emit,
    signal: AbortSignal,
    initiator: Initiator,
  ): Promise<void> {
    const { stream } = thread;
    for (;;) {
      const event = await thread.next(signal);
      if (!event) {
        if (signal.aborted) return this.stop(thread, input, emit);
        stream.close(STOPPED_BEFORE_FINISHING);
        emit({
          type: EventType.RUN_ERROR,
          code: "STEWARD_HARNESS_STOPPED",
          message: `${this.deps.harness.name} stopped.`,
        } as BaseEvent);
        return;
      }
      switch (event.type) {
        case "update":
          stream.apply(event.update);
          break;
        case "permission": {
          if (signal.aborted) {
            event.answer("cancelled");
            return this.stop(thread, input, emit);
          }
          const parked = await this.gate(thread, event.request, event.answer, input, initiator);
          if (parked) {
            if (signal.aborted) {
              await this.moveOn(parked);
              return this.stop(thread, input, emit);
            }
            stream.close();
            this.interrupt(parked, input, emit);
            return;
          }
          break;
        }
        case "end": {
          const { end } = event;
          if (end.stopReason === "error") {
            stream.close(STOPPED_BEFORE_FINISHING);
            emit({
              type: EventType.RUN_ERROR,
              code: "STEWARD_HARNESS_ERROR",
              message: end.error ?? `${this.deps.harness.name} could not finish.`,
            } as BaseEvent);
            return;
          }
          if (end.stopReason === "refusal") stream.say(`${this.deps.harness.name} declined to do this.`);
          stream.close(end.stopReason === "cancelled" ? STOPPED_BEFORE_FINISHING : undefined);
          const finished = end.stopReason === "cancelled" ? this.cancelled(input) : this.finished(input);
          emit({
            ...finished,
            ...(end.usage && end.usage.length > 0 ? { usage: end.usage } : {}),
          } as BaseEvent);
          return;
        }
        case "exited":
          stream.close(STOPPED_BEFORE_FINISHING);
          emit({
            type: EventType.RUN_ERROR,
            code: "STEWARD_HARNESS_STOPPED",
            message: event.reason,
          } as BaseEvent);
          return;
      }
    }
  }

  /**
   * One permission through the gateway. Returns the parked request when the person must answer;
   * otherwise the harness has already been answered.
   */
  private async gate(
    thread: HarnessThread,
    request: HarnessPermission,
    answer: (answer: PermissionAnswer) => void,
    input: RunAgentInput,
    initiator: Initiator,
  ): Promise<ParkedPermission | undefined> {
    const call = this.gateCall(thread, request, input, initiator);
    // The card belongs to a call in the conversation, and the sweep finds the parked call there.
    thread.stream.toolCall(request.callId, request.toolName, request.args);
    let outcome: GateOutcome<unknown>;
    try {
      outcome = await this.deps.governance.execute(call, async () => {
        answer("allow_once");
        return { answered: "allow_once" };
      });
    } catch (error) {
      this.report(error, "gateway");
      answer("reject");
      return undefined;
    }
    if (outcome.status === "parked") {
      const parked: ParkedPermission = { call, request, answer, parkedAt: Date.now(), outcome };
      thread.parked.set(call.toolCallId, parked);
      return parked;
    }
    if (outcome.status !== "done") answer("reject");
    return undefined;
  }

  /** The resume run: answers the parked request with what the person chose, through the gateway. */
  private async answerParked(thread: HarnessThread, entry: ResumeEntry): Promise<void> {
    const parked = thread.parked.get(entry.interruptId);
    if (!parked) return;
    thread.parked.delete(entry.interruptId);
    const approval = this.deps.approvals?.byToolCall(parked.call.toolCallId);
    const always = approval?.answer === "always" && approval.canAlways && parked.request.offersAlways;
    const allow: PermissionAnswer = always ? "allow_always" : "allow_once";
    let answered = false;
    try {
      const outcome = await this.deps.governance.resume(parked.call, async () => {
        if (entry.status === "cancelled") throw new Error("The person cancelled this request.");
        answered = true;
        parked.answer(allow);
        return { answered: allow };
      });
      if (outcome.status !== "done" && !answered) parked.answer("reject");
    } catch (error) {
      this.report(error, "gateway");
      if (!answered) parked.answer("reject");
    }
  }

  /** The person moved on (a new message) or stopped the run: the approval closes and the request is cancelled. */
  private async moveOn(parked: ParkedPermission): Promise<void> {
    try {
      await this.deps.governance.resume(parked.call, () => Promise.reject(new Error("moved on")));
    } catch (error) {
      this.report(error, "gateway");
    }
    parked.answer("cancelled");
  }

  /** Closes an approval whose harness request is gone, so it can never act. */
  private async closeStale(entry: ResumeEntry, input: RunAgentInput, initiator: Initiator): Promise<void> {
    const call: GateCall = {
      toolCallId: entry.interruptId,
      runId: input.runId,
      threadId: input.threadId,
      agentId: this.deps.agentId,
      actorId: this.deps.actorId,
      initiator,
      tool: {
        name: "harness_request",
        kind: "write",
        surface: "system",
        source: `harness:${this.deps.harness.id}`,
      },
      args: {},
      target: {},
      tainted: true,
    };
    try {
      await this.deps.governance.resume(call, () =>
        Promise.reject(new Error("The harness request is gone.")),
      );
    } catch (error) {
      this.report(error, "gateway");
    }
  }

  private gateCall(
    thread: HarnessThread,
    request: HarnessPermission,
    input: RunAgentInput,
    initiator: Initiator,
  ): GateCall {
    return {
      toolCallId: thread.stream.idOf(request.callId),
      runId: input.runId,
      threadId: input.threadId,
      agentId: this.deps.agentId,
      actorId: this.deps.actorId,
      initiator,
      tool: {
        name: request.toolName,
        kind: request.kind,
        surface: request.surface,
        source: `harness:${this.deps.harness.id}`,
      },
      args: request.args,
      target: request.target,
      // Whatever a coding agent read on its own (files, pages, tool output) Steward never saw.
      tainted: true,
    };
  }

  /** Ends the run waiting on the person, exactly as Steward's own agent does. */
  private interrupt(parked: ParkedPermission, input: RunAgentInput, emit: Emit): void {
    const { approval, decision } = parked.outcome;
    emit({ type: EventType.CUSTOM, name: CUSTOM_EVENTS.approvalRequested, value: { approval } } as BaseEvent);
    const metadata: ApprovalInterruptMetadata = {
      approvalId: approval.id,
      summary: approval.summary,
      tool: approval.tool,
      args: approval.args,
      findings: decision.findings,
      canAlways: approval.canAlways,
      ...(decision.rule ? { rule: decision.rule } : {}),
    };
    const interrupts: Interrupt[] = [
      {
        id: parked.call.toolCallId,
        toolCallId: parked.call.toolCallId,
        reason: APPROVAL_INTERRUPT_REASON,
        message: approval.summary,
        ...(approval.expiresAt ? { expiresAt: approval.expiresAt } : {}),
        metadata: metadata as unknown as Interrupt["metadata"],
      },
    ];
    emit({ ...this.finished(input), outcome: { type: "interrupt", interrupts } } as BaseEvent);
  }

  /** Stop: the turn is cancelled, open requests are answered `cancelled`, and the run ends cancelled. */
  private async stop(thread: HarnessThread, input: RunAgentInput, emit: Emit): Promise<void> {
    for (const parked of [...thread.parked.values()]) await this.moveOn(parked);
    await thread.cancelTurn();
    const settled = await thread.drainTurn(CANCEL_WAIT_MS);
    if (!settled) await this.deps.threads.close(input.threadId);
    thread.stream.close(STOPPED_BEFORE_FINISHING);
    emit(this.cancelled(input));
  }

  private initiatorOf(input: RunAgentInput): Initiator {
    const props = isRecord(input.forwardedProps) ? input.forwardedProps.steward : undefined;
    if (
      isRecord(props) &&
      typeof props.token === "string" &&
      sameToken(props.token, this.deps.serverRunToken)
    ) {
      const claimed = props.initiator;
      if (
        isRecord(claimed) &&
        typeof claimed.id === "string" &&
        INITIATOR_KINDS.includes(claimed.kind as Initiator["kind"])
      ) {
        return { kind: claimed.kind as Initiator["kind"], id: claimed.id };
      }
    }
    return { kind: "person", id: this.deps.actorId };
  }

  /** A browser resuming a routine's parked call keeps the routine's (stricter) rules for the rest of the turn. */
  private resumedInitiator(
    initiator: Initiator,
    resume: readonly ResumeEntry[],
    threadId: string,
  ): Initiator {
    if (initiator.kind !== "person") return initiator;
    let strictest: Initiator | undefined;
    for (const entry of resume) {
      const stored = this.deps.governance.initiatorFor(entry.interruptId, threadId);
      const rank = stored ? RESUMED_RANK.indexOf(stored.kind) : -1;
      if (!stored || rank < 0) continue;
      if (!strictest || rank < RESUMED_RANK.indexOf(strictest.kind)) strictest = stored;
    }
    return strictest ? { kind: strictest.kind, id: strictest.id } : initiator;
  }

  private finished(input: RunAgentInput): RunFinishedEvent {
    return { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as RunFinishedEvent;
  }

  private cancelled(input: RunAgentInput): RunFinishedEvent {
    return {
      ...this.finished(input),
      ...(input.protocolVersion !== undefined ? { outcome: { type: "cancelled" } } : {}),
    } as RunFinishedEvent;
  }

  private report(error: unknown, where: string): void {
    try {
      if (this.deps.onError) this.deps.onError(error, where);
      else console.error(`[steward/harness] ${where}:`, error instanceof Error ? error.message : error);
    } catch {
      // Reporting must never break a run.
    }
  }
}
