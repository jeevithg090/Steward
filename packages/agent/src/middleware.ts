// Adapted from openbot/toolkit/src/headless-tools.ts (MIT, CopilotKit)
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  AbstractAgent,
  aggregateTokenUsage,
  type BaseEvent,
  type Context,
  EventType,
  type Interrupt,
  type Message,
  Middleware,
  type ResumeEntry,
  type RunAgentInput,
  type RunFinishedEvent,
  type TokenUsage,
  type ToolCall,
} from "@ag-ui/client";
import {
  APPROVAL_INTERRUPT_REASON,
  type ApprovalInterruptMetadata,
  CUSTOM_EVENTS,
  type GateCall,
  type GateOutcome,
  type Governance,
  type Initiator,
  isBuiltinTool,
  MCP_TOOL_PREFIX,
  parseMcpToolName,
  TOOLS,
  type ToolResultEnvelope,
} from "@steward/shared";
import { Observable, type Subscription } from "rxjs";
import { answeredIds, callsIn, findCall, isTainted, sanitizeHistory } from "./history.ts";
import { BUILTIN_TOOLS, toAgUiTool } from "./tools/catalogue.ts";
import { ArgumentError } from "./tools/schema.ts";
import type { GateFacts, StewardTool, ToolArgs, ToolContext, ToolServices } from "./tools/types.ts";
import { wrapUntrusted } from "./tools/untrusted.ts";

/** What the model reads when the person cancelled an approval instead of answering it. */
export const CANCELLED_BY_PERSON =
  "The person cancelled this request instead of allowing it, so it was not done. This was their decision. Do not try it, or anything equivalent, again unless they ask in words; tell them it was not done.";

/** What the model reads when the gateway itself could not decide. Fail closed: nothing happened. */
export const GATE_UNAVAILABLE = "Steward could not check this action, so it was not done.";

/** What the person reads when a resume cannot tell whose run it continues. Nothing was done. */
export const INITIATOR_UNKNOWN =
  "Steward could not check who started this run, so it stopped before doing anything.";

/** What the model reads for a call it was still writing when the run was stopped. It never ran. */
export const STOPPED = "Stopped.";

/** The assistant's last words when a run hits the step limit. */
export const TOO_MANY_STEPS =
  "I stopped here: this took more steps than I take in one go. Ask me to carry on if you want me to continue.";

const BAD_JSON = "The arguments were not a JSON object. Call the tool again with valid arguments.";

/** Results longer than this are cut before the model sees them. */
const MAX_RESULT_CHARS = 120_000;

const INITIATOR_KINDS: readonly Initiator["kind"][] = ["person", "routine", "task", "resume", "system"];

/** Who a resumed run belongs to, strictest first: routines have the most rules against them. */
const RESUMED_RANK: readonly Initiator["kind"][] = ["routine", "task", "resume", "system"];

/**
 * The stop button. `StewardAgent` registers each run's input here with a signal it aborts from
 * `abortRun()`, because a stop must also reach a tool that is running between model calls, when
 * there is no model stream to abort.
 */
const stopSignals = new WeakMap<object, AbortSignal>();

export function linkStopSignal(input: RunAgentInput, signal: AbortSignal): void {
  stopSignals.set(input, signal);
}

export interface GovernedToolsOptions {
  /** The agent profile id, as the gateway and the computer know it. */
  agentId: string;
  actorId: string;
  /** Random per boot. Only the server can prove a run is a routine's, a task's or a resume sweep's. */
  serverRunToken: string;
  governance: Governance;
  services: ToolServices;
  /** The tools for one run. Called once per run, so MCP grants take effect without a restart. */
  tools: () => StewardTool[];
  /** Extra AG-UI context entries for one run: the date, memory, the skill called, and so on. */
  context?: (messages: Message[], initiator: Initiator) => Context[];
  /** How many model calls one run may make. */
  maxSegments?: number;
  /** Where unexpected errors go. They never escape the run. */
  onError?: (error: unknown, where: string) => void;
}

type Emit = (event: BaseEvent) => void;

interface Io {
  emit: Emit;
  signal: AbortSignal;
  track: (sub: Subscription) => void;
}

interface RunScope {
  input: RunAgentInput;
  initiator: Initiator;
  owned: Map<string, StewardTool>;
  io: Io;
}

type GateResult =
  | { content: string }
  | { parked: { call: ToolCall; outcome: Extract<GateOutcome<unknown>, { status: "parked" }> } };

/** Seeds each inner run with that segment's history, so `runNextWithState` accumulates from the right place. */
class Seed extends AbstractAgent {
  constructor(
    private readonly inner: AbstractAgent,
    input: RunAgentInput,
  ) {
    super({ initialMessages: input.messages, initialState: input.state });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return this.inner.run(input);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Anything shaped like a key or token: provider prefixes, and long unbroken runs of key characters. */
const KEY_SHAPED = /\b(?:sk|rk|pk|nvapi|gsk|xai|hf|AIza)[-_][\w\-.*]{6,}|\b[\w-]{32,}\b/g;

/**
 * What the person reads when the model fails, in plain words. The provider's own words are kept for
 * the cases the patterns do not cover, with anything shaped like a key hidden: some providers echo
 * part of the key back, and this message is kept in the conversation.
 */
export function modelErrorMessage(raw: string): string {
  const text = raw.trim();
  if (
    /\b401\b|unauthori[sz]ed|invalid.{0,20}(api[ _-]?key|token)|incorrect api key|no auth|authentication/i.test(
      text,
    )
  ) {
    return "The model provider did not accept the key. Check it in Settings, then try again.";
  }
  if (/\b402\b|insufficient (credit|funds|balance)|out of credits?|quota|billing/i.test(text)) {
    return "The model provider says the account is out of credit. Check your account with them, then try again.";
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) {
    return "The model provider is busy right now. Wait a moment, then try again.";
  }
  if (
    /model.{0,80}(not found|does not exist|is not a valid|unknown)|no such model|\bunknown model\b/i.test(
      text,
    )
  ) {
    return "The model provider does not know that model. Check the model name in Settings.";
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|cannot connect|connect timeout/i.test(text)) {
    return "Steward could not reach the model. Check that it is running and that its address is right.";
  }
  const safe = text.replace(KEY_SHAPED, "[hidden]").slice(0, 300);
  return safe ? `The model could not answer: ${safe}` : "The model could not answer.";
}

function sameToken(given: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The one way Steward's tools run. Every tool is offered to the model as a client-style AG-UI tool
 * with no executor, so the model's run stops at each call. This middleware then builds the call as
 * the gateway sees it, hands it to `governance.execute`, turns the outcome into the tool result the
 * model reads, and runs the model again. When the gateway parks a call for the person, the run ends
 * with an AG-UI interrupt; the resume run calls `governance.resume`, which trusts the database, never
 * the browser's payload.
 *
 * One instance serves every clone and every run, so all per-run state lives inside `run()`.
 */
export class GovernedToolsMiddleware extends Middleware {
  private readonly maxSegments: number;

  constructor(private readonly opts: GovernedToolsOptions) {
    super();
    this.maxSegments = Math.max(1, opts.maxSegments ?? 24);
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    return new Observable<BaseEvent>((out) => {
      const controller = new AbortController();
      const stop = stopSignals.get(input);
      const onStop = () => controller.abort();
      if (stop?.aborted) controller.abort();
      else stop?.addEventListener("abort", onStop, { once: true });

      let inner: Subscription | undefined;
      let ended = false;
      const emit: Emit = (event) => {
        if (out.closed || ended) return;
        if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) ended = true;
        out.next(event);
      };
      const io: Io = { emit, signal: controller.signal, track: (sub) => (inner = sub) };

      this.work(input, next, io)
        .catch((error: unknown) => {
          this.report(error, "run");
          emit({
            type: EventType.RUN_ERROR,
            code: "STEWARD_AGENT_ERROR",
            message: errorMessage(error),
          } as BaseEvent);
        })
        .finally(() => {
          if (!ended) emit(this.finished(input));
          if (!out.closed) out.complete();
        });

      return () => {
        stop?.removeEventListener("abort", onStop);
        controller.abort();
        inner?.unsubscribe();
      };
    });
  }

  private async work(input: RunAgentInput, next: AbstractAgent, io: Io): Promise<void> {
    const { emit, signal } = io;
    emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);

    // Every model call's token usage, so the run ends with the whole run's count (per provider and model).
    const usage: TokenUsage[] = [];
    const finish = (event: RunFinishedEvent) => emit(withUsage(event, usage));

    let messages: Message[] = [...input.messages];
    const resume = (input.resume ?? []).filter(
      (entry) => findCall(messages, entry.interruptId) !== undefined,
    );
    const initiator = this.resumedInitiator(this.initiatorOf(input), resume, input.threadId);
    const tools = this.toolsForRun();
    const owned = new Map(tools.map((t) => [t.name, t]));
    const scope: RunScope = { input, initiator, owned, io };

    // 1. Resume: the person answered an approval. The database decides, not the payload.
    const answered = answeredIds(messages);
    if (resume.length > 0 && resume.every((entry) => answered.has(entry.interruptId))) {
      finish(this.finished(input));
      return;
    }
    const parkedAgain: Extract<GateResult, { parked: unknown }>["parked"][] = [];
    for (const entry of resume) {
      if (answered.has(entry.interruptId) || signal.aborted) continue;
      const call = findCall(messages, entry.interruptId);
      if (!call) continue;
      const tool = owned.get(call.function.name) ?? withdrawnTool(call.function.name);
      if (!tool) {
        messages = this.answer(messages, call.id, JSON.stringify(foreignResumeValue(entry)), emit);
        continue;
      }
      const result = await this.gate(call, tool, messages, scope, {
        resume: true,
        cancelled: entry.status === "cancelled",
      });
      if ("parked" in result) parkedAgain.push(result.parked);
      else messages = this.answer(messages, call.id, result.content, emit);
    }
    if (parkedAgain.length > 0) {
      this.interrupt(parkedAgain, this.finished(input), { emit, finish });
      return;
    }
    if (signal.aborted) {
      finish(this.cancelled(input));
      return;
    }

    // 2. The model and its tools, until the model answers in words, a call is parked, or the limit.
    const context = [...input.context, ...this.contextFor(messages, initiator)];
    const offered = [...input.tools.filter((t) => !owned.has(t.name)), ...tools.map(toAgUiTool)];
    const forwardedProps = withoutStewardProps(input.forwardedProps);
    let state = input.state;
    let lastFinish = this.finished(input);

    for (let segment = 0; segment < this.maxSegments; segment++) {
      if (signal.aborted) {
        finish(this.cancelled(input));
        return;
      }
      const request: RunAgentInput = {
        ...input,
        messages: sanitizeHistory(messages),
        state,
        context,
        tools: offered,
        forwardedProps,
        resume: undefined,
      };
      const before = new Set(callsIn(request.messages).map((c) => c.id));
      const seg = await this.runSegment(request, next, io);
      if (seg.failed) return;
      messages = mergeHistory(messages, request.messages, seg.messages);
      state = seg.state;
      if (seg.terminal?.usage) usage.push(...seg.terminal.usage);
      if (!seg.terminal || seg.terminal.outcome?.type === "cancelled" || signal.aborted) {
        // A stop while the model was still writing a call's arguments leaves that call open, and
        // AG-UI refuses to finish a run with open calls. Close each one as stopped: it never ran.
        for (const id of seg.openCalls) {
          emit({ type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent);
          this.answer(messages, id, serialise({ ok: false, error: STOPPED }), emit);
        }
        finish(seg.terminal ?? this.cancelled(input));
        return;
      }
      lastFinish = seg.terminal;

      const done = answeredIds(messages);
      const fresh = callsIn(seg.messages).filter((c) => !before.has(c.id));
      const pending = fresh.filter((c) => !done.has(c.id));
      const mine = pending.filter((c) => owned.has(c.function.name));

      if (mine.length === 0) {
        // Calls the model run answered itself (bad arguments, an unknown tool name) get another
        // model turn, so the model can see the error and recover instead of going quiet.
        const answeredInside = fresh.length > 0 && pending.length === 0;
        if (answeredInside && segment + 1 < this.maxSegments) continue;
        finish(seg.terminal);
        return;
      }

      const parked: Extract<GateResult, { parked: unknown }>["parked"][] = [];
      for (const call of mine) {
        if (signal.aborted) break;
        const tool = owned.get(call.function.name);
        if (!tool) continue;
        const result = await this.gate(call, tool, messages, scope, { resume: false, cancelled: false });
        if ("parked" in result) parked.push(result.parked);
        else messages = this.answer(messages, call.id, result.content, emit);
      }
      if (parked.length > 0) {
        this.interrupt(parked, seg.terminal, { emit, finish });
        return;
      }
      if (signal.aborted) {
        finish(this.cancelled(input));
        return;
      }
      // The browser still owes results for tools it offered itself; it continues the run.
      if (mine.length !== pending.length) {
        finish(seg.terminal);
        return;
      }
    }

    const messageId = randomUUID();
    emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
    emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: TOO_MANY_STEPS } as BaseEvent);
    emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    finish(lastFinish);
  }

  /**
   * One model call. Forwards its events, holds back its RUN_STARTED and RUN_FINISHED, and notes the
   * tool calls it started but never ended (a stop mid-arguments), so the run can close them.
   */
  private runSegment(
    request: RunAgentInput,
    next: AbstractAgent,
    io: Io,
  ): Promise<{
    messages: Message[];
    state: unknown;
    terminal?: RunFinishedEvent;
    failed: boolean;
    openCalls: Set<string>;
  }> {
    return new Promise((resolve) => {
      let messages = request.messages;
      let state: unknown = request.state;
      let terminal: RunFinishedEvent | undefined;
      let failed = false;
      const openCalls = new Set<string>();
      const settle = () => resolve({ messages, state, terminal, failed, openCalls });
      try {
        const sub = this.runNextWithState(request, new Seed(next, request)).subscribe({
          next: ({ event, messages: updated, state: updatedState }) => {
            messages = updated;
            state = updatedState;
            if (event.type === EventType.TOOL_CALL_START || event.type === EventType.TOOL_CALL_END) {
              const id = (event as { toolCallId?: unknown }).toolCallId;
              if (typeof id === "string") {
                if (event.type === EventType.TOOL_CALL_START) openCalls.add(id);
                else openCalls.delete(id);
              }
            }
            if (event.type === EventType.RUN_STARTED) return;
            if (event.type === EventType.RUN_FINISHED) {
              terminal = event as RunFinishedEvent;
              return;
            }
            if (event.type === EventType.RUN_ERROR) {
              failed = true;
              const raw = (event as { message?: unknown }).message;
              io.emit({
                ...event,
                message: modelErrorMessage(typeof raw === "string" ? raw : ""),
              } as BaseEvent);
              return;
            }
            io.emit(event);
          },
          error: (error: unknown) => {
            if (!failed) {
              failed = true;
              this.report(error, "model");
              io.emit({
                type: EventType.RUN_ERROR,
                code: "STEWARD_MODEL_ERROR",
                message: modelErrorMessage(errorMessage(error)),
              } as BaseEvent);
            }
            settle();
          },
          complete: settle,
        });
        io.track(sub);
      } catch (error) {
        failed = true;
        this.report(error, "model");
        io.emit({
          type: EventType.RUN_ERROR,
          code: "STEWARD_MODEL_ERROR",
          message: modelErrorMessage(errorMessage(error)),
        } as BaseEvent);
        settle();
      }
    });
  }

  /** Builds the call as the gateway sees it, lets the gateway decide and act, and returns what the model reads. */
  private async gate(
    call: ToolCall,
    tool: StewardTool,
    messages: Message[],
    scope: RunScope,
    mode: { resume: boolean; cancelled: boolean },
  ): Promise<GateResult> {
    const { input, initiator, io } = scope;
    // Malformed arguments can never act, so the model hears at once and the person is never asked
    // about a call that could only fail. A resume always goes to the gateway, which closes the approval.
    let problem: Error | undefined;
    let args: ToolArgs = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || "{}");
      if (!isRecord(parsed)) throw new Error("not an object");
      args = parsed;
    } catch {
      if (!mode.resume) return { content: serialise({ ok: false, error: BAD_JSON }) };
      problem = new Error(BAD_JSON);
    }

    const ctx: ToolContext = {
      agentId: this.opts.agentId,
      threadId: input.threadId,
      runId: input.runId,
      toolCallId: call.id,
      signal: io.signal,
      services: this.opts.services,
    };

    let facts: GateFacts = { target: {} };
    if (!problem) {
      try {
        facts = await tool.toGateCall(args, ctx);
      } catch (error) {
        if (error instanceof ArgumentError && !mode.resume) {
          return { content: serialise({ ok: false, error: error.message }) };
        }
        problem = error instanceof Error ? error : new Error(String(error));
      }
    }

    const intent =
      typeof args.intent === "string" && args.intent.trim() ? args.intent.trim().slice(0, 300) : undefined;
    const gateCall: GateCall = {
      toolCallId: call.id,
      runId: input.runId,
      threadId: input.threadId,
      agentId: this.opts.agentId,
      actorId: this.opts.actorId,
      initiator,
      tool: { name: tool.name, kind: tool.kind, surface: tool.surface, source: tool.source },
      args,
      target: facts.target,
      tainted: isTainted(messages, (name) => this.taints(name, scope.owned)),
      ...(intent ? { intent } : {}),
      ...(facts.outbound ? { outbound: facts.outbound } : {}),
    };

    // A target that could not be resolved for another reason (the computer failed), or a call the
    // person cancelled, still goes through the gateway so the record shows it, but it can only fail.
    const act = problem
      ? () => Promise.reject(problem)
      : mode.cancelled
        ? () => Promise.reject(new Error(CANCELLED_BY_PERSON))
        : () => tool.execute(args, ctx);

    let outcome: GateOutcome<unknown>;
    try {
      outcome = mode.resume
        ? await this.opts.governance.resume(gateCall, act)
        : await this.opts.governance.execute(gateCall, act);
    } catch (error) {
      this.report(error, "gateway");
      outcome = {
        status: "refused",
        decision: { effect: "deny", reason: "The gateway failed.", findings: [] },
        message: GATE_UNAVAILABLE,
      };
    }

    if (outcome.status === "parked" && !mode.cancelled) return { parked: { call, outcome } };
    return { content: serialise(envelopeFor(outcome, tool, mode.cancelled)) };
  }

  private answer(messages: Message[], toolCallId: string, content: string, emit: Emit): Message[] {
    const id = randomUUID();
    emit({ type: EventType.TOOL_CALL_RESULT, messageId: id, toolCallId, role: "tool", content } as BaseEvent);
    return placeResult(messages, toolCallId, { id, role: "tool", toolCallId, content } as Message);
  }

  /** Ends the run waiting on the person: one CUSTOM event per approval, then the interrupt. */
  private interrupt(
    parked: Extract<GateResult, { parked: unknown }>["parked"][],
    terminal: RunFinishedEvent,
    io: { emit: Emit; finish: (event: RunFinishedEvent) => void },
  ): void {
    for (const { outcome } of parked) {
      io.emit({
        type: EventType.CUSTOM,
        name: CUSTOM_EVENTS.approvalRequested,
        value: { approval: outcome.approval },
      } as BaseEvent);
    }
    const interrupts: Interrupt[] = parked.map(({ call, outcome }) => {
      const { approval, decision } = outcome;
      const metadata: ApprovalInterruptMetadata = {
        approvalId: approval.id,
        summary: approval.summary,
        tool: approval.tool,
        args: approval.args,
        findings: decision.findings,
        canAlways: approval.canAlways,
        ...(decision.rule ? { rule: decision.rule } : {}),
      };
      return {
        id: call.id,
        toolCallId: call.id,
        reason: APPROVAL_INTERRUPT_REASON,
        message: approval.summary,
        ...(approval.expiresAt ? { expiresAt: approval.expiresAt } : {}),
        metadata: metadata as unknown as Interrupt["metadata"],
      };
    });
    io.finish({ ...terminal, outcome: { type: "interrupt", interrupts } } as RunFinishedEvent);
  }

  private initiatorOf(input: RunAgentInput): Initiator {
    const props = isRecord(input.forwardedProps) ? input.forwardedProps.steward : undefined;
    if (
      isRecord(props) &&
      typeof props.token === "string" &&
      sameToken(props.token, this.opts.serverRunToken)
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
    return { kind: "person", id: this.opts.actorId };
  }

  /**
   * A browser that resumes a routine's or task's parked run carries no server token, but the run is
   * still theirs: keep the initiator stored with the approvals, as the resume sweep does, so their
   * stricter rules still apply. Several resumed calls give the strictest. Only ever stricter.
   *
   * Not knowing must not make it the person's run either: the run stops before anything acts, and
   * the answer stays unclaimed for the resume sweep, which knows the initiator.
   */
  private resumedInitiator(initiator: Initiator, resume: ResumeEntry[], threadId: string): Initiator {
    if (initiator.kind !== "person") return initiator;
    let strictest: Initiator | undefined;
    for (const entry of resume) {
      let stored: Initiator | undefined;
      try {
        stored = this.opts.governance.initiatorFor(entry.interruptId, threadId);
      } catch (error) {
        this.report(error, "initiator");
        throw new Error(INITIATOR_UNKNOWN);
      }
      const rank = stored ? RESUMED_RANK.indexOf(stored.kind) : -1;
      if (!stored || rank < 0 || typeof stored.id !== "string") continue;
      if (!strictest || rank < RESUMED_RANK.indexOf(strictest.kind)) strictest = stored;
    }
    return strictest ? { kind: strictest.kind, id: strictest.id } : initiator;
  }

  private toolsForRun(): StewardTool[] {
    try {
      return this.opts.tools();
    } catch (error) {
      this.report(error, "tools");
      return [];
    }
  }

  private contextFor(messages: Message[], initiator: Initiator): Context[] {
    if (!this.opts.context) return [];
    try {
      return this.opts.context(messages, initiator);
    } catch (error) {
      this.report(error, "context");
      return [];
    }
  }

  /** Whether a tool's results carry outside content. Unknown tools count as tainting: fail closed. */
  private taints(name: string, owned: Map<string, StewardTool>): boolean {
    const tool = owned.get(name);
    if (tool) return tool.taints;
    if (isBuiltinTool(name)) return TOOLS[name].taints;
    if (name.startsWith(MCP_TOOL_PREFIX)) return true;
    return false;
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
      if (this.opts.onError) this.opts.onError(error, where);
      else console.error(`[steward/agent] ${where}:`, errorMessage(error));
    } catch {
      // Reporting must never break a run.
    }
  }
}

/** Maps the gateway's outcome to what the model reads. */
export function envelopeFor(
  outcome: GateOutcome<unknown>,
  tool: StewardTool,
  cancelled = false,
): ToolResultEnvelope {
  if (cancelled && outcome.status !== "refused")
    return { ok: false, refused: true, message: CANCELLED_BY_PERSON };
  switch (outcome.status) {
    case "done":
      return {
        ok: true,
        data: tool.taints ? wrapUntrusted(outcome.result ?? null) : (outcome.result ?? null),
      };
    case "refused":
      return {
        ok: false,
        refused: true,
        ...(outcome.decision.rule ? { rule: outcome.decision.rule.name } : {}),
        message: outcome.message,
      };
    case "failed":
      return { ok: false, error: outcome.error };
    case "parked":
      return { ok: false, parked: true, approvalId: outcome.approval.id, message: outcome.message };
  }
}

function serialise(envelope: ToolResultEnvelope): string {
  let text: string;
  try {
    text = JSON.stringify(envelope);
  } catch {
    return JSON.stringify({
      ok: false,
      error: "The result could not be shown.",
    } satisfies ToolResultEnvelope);
  }
  if (text.length <= MAX_RESULT_CHARS || !envelope.ok) return text;
  const data = envelope.data;
  const inner = JSON.stringify(isRecord(data) && data.untrusted === true ? data.data : data) ?? "";
  const cut = { truncated: true, text: inner.slice(0, MAX_RESULT_CHARS) };
  const wrapped = isRecord(data) && data.untrusted === true ? wrapUntrusted(cut) : cut;
  return JSON.stringify({ ok: true, data: wrapped } satisfies ToolResultEnvelope);
}

export const NO_LONGER_GRANTED = "This tool is no longer granted to this agent, so it was not done.";

/**
 * A Steward tool that was parked but is no longer offered (its grant was removed while the person
 * decided). The resume still goes to the gateway, so the approval closes, but it can only fail.
 */
function withdrawnTool(name: string): StewardTool | undefined {
  const refuse = () => Promise.reject(new Error(NO_LONGER_GRANTED));
  const builtin = BUILTIN_TOOLS.find((t) => t.name === name);
  if (builtin) return { ...builtin, execute: refuse };
  const mcp = parseMcpToolName(name);
  if (!mcp) return undefined;
  return {
    name,
    description: "",
    parameters: { type: "object", properties: {} },
    kind: "write",
    surface: "mcp",
    source: `mcp:${mcp.server}`,
    taints: true,
    toGateCall: async () => ({ target: { mcp } }),
    execute: refuse,
  };
}

/** What BuiltInAgent would have given the model for an interrupt that is not Steward's. */
function foreignResumeValue(entry: ResumeEntry): unknown {
  return entry.status === "cancelled" ? { status: "cancelled" } : (entry.payload ?? { status: "resolved" });
}

/** The server's run token never travels further than this middleware. */
function withoutStewardProps(props: unknown): unknown {
  if (!isRecord(props) || !("steward" in props)) return props;
  const { steward: _steward, ...rest } = props;
  return rest;
}

/**
 * Puts a tool result right after the assistant message that made the call (and any results already
 * there), exactly where the AG-UI reducer puts it in the saved thread. A late resume, after the
 * conversation moved on, would otherwise land after later turns: the model would never see it, or
 * the provider would reject the order. Appends only when no message owns the call.
 */
function placeResult(messages: readonly Message[], toolCallId: string, result: Message): Message[] {
  const owner = messages.findIndex(
    (m) => m.role === "assistant" && (m.toolCalls ?? []).some((c) => c.id === toolCallId),
  );
  if (owner === -1) return [...messages, result];
  let at = owner + 1;
  while (at < messages.length && messages[at]?.role === "tool") at++;
  return [...messages.slice(0, at), result, ...messages.slice(at)];
}

/**
 * The AI SDK names a provider after the API it spoke (`xai.chat`, `openrouter.chat`); the record
 * names it the way Steward does (`xai`, `openrouter`). Entries without a count are dropped.
 */
export function normaliseUsage(entries: readonly TokenUsage[]): TokenUsage[] {
  return entries
    .filter((entry) =>
      [entry.inputTokens, entry.outputTokens, entry.totalTokens].some((n) => n !== undefined),
    )
    .map((entry) => {
      const provider = entry.provider?.replace(/\.(chat|responses|completion|completions)$/, "");
      return { ...entry, ...(provider ? { provider } : {}) };
    });
}

/** The run's whole usage on its last event, one entry per provider and model. Untouched when nothing was reported. */
function withUsage(event: RunFinishedEvent, usage: readonly TokenUsage[]): RunFinishedEvent {
  const total = aggregateTokenUsage(normaliseUsage(usage));
  if (total.length === 0) return event;
  const { usage: _own, ...rest } = event;
  return { ...rest, usage: total } as RunFinishedEvent;
}

/**
 * The full history after a segment: what we had, plus what the segment added. The segment ran on a
 * sanitized copy, so its output is appended to the unsanitized history rather than replacing it.
 */
function mergeHistory(full: Message[], sent: Message[], after: Message[]): Message[] {
  const sentIds = new Set(sent.map((m) => m.id));
  const added = after.filter((m) => !sentIds.has(m.id));
  return [...full, ...added];
}
