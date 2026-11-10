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
  type RunErrorEvent,
  type RunFinishedEvent,
  type TokenUsage,
  type ToolCall,
  type ToolCallResultEvent,
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
import { answeredIds, budgetHistory, callsIn, findCall, isTainted, sanitizeHistory } from "./history.ts";
import { BUILTIN_TOOLS, toAgUiTool } from "./tools/catalogue.ts";
import { DELEGATE_TOOL, delegateToolFor, delegationEnvelope, isDelegationRun } from "./tools/delegate.ts";
import { ArgumentError, explainArgs, forgiveArgs } from "./tools/schema.ts";
import type {
  DelegationRun,
  GateFacts,
  StewardTool,
  ToolArgs,
  ToolContext,
  ToolServices,
} from "./tools/types.ts";
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

/** The assistant's last words when the model keeps making calls that cannot run. */
export const KEPT_GETTING_IT_WRONG =
  "I kept getting that step wrong, so I stopped. Tell me a bit more and I'll try again.";

/** How many times the same call may fail before it runs, or model turns in a row may do nothing else. */
const MAX_MISTAKES = 3;

/** What the model reads for a call whose arguments were cut off at the reply limit. */
export function cutOffAt(maxOutputTokens: number | undefined): string {
  const limit = maxOutputTokens ? ` (${maxOutputTokens} tokens)` : "";
  return `Your reply reached its length limit${limit} while writing these arguments, so they were cut off and nothing was done. Make the call shorter, such as a shorter page, or split the work into smaller steps.`;
}

/** The assistant's last words when its replies keep being cut off at the limit. */
export const KEPT_RUNNING_OUT =
  "My replies kept running out of room before I could finish, so I stopped. Ask for a shorter version, or for it in parts.";

/** Added after words cut off at the reply limit. */
export const RAN_OUT_OF_ROOM = "I ran out of room in that reply. Ask me to carry on.";

/** What the model reads when arguments did not fit and Steward cannot say exactly why. */
const ARGS_DO_NOT_FIT =
  "The arguments did not fit what this tool takes. Check its parameters and call it again.";

/** How the AI SDK answers a call whose arguments did not parse or did not fit the tool's schema. */
const INVALID_INPUT = "Error: Invalid input for tool";

const BAD_JSON = "The arguments were not a JSON object. Call the tool again with valid arguments.";

/**
 * What the model reads when it calls one of the AG-UI state tools BuiltInAgent always adds. They
 * would save text outside the gateway and paste it into every later system prompt, so Steward
 * never runs them.
 */
export const STATE_TOOL_UNAVAILABLE = "That tool is not available here. Nothing was saved.";

/** The tools BuiltInAgent adds to every model call and runs itself. Steward answers them as unavailable. */
const STATE_TOOLS: ReadonlySet<string> = new Set(["AGUISendStateSnapshot", "AGUISendStateDelta"]);

/** Results longer than this are cut before the model sees them. */
const MAX_RESULT_CHARS = 120_000;

/** How much history one model call carries by default: about 100k tokens. */
export const DEFAULT_HISTORY_CHARS = 400_000;

/** What the model is told when the start of a long conversation was left out to fit its window. */
export const EARLIER_LEFT_OUT: Context = {
  description: "The start of this conversation",
  value:
    "The earliest messages of this conversation were left out to save room. If the person refers to something you cannot see, ask them, or look in memory and your workspace.",
};

const INITIATOR_KINDS: readonly Initiator["kind"][] = [
  "person",
  "routine",
  "task",
  "resume",
  "system",
  "device",
];

/**
 * Who a resumed run belongs to, strictest first: routines have the most rules against them. A run
 * started from a phone stays the phone's, so its presets and its record still say so.
 */
const RESUMED_RANK: readonly Initiator["kind"][] = ["routine", "task", "device", "resume", "system"];

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
  /** The most one model reply may write, so a call cut off at that limit can say so. */
  maxOutputTokens?: number;
  /** The most history, in characters, one model call carries. See `budgetHistory`. */
  maxHistoryChars?: number;
  /** Where unexpected errors go. They never escape the run. */
  onError?: (error: unknown, where: string) => void;
}

type Emit = (event: BaseEvent) => void;

interface Io {
  emit: Emit;
  signal: AbortSignal;
  track: (sub: Subscription) => void;
  tally: Tally;
}

/** What one run has used and done so far, for however it ends. */
interface Tally {
  /** Every model call's token usage, so the run ends with the whole run's count (per provider and model). */
  usage: TokenUsage[];
  /** Whether a call that changes something has run, so an error can say a retry would repeat it. */
  acted: boolean;
}

interface RunScope {
  input: RunAgentInput;
  initiator: Initiator;
  owned: Map<string, StewardTool>;
  io: Io;
  /** How many hand-offs deep this run is: 0 unless another agent handed it the task. */
  depth: number;
}

/** What one model call gave back. Nothing that needs a decision has been emitted yet. */
interface Segment {
  /** The history the model call ended with, including the results it gave its own calls. */
  messages: Message[];
  terminal?: RunFinishedEvent;
  /** Set when the model call failed: what was thrown, and the model run's own words for it. */
  failure?: { error?: unknown; message?: string };
  /** Calls the model started but never ended (a stop mid-arguments). */
  openCalls: Set<string>;
  /**
   * Results the model run gave its own calls (arguments that did not fit, a tool that does not
   * exist, the state tools), held back so the run can rewrite them before anyone sees them.
   */
  inside: ToolCallResultEvent[];
}

type GateResult =
  | { content: string }
  | { parked: { call: ToolCall; outcome: Extract<GateOutcome<unknown>, { status: "parked" }> } }
  /** A task handed to another agent, now running: the run follows it before the call has a result. */
  | { delegated: { call: ToolCall; run: DelegationRun } };

/** A handed-on task the run followed: its result for the parent's call, or the questions it stopped on. */
type Followed =
  | { callId: string | undefined; content: string }
  | { callId: string | undefined; interrupts: Interrupt[] };

/** The child's events the parent's stream carries, tagged with the child's `subagentRunId`. Run-scoped ones stay out. */
const FORWARDED: ReadonlySet<string> = new Set([
  EventType.TEXT_MESSAGE_START,
  EventType.TEXT_MESSAGE_CONTENT,
  EventType.TEXT_MESSAGE_END,
  EventType.TEXT_MESSAGE_CHUNK,
  EventType.TOOL_CALL_START,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_END,
  EventType.TOOL_CALL_CHUNK,
  EventType.TOOL_CALL_RESULT,
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.REASONING_END,
  EventType.CUSTOM,
]);

/** The conversation as this agent's model sees it: a handed-on task's own messages are left out. */
function ownMessages(messages: readonly Message[]): Message[] {
  return messages.filter((m) => !(m as { subagentRunId?: unknown }).subagentRunId);
}

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

const MODEL_KEY = "The model provider did not accept the key. Check it in Settings, then try again.";
const MODEL_CREDIT =
  "The model provider says the account is out of credit. Check your account with them, then try again.";
const MODEL_BUSY = "The model provider is busy right now. Wait a moment, then try again.";
const MODEL_UNKNOWN = "The model provider does not know that model. Check the model name in Settings.";
const MODEL_UNREACHABLE =
  "Steward could not reach the model. Check that it is running and that its address is right.";
const MODEL_STOPPED_ANSWERING = "The model stopped answering before it finished. Try again in a moment.";
const MODEL_TROUBLE = "The model provider is having trouble right now. Try again in a moment.";
const MODEL_REPLY_LIMIT =
  "The model will not write replies as long as Steward asks for. Lower STEWARD_MODEL_MAX_TOKENS, then restart Steward.";

/** What the person reads when the conversation no longer fits in the model's window. */
export const CONVERSATION_TOO_LONG =
  "This conversation has grown too long for the model. Start a new conversation; what Steward remembers carries over.";

/** Added to a model error when the run had already done something, so a retry does not do it twice. */
export const PARTLY_DONE =
  "Steward had already done part of this, shown above. Ask it to carry on rather than starting again.";

/** What the person reads when Steward itself failed. The detail goes to the error log, not the chat. */
export const AGENT_PROBLEM = "Steward hit a problem of its own and stopped. The record shows what it did.";

const TOO_LONG_TEXT =
  /maximum context length|context[ _-]?(length|window|size)|prompt is too long|input is too long|exceeds the maximum number of tokens|too many (input |prompt )?tokens|request too large|reduce the length/i;

/**
 * What the person reads when the model fails, in plain words. The HTTP status decides first when
 * there is one; then the words. The provider's own words are kept for the cases the patterns do not
 * cover, with anything shaped like a key hidden: some providers echo part of the key back, and this
 * message is kept in the conversation.
 */
export function modelErrorMessage(raw: string, status?: number): string {
  const text = raw.trim();
  // A 402 is about credit even when it names max_tokens ("requires more credits, or fewer max_tokens").
  if (status === 402) return MODEL_CREDIT;
  // Asking for longer replies than the model writes reads like a key error ("Invalid 'max_tokens'").
  if (/\bmax_(completion_|output_)?tokens\b/i.test(text) && !TOO_LONG_TEXT.test(text)) {
    return MODEL_REPLY_LIMIT;
  }
  // A 403 can be a key, a region or a moderation refusal, so the words decide that one.
  switch (status) {
    case 401:
      return MODEL_KEY;
    case 404:
      return MODEL_UNKNOWN;
    case 408:
    case 504:
      return MODEL_STOPPED_ANSWERING;
    case 413:
      return CONVERSATION_TOO_LONG;
    case 429:
      return /insufficient|quota|billing|credit/i.test(text) ? MODEL_CREDIT : MODEL_BUSY;
  }
  if (TOO_LONG_TEXT.test(text)) return CONVERSATION_TOO_LONG;
  if (
    /\b401\b|unauthori[sz]ed|invalid.{0,20}(api[ _-]?key|auth|bearer)|incorrect api key|no auth|authenticat/i.test(
      text,
    )
  ) {
    return MODEL_KEY;
  }
  if (/\b402\b|insufficient (credit|funds|balance|quota)|out of credits?|quota|billing/i.test(text)) {
    return MODEL_CREDIT;
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) return MODEL_BUSY;
  if (
    /model.{0,80}(not found|does not exist|is not a valid|unknown)|no such model|\bunknown model\b/i.test(
      text,
    )
  ) {
    return MODEL_UNKNOWN;
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|cannot connect|connect timeout/i.test(text)) {
    return MODEL_UNREACHABLE;
  }
  if (/\bterminated\b|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(text)) {
    return MODEL_STOPPED_ANSWERING;
  }
  if (status !== undefined && status >= 500) return MODEL_TROUBLE;
  const safe = text.replace(KEY_SHAPED, "[hidden]").slice(0, 300);
  return safe ? `The model could not answer: ${safe}` : "The model could not answer.";
}

/** The provider's own words inside an error body: OpenRouter keeps the upstream error in `metadata.raw`. */
function providerDetail(body: unknown): string | undefined {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
  const raw = error && isRecord(error.metadata) ? error.metadata.raw : undefined;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return JSON.stringify(raw);
  try {
    const inner: unknown = JSON.parse(raw);
    const message = isRecord(inner)
      ? isRecord(inner.error) && typeof inner.error.message === "string"
        ? inner.error.message
        : inner.message
      : undefined;
    return typeof message === "string" ? message : raw;
  } catch {
    return raw;
  }
}

/**
 * What a failed model call says about itself: its HTTP status, and its words with the provider's
 * own detail added. The AI SDK gives up after its retries with the last error inside.
 */
export function describeModelFailure(error: unknown): { status?: number; text: string } {
  let e: unknown = error;
  for (let depth = 0; depth < 3 && isRecord(e) && e.lastError !== undefined; depth++) e = e.lastError;
  const status = isRecord(e) && typeof e.statusCode === "number" ? e.statusCode : undefined;
  const message = e === undefined ? "" : errorMessage(e);
  const detail = isRecord(e) ? (providerDetail(e.responseBody) ?? providerDetail(e.data)) : undefined;
  const text = detail && !message.includes(detail) ? `${message}: ${detail}` : message;
  return { ...(status !== undefined ? { status } : {}), text };
}

/** Thrown with words meant for the person: the run's error says exactly this. */
class StopWithMessage extends Error {}

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
  private readonly maxHistoryChars: number;

  constructor(private readonly opts: GovernedToolsOptions) {
    super();
    this.maxSegments = Math.max(1, opts.maxSegments ?? 24);
    this.maxHistoryChars = Math.max(10_000, opts.maxHistoryChars ?? DEFAULT_HISTORY_CHARS);
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
      const tally: Tally = { usage: [], acted: false };
      const io: Io = { emit, signal: controller.signal, track: (sub) => (inner = sub), tally };

      this.work(input, next, io)
        .catch((error: unknown) => {
          this.report(error, "run");
          emit(
            withUsage(
              {
                type: EventType.RUN_ERROR,
                code: "STEWARD_AGENT_ERROR",
                message: error instanceof StopWithMessage ? error.message : AGENT_PROBLEM,
              } as RunErrorEvent,
              tally.usage,
            ),
          );
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

    const { usage } = io.tally;
    const finish = (event: RunFinishedEvent) => emit(withUsage(event, usage));

    let messages: Message[] = [...input.messages];
    const delegation = this.opts.services.delegation;
    const entries = input.resume ?? [];
    // Answers to questions a handed-on task asked belong to that task, not to this agent's calls.
    const childEntries = delegation ? entries.filter((e) => this.owner(e.interruptId) !== undefined) : [];
    const resume = entries.filter(
      (entry) => !childEntries.includes(entry) && findCall(messages, entry.interruptId) !== undefined,
    );
    const initiator = this.resumedInitiator(this.initiatorOf(input), resume, input.threadId);
    const depth = this.delegationDepthOf(input);
    const tools = this.offeredTools(this.toolsForRun(), depth);
    const owned = new Map(tools.map((t) => [t.name, t]));
    const scope: RunScope = { input, initiator, owned, io, depth };

    // 1. Resume: the person answered an approval. The database decides, not the payload.
    const answered = answeredIds(messages);
    if (
      childEntries.length === 0 &&
      resume.length > 0 &&
      resume.every((entry) => answered.has(entry.interruptId))
    ) {
      finish(this.finished(input));
      return;
    }
    const childInterrupts: Interrupt[] = [];
    if (delegation && childEntries.length > 0) {
      const bySubagent = new Map<string, ResumeEntry[]>();
      for (const entry of childEntries) {
        const id = this.owner(entry.interruptId);
        if (id) bySubagent.set(id, [...(bySubagent.get(id) ?? []), entry]);
      }
      const resumed: { callId: string | undefined; run: DelegationRun }[] = [];
      for (const [subagentRunId, list] of bySubagent) {
        if (signal.aborted) break;
        const callId = delegation.parentCallOf(subagentRunId);
        try {
          resumed.push({ callId, run: await delegation.resume(subagentRunId, list, initiator) });
        } catch (error) {
          this.report(error, "delegation");
          if (callId) {
            messages = this.answer(
              messages,
              callId,
              serialise({ ok: false, error: errorMessage(error) }),
              emit,
            );
          }
        }
      }
      for (const followed of await this.followAll(resumed, io)) {
        if ("interrupts" in followed) childInterrupts.push(...followed.interrupts);
        else if (followed.callId) messages = this.answer(messages, followed.callId, followed.content, emit);
      }
    }
    const parkedAgain: Extract<GateResult, { parked: unknown }>["parked"][] = [];
    const delegatedAgain: { callId: string; run: DelegationRun }[] = [];
    for (const entry of resume) {
      // After a stop, the answers not yet used stay unclaimed: the resume sweep continues them.
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
      else if ("delegated" in result) delegatedAgain.push({ callId: call.id, run: result.delegated.run });
      else messages = this.answer(messages, call.id, result.content, emit);
    }
    for (const followed of await this.followAll(delegatedAgain, io)) {
      if ("interrupts" in followed) childInterrupts.push(...followed.interrupts);
      else if (followed.callId) messages = this.answer(messages, followed.callId, followed.content, emit);
    }
    if (parkedAgain.length > 0 || childInterrupts.length > 0) {
      this.interrupt(parkedAgain, this.finished(input), { emit, finish }, childInterrupts);
      return;
    }
    if (signal.aborted) {
      finish(this.cancelled(input));
      return;
    }

    // 2. The model and its tools, until the model answers in words, a call is parked, or the limit.
    const context = [...input.context, ...this.contextFor(messages, initiator)];
    const offered = [...input.tools.filter((t) => !owned.has(t.name)), ...tools.map(toAgUiTool)];
    const offeredNames = new Set(offered.map((t) => t.name));
    const forwardedProps = withoutStewardProps(input.forwardedProps);
    let lastFinish = this.finished(input);
    // How often each exact call came back answered by the model run itself, how many model turns in
    // a row did nothing else, and how many were cut off at the reply limit mid-call.
    const mistakes = new Map<string, number>();
    let insideStreak = 0;
    let cutOffs = 0;

    for (let segment = 0; segment < this.maxSegments; segment++) {
      if (signal.aborted) {
        finish(this.cancelled(input));
        return;
      }
      // Within the model's window: old big results become a note, then the oldest turns go.
      // Taint, the gateway and the saved thread keep reading the full history.
      const sent = budgetHistory(sanitizeHistory(ownMessages(messages)), this.maxHistoryChars);
      const request: RunAgentInput = {
        ...input,
        messages: sent.messages,
        // Always empty, so BuiltInAgent puts no "Application State" in the system prompt: nothing
        // the browser or a state tool wrote reaches the model's instructions.
        state: {},
        context: sent.droppedTurns ? [...context, EARLIER_LEFT_OUT] : context,
        tools: offered,
        forwardedProps,
        resume: undefined,
      };
      const before = new Set(callsIn(request.messages).map((c) => c.id));
      const seg = await this.runSegment(request, next, io);
      const settled = this.settleInside(
        seg,
        mergeHistory(messages, request.messages, seg.messages),
        scope,
        offeredNames,
      );
      messages = settled.messages;
      if (seg.failure) {
        emit(withUsage(this.modelError(seg, io.tally.acted), usage));
        return;
      }
      if (seg.terminal?.usage) usage.push(...seg.terminal.usage);
      const done = answeredIds(messages);
      const fresh = callsIn(seg.messages).filter((c) => !before.has(c.id));
      const pending = fresh.filter((c) => !done.has(c.id));

      if (!seg.terminal || seg.terminal.outcome?.type === "cancelled" || signal.aborted) {
        // Every call of this model turn that has no result is answered as stopped: it never ran.
        // One the model was still writing is open, and AG-UI refuses to finish a run with open
        // calls, so it is closed first.
        const unanswered = new Set([...pending.map((c) => c.id), ...seg.openCalls]);
        for (const id of unanswered) {
          if (seg.openCalls.has(id)) emit({ type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent);
          messages = this.answer(messages, id, serialise({ ok: false, error: STOPPED }), emit);
        }
        finish(seg.terminal ?? this.cancelled(input));
        return;
      }
      lastFinish = seg.terminal;

      // Calls the model run answered itself (arguments that did not fit, a tool that does not
      // exist) get another model turn, so the model can read why and recover instead of going
      // quiet. The same mistake made again and again stops the run instead of using every step.
      const inside = new Set(seg.inside.map((e) => e.toolCallId).filter((id) => !settled.rescued.has(id)));
      for (const call of fresh) {
        if (!inside.has(call.id)) continue;
        const key = `${call.function.name}\u0000${call.function.arguments}`;
        mistakes.set(key, (mistakes.get(key) ?? 0) + 1);
      }
      const answeredInside = fresh.length > 0 && pending.length === 0;
      insideStreak = answeredInside ? insideStreak + 1 : 0;
      if (settled.cutOff) cutOffs++;
      if (answeredInside) {
        // Only when nothing else waits: a call that did fit still runs, and the model hears both.
        if (cutOffs >= 2) {
          this.say(KEPT_RUNNING_OUT, emit);
          finish(seg.terminal);
          return;
        }
        if (insideStreak >= MAX_MISTAKES || [...mistakes.values()].some((n) => n >= MAX_MISTAKES)) {
          this.say(KEPT_GETTING_IT_WRONG, emit);
          finish(seg.terminal);
          return;
        }
        // On the last step this ends the loop, and the run says it stopped at the step limit.
        continue;
      }
      const mine = pending.filter((c) => owned.has(c.function.name));
      if (mine.length === 0) {
        // Words cut off at the reply limit end mid-sentence; say so rather than leave them hanging.
        if (fresh.length === 0 && finishReasonOf(seg.terminal) === "length") this.say(RAN_OUT_OF_ROOM, emit);
        finish(seg.terminal);
        return;
      }

      const parked: Extract<GateResult, { parked: unknown }>["parked"][] = [];
      const delegated: { callId: string; run: DelegationRun }[] = [];
      for (const call of mine) {
        if (signal.aborted) break;
        const tool = owned.get(call.function.name);
        if (!tool) continue;
        const result = await this.gate(call, tool, messages, scope, { resume: false, cancelled: false });
        if ("parked" in result) parked.push(result.parked);
        else if ("delegated" in result) delegated.push({ callId: call.id, run: result.delegated.run });
        else messages = this.answer(messages, call.id, result.content, emit);
      }
      // Handed-on tasks run side by side; each one's answer becomes its call's result.
      const asked: Interrupt[] = [];
      for (const followed of await this.followAll(delegated, io)) {
        if ("interrupts" in followed) asked.push(...followed.interrupts);
        else if (followed.callId) messages = this.answer(messages, followed.callId, followed.content, emit);
      }
      if (signal.aborted) {
        // Stopped between calls: the ones that never ran are answered as stopped, so no card
        // waits forever. Parked calls keep their approvals; handed-on tasks answered themselves.
        const settled = answeredIds(messages);
        const waiting = new Set([...parked.map((p) => p.call.id), ...delegated.map((d) => d.callId)]);
        for (const call of pending) {
          if (settled.has(call.id) || waiting.has(call.id)) continue;
          messages = this.answer(messages, call.id, serialise({ ok: false, error: STOPPED }), emit);
        }
      }
      if (parked.length > 0 || asked.length > 0) {
        this.interrupt(parked, seg.terminal, { emit, finish }, asked);
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

    this.say(TOO_MANY_STEPS, emit);
    finish(lastFinish);
  }

  /** Steward's own words at the end of a run, as one assistant message. */
  private say(text: string, emit: Emit): void {
    const messageId = randomUUID();
    emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
    emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text } as BaseEvent);
    emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
  }

  /**
   * One model call. Forwards its words and calls, and holds back what needs a decision first: its
   * RUN_STARTED and RUN_FINISHED, its error, and the results it gave its own calls. It notes the
   * calls it started but never ended (a stop mid-arguments), so the run can close them.
   *
   * State events are never forwarded or kept: BuiltInAgent runs its state tools itself, outside the
   * gateway, and whatever they saved would come back in every later system prompt.
   */
  private runSegment(request: RunAgentInput, next: AbstractAgent, io: Io): Promise<Segment> {
    return new Promise((resolve) => {
      let messages = request.messages;
      let terminal: RunFinishedEvent | undefined;
      let failure: Segment["failure"];
      const openCalls = new Set<string>();
      const inside: ToolCallResultEvent[] = [];
      const settle = () => resolve({ messages, terminal, failure, openCalls, inside });
      try {
        const sub = this.runNextWithState(request, new Seed(next, request)).subscribe({
          next: ({ event, messages: updated }) => {
            messages = updated;
            if (event.type === EventType.TOOL_CALL_START || event.type === EventType.TOOL_CALL_END) {
              const id = (event as { toolCallId?: unknown }).toolCallId;
              if (typeof id === "string") {
                if (event.type === EventType.TOOL_CALL_START) openCalls.add(id);
                else openCalls.delete(id);
              }
            }
            switch (event.type) {
              case EventType.RUN_STARTED:
              case EventType.STATE_SNAPSHOT:
              case EventType.STATE_DELTA:
                return;
              case EventType.RUN_FINISHED:
                terminal = event as RunFinishedEvent;
                return;
              case EventType.RUN_ERROR: {
                const raw = (event as { message?: unknown }).message;
                failure = { ...failure, message: typeof raw === "string" ? raw : "" };
                return;
              }
              case EventType.TOOL_CALL_RESULT:
                inside.push(event as ToolCallResultEvent);
                return;
              default:
                io.emit(event);
            }
          },
          error: (error: unknown) => {
            failure = { ...failure, error };
            settle();
          },
          complete: settle,
        });
        io.track(sub);
      } catch (error) {
        failure = { error };
        settle();
      }
    });
  }

  /**
   * Emits the results the model run gave its own calls, rewritten where Steward has something
   * better to say, and keeps the history in step with what was emitted. A Steward tool whose
   * arguments only need the slips its readers accept put right is not answered here: its result is
   * dropped, so the call goes to the gateway like any other (`rescued`).
   */
  private settleInside(
    seg: Segment,
    messages: Message[],
    scope: RunScope,
    offered: ReadonlySet<string>,
  ): { messages: Message[]; rescued: Set<string>; cutOff: boolean } {
    let out = messages;
    const rescued = new Set<string>();
    const lengthCut = finishReasonOf(seg.terminal) === "length";
    let cutOff = false;
    for (const event of seg.inside) {
      const call = findCall(seg.messages, event.toolCallId);
      const answer = this.insideAnswer(call, event.content, scope.owned, offered, lengthCut);
      if (answer === "rescue") {
        rescued.add(event.toolCallId);
        out = out.filter((m) => !(m.role === "tool" && m.id === event.messageId));
        continue;
      }
      if (answer.cutOff) cutOff = true;
      const { content } = answer;
      if (content !== event.content) {
        out = out.map((m) =>
          m.role === "tool" && m.toolCallId === event.toolCallId && m.id === event.messageId
            ? ({ ...m, content } as Message)
            : m,
        );
      }
      scope.io.emit({ ...event, content } as BaseEvent);
    }
    return { messages: out, rescued, cutOff };
  }

  /**
   * What the model reads for a call its own run answered, in Steward's envelope: the state tools
   * are unavailable, a tool that does not exist is named, arguments cut off at the reply limit say
   * so, and arguments that did not fit say exactly what to change.
   */
  private insideAnswer(
    call: ToolCall | undefined,
    content: ToolCallResultEvent["content"],
    owned: Map<string, StewardTool>,
    offered: ReadonlySet<string>,
    lengthCut: boolean,
  ): { content: ToolCallResultEvent["content"]; cutOff?: boolean } | "rescue" {
    if (!call) return { content };
    const name = call.function.name;
    if (STATE_TOOLS.has(name)) return { content: serialise({ ok: false, error: STATE_TOOL_UNAVAILABLE }) };
    const tool = owned.get(name);
    if (!tool) {
      if (offered.has(name)) return { content };
      return {
        content: serialise({
          ok: false,
          error: `There is no tool called "${name.slice(0, 80)}". Use only the tools you are offered.`,
        }),
      };
    }
    if (typeof content !== "string" || !content.startsWith(INVALID_INPUT)) return { content };
    const args = parseArgs(call.function.arguments || "{}");
    if (args === undefined) {
      return lengthCut
        ? { content: serialise({ ok: false, error: cutOffAt(this.opts.maxOutputTokens) }), cutOff: true }
        : { content: serialise({ ok: false, error: BAD_JSON }) };
    }
    if (correctable(tool) && !explainArgs(tool.parameters, forgiveArgs(tool.parameters, args))) {
      return "rescue";
    }
    return {
      content: serialise({ ok: false, error: explainArgs(tool.parameters, args) ?? ARGS_DO_NOT_FIT }),
    };
  }

  /**
   * The run's one error, from a failed model call, in plain words. The status and the provider's
   * detail come from what was thrown; the model run's own words for it can say more (a stream error
   * that was not an Error), so the longer of the two is read.
   */
  private modelError(seg: Segment, acted: boolean): RunErrorEvent {
    const { error, message = "" } = seg.failure ?? {};
    if (error !== undefined) this.report(error, "model");
    const thrown = error !== undefined ? describeModelFailure(error) : { text: "" };
    const text = message.length > thrown.text.length ? message : thrown.text;
    const plain = modelErrorMessage(text, thrown.status);
    return {
      type: EventType.RUN_ERROR,
      code: "STEWARD_MODEL_ERROR",
      message: acted ? `${plain} ${PARTLY_DONE}` : plain,
    } as RunErrorEvent;
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
    const parsed = parseArgs(call.function.arguments || "{}");
    if (parsed === undefined) {
      if (!mode.resume) return { content: serialise({ ok: false, error: BAD_JSON }) };
      problem = new Error(BAD_JSON);
    } else {
      args = parsed;
      // A built-in tool's call that only needs the slips its readers accept put right (an optional
      // field sent as null, a number sent as text) runs as the corrected call, which is what the
      // gateway decides on and the record keeps. The same correction on a resume keeps it the
      // exact call the person answered.
      if (correctable(tool) && explainArgs(tool.parameters, args)) {
        const forgiven = forgiveArgs(tool.parameters, args);
        if (!explainArgs(tool.parameters, forgiven)) args = forgiven;
      }
    }

    const ctx: ToolContext = {
      agentId: this.opts.agentId,
      threadId: input.threadId,
      runId: input.runId,
      toolCallId: call.id,
      signal: io.signal,
      services: this.opts.services,
      initiator,
      delegationDepth: scope.depth,
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

    if (outcome.status === "done" && !mode.cancelled && tool.kind !== "read" && tool.kind !== "ui") {
      io.tally.acted = true;
    }
    if (outcome.status === "parked" && !mode.cancelled) return { parked: { call, outcome } };
    if (outcome.status === "done" && isDelegationRun(outcome.result)) {
      return { delegated: { call, run: outcome.result } };
    }
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
    /** Questions handed-on tasks stopped on, already tagged with their `subagentRunId`. */
    asked: Interrupt[] = [],
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
    io.finish({
      ...terminal,
      outcome: { type: "interrupt", interrupts: [...interrupts, ...asked] },
    } as RunFinishedEvent);
  }

  /** The tools this run offers: `delegate_task` only when there is someone to hand to and depth allows. */
  private offeredTools(tools: StewardTool[], depth: number): StewardTool[] {
    if (!tools.some((t) => t.name === DELEGATE_TOOL)) return tools;
    const delegation = this.opts.services.delegation;
    let targets: ReturnType<NonNullable<typeof delegation>["targets"]> = [];
    if (delegation && depth < delegation.maxDepth) {
      try {
        targets = delegation.targets(this.opts.agentId);
      } catch (error) {
        this.report(error, "delegation");
      }
    }
    return tools.flatMap((t) =>
      t.name !== DELEGATE_TOOL ? [t] : targets.length > 0 ? [delegateToolFor(targets)] : [],
    );
  }

  /** How many hand-offs deep this run is. Only the server can say so (its token rides with it). */
  private delegationDepthOf(input: RunAgentInput): number {
    const props = isRecord(input.forwardedProps) ? input.forwardedProps.steward : undefined;
    if (
      !isRecord(props) ||
      typeof props.token !== "string" ||
      !sameToken(props.token, this.opts.serverRunToken)
    ) {
      return 0;
    }
    const depth = isRecord(props.delegation) ? props.delegation.depth : undefined;
    return typeof depth === "number" && Number.isInteger(depth) && depth >= 0 ? depth : 0;
  }

  private owner(interruptId: string): string | undefined {
    try {
      return this.opts.services.delegation?.ownerOf(interruptId);
    } catch (error) {
      this.report(error, "delegation");
      return undefined;
    }
  }

  private followAll(runs: { callId: string | undefined; run: DelegationRun }[], io: Io): Promise<Followed[]> {
    return Promise.all(runs.map((r) => this.follow(r.callId, r.run, io)));
  }

  /**
   * Follows one handed-on task: SUBAGENT_STARTED, the child's events tagged with its
   * `subagentRunId`, then SUBAGENT_FINISHED (or SUBAGENT_ERROR). Stop stops the child too. When
   * the child stops on a question, its interrupts come back for the parent's run to end with, each
   * saying which agent asks.
   */
  private async follow(callId: string | undefined, run: DelegationRun, io: Io): Promise<Followed> {
    const { emit, signal } = io;
    const { subagentRunId } = run;
    emit({
      type: EventType.SUBAGENT_STARTED,
      subagentRunId,
      name: run.agentName,
      description: run.task,
      ...(callId ? { parentToolCallId: callId } : {}),
    } as BaseEvent);
    const onStop = () => void run.stop().catch((error: unknown) => this.report(error, "delegation"));
    if (signal.aborted) onStop();
    else signal.addEventListener("abort", onStop, { once: true });
    let subscription: Subscription | undefined;
    const forwarded = new Promise<void>((resolve) => {
      subscription = run.events().subscribe({
        next: (event) => {
          if (FORWARDED.has(event.type)) emit({ ...event, subagentRunId } as BaseEvent);
        },
        complete: resolve,
        error: () => resolve(),
      });
    });
    const result = await run.done();
    // Everything the child said is in the parent's stream before the parent says how it ended.
    await Promise.race([forwarded, new Promise((r) => setTimeout(r, 2_000))]);
    subscription?.unsubscribe();
    signal.removeEventListener("abort", onStop);

    if (result.outcome === "interrupt") {
      const interrupts = result.interrupts.map((interrupt) => ({
        ...interrupt,
        subagentRunId,
        metadata: {
          ...(isRecord(interrupt.metadata) ? interrupt.metadata : {}),
          askedBy: { agentId: run.agentId, name: run.agentName, subagentRunId },
        },
      })) as Interrupt[];
      emit({
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId,
        outcome: { type: "suspended", interruptIds: interrupts.map((i) => i.id) },
      } as BaseEvent);
      return { callId, interrupts };
    }
    if (result.outcome === "success") {
      emit({ type: EventType.SUBAGENT_FINISHED, subagentRunId, result: result.text } as BaseEvent);
    } else {
      emit({
        type: EventType.SUBAGENT_ERROR,
        subagentRunId,
        code: result.outcome,
        message:
          result.outcome === "cancelled" ? "Stopped." : (result.error ?? "It stopped without answering."),
      } as BaseEvent);
    }
    return { callId, content: serialise(delegationEnvelope(run.agentName, result)) };
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
        throw new StopWithMessage(INITIATOR_UNKNOWN);
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

/**
 * Whether a call's small slips may be put right before it runs. Only Steward's own tools, whose
 * readers accept those slips anyway; never an MCP server's, which reads its own arguments; and
 * never a display tool, which the web app draws from the call's arguments as the model wrote them.
 */
function correctable(tool: StewardTool): boolean {
  return tool.source === "builtin" && tool.kind !== "ui";
}

/** A call's arguments as an object, or `undefined` when they are not JSON or not an object. */
function parseArgs(text: string): ToolArgs | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Why the model stopped writing: `length` when it hit the reply limit. */
function finishReasonOf(event: RunFinishedEvent | undefined): string | undefined {
  const metadata = (event as { metadata?: unknown } | undefined)?.metadata;
  const reason = isRecord(metadata) ? metadata.finishReason : undefined;
  return typeof reason === "string" ? reason : undefined;
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

/**
 * The run's whole usage on its last event, finished or failed, one entry per provider and model.
 * Untouched when nothing was reported.
 */
function withUsage<E extends RunFinishedEvent | RunErrorEvent>(event: E, usage: readonly TokenUsage[]): E {
  const total = aggregateTokenUsage(normaliseUsage(usage));
  if (total.length === 0) return event;
  const { usage: _own, ...rest } = event;
  return { ...rest, usage: total } as E;
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
