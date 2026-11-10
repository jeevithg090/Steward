// sanitizeHistory adapted from openbot/toolkit/src/history-sanitize.ts (MIT, CopilotKit)
import type { Message, ToolCall } from "@ag-ui/client";

/** Every tool call made in the conversation, in order. */
export function callsIn(messages: readonly Message[]): ToolCall[] {
  return messages.flatMap((m) => (m.role === "assistant" ? (m.toolCalls ?? []) : []));
}

/** Ids of the tool calls that have a result. */
export function answeredIds(messages: readonly Message[]): Set<string> {
  return new Set(messages.flatMap((m) => (m.role === "tool" ? [m.toolCallId] : [])));
}

export function findCall(messages: readonly Message[], toolCallId: string): ToolCall | undefined {
  return callsIn(messages).find((c) => c.id === toolCallId);
}

function isSilent(message: Message): boolean {
  const content = (message as { content?: unknown }).content;
  if (content === undefined || content === null) return true;
  if (typeof content === "string") return content.length === 0;
  if (Array.isArray(content)) return content.length === 0;
  return false;
}

/**
 * Drops what a model provider would reject: a tool call with no result (an interrupted turn, or an
 * approval nobody answered before the person wrote again), and a result with no call. One dangling
 * call otherwise fails every later turn of the conversation with "tool result is missing".
 *
 * A call counts as answered only by a result after it and before the next user message, which is
 * where providers stop looking. Calls in `answeredElsewhere` (resume entries the model run will
 * answer itself) are kept. Messages that do not change are returned as the same objects.
 */
export function sanitizeHistory(
  history: readonly Message[],
  answeredElsewhere: ReadonlySet<string> = new Set(),
): Message[] {
  const boundaryAfter: number[] = new Array(history.length).fill(history.length);
  for (let index = history.length - 1, next = history.length; index >= 0; index--) {
    boundaryAfter[index] = next;
    if (history[index]?.role === "user") next = index;
  }

  const callAt = new Map<string, number>();
  history.forEach((message, index) => {
    if (message.role !== "assistant") return;
    for (const call of message.toolCalls ?? []) if (!callAt.has(call.id)) callAt.set(call.id, index);
  });

  const answerAt = new Map<string, number>();
  history.forEach((message, index) => {
    if (message.role !== "tool" || answerAt.has(message.toolCallId)) return;
    const called = callAt.get(message.toolCallId);
    if (called === undefined || index <= called) return;
    if (index >= (boundaryAfter[called] ?? history.length)) return;
    answerAt.set(message.toolCallId, index);
  });

  const surviving = new Set<string>();
  const kept: (Message | undefined)[] = history.map((message) => {
    if (message.role !== "assistant" || message.toolCalls === undefined) return message;
    const calls = message.toolCalls;
    const answered = calls.filter((c) => answeredElsewhere.has(c.id) || answerAt.has(c.id));
    for (const c of answered) surviving.add(c.id);
    if (answered.length === 0 && isSilent(message)) return undefined;
    if (answered.length === calls.length) return message;
    if (answered.length > 0) return { ...message, toolCalls: answered };
    const { toolCalls: _dropped, ...rest } = message;
    return rest as Message;
  });

  return kept.filter((message, index): message is Message => {
    if (message === undefined) return false;
    if (message.role !== "tool") return true;
    return surviving.has(message.toolCallId) && answerAt.get(message.toolCallId) === index;
  });
}

/** What the model reads in place of a result left out to save room. */
export const LEFT_OUT = "An older result, left out to save room. Call the tool again if you need it.";

const OMITTED = JSON.stringify({ ok: true, data: { omitted: true, note: LEFT_OUT } });

/** How many of the latest person's turns keep their results and calls whole. */
const RECENT_TURNS = 3;

/** Results and arguments longer than this are shortened once they are no longer recent. */
const BIG = 2_000;

/** How many browser results stay whole. Each is a snapshot, and only the newest one's refs still work. */
const RECENT_BROWSER = 3;

/** A browser result longer than this holds a snapshot. */
const BROWSER_BIG = 1_000;

/** Text in old calls' arguments longer than this is cut to its start. */
const LONG_TEXT = 500;

/** A picture or file in a message, counted the way providers roughly count one. */
const MEDIA_CHARS = 4_000;

/** Characters a message adds to a model call: its words, its calls' arguments, a result. */
function sizeOf(message: Message): number {
  const content = (message as { content?: unknown }).content;
  let size = 0;
  if (typeof content === "string") size += content.length;
  else if (Array.isArray(content)) {
    for (const part of content) {
      const text = (part as { text?: unknown } | null)?.text;
      size += typeof text === "string" ? text.length : MEDIA_CHARS;
    }
  }
  if (message.role === "assistant") {
    for (const call of message.toolCalls ?? [])
      size += call.function.arguments.length + call.function.name.length;
  }
  return size;
}

/** A failure or refusal is short and says what not to try again, so it is always kept. */
function isFailure(content: string): boolean {
  return content.startsWith('{"ok":false');
}

/** Long text inside a call's arguments, cut to its start with a note of how much was left out. */
function shortenValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > LONG_TEXT
      ? `${value.slice(0, 200)}… [${value.length - 200} more characters left out to save room]`
      : value;
  }
  if (depth >= 3) return value;
  if (Array.isArray(value)) return value.map((item) => shortenValue(item, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shortenValue(item, depth + 1)]),
    );
  }
  return value;
}

function shortenCalls(message: Message): Message {
  if (message.role !== "assistant" || !message.toolCalls?.some((c) => c.function.arguments.length > BIG)) {
    return message;
  }
  const toolCalls = message.toolCalls.map((call) => {
    if (call.function.arguments.length <= BIG) return call;
    try {
      const parsed: unknown = JSON.parse(call.function.arguments);
      return { ...call, function: { ...call.function, arguments: JSON.stringify(shortenValue(parsed, 0)) } };
    } catch {
      return call;
    }
  });
  return { ...message, toolCalls };
}

function leaveOut(message: Message): Message {
  return { ...message, content: OMITTED } as Message;
}

export interface BudgetedHistory {
  messages: Message[];
  /** Whether whole turns at the start were left out, so the model can be told. */
  droppedTurns: boolean;
}

/**
 * The history one model call carries, kept inside `maxChars` so a long conversation keeps working
 * instead of failing every turn once it outgrows the model's window. Run it after
 * `sanitizeHistory`; taint and the record always read the full history, never this.
 *
 * - Failures and refusals are always kept whole.
 * - Only the newest three browser results stay whole: each is a snapshot, and older refs are stale.
 * - Results over 2,000 characters older than the last three turns the person started become a
 *   short note saying the model can call the tool again, and long text in those turns' call
 *   arguments (a page it made, a file it wrote) is cut to its start.
 * - Still too long, the oldest whole turns are left out, never the latest one.
 * - Still too long, results in the latest turn over 2,000 characters become the note too, except
 *   the results of the latest step.
 *
 * Calls and their results stay in pairs, and messages that do not change are the same objects.
 */
export function budgetHistory(history: readonly Message[], maxChars: number): BudgetedHistory {
  const names = new Map(callsIn(history).map((c) => [c.id, c.function.name]));
  const userAt = history.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const recentFrom = userAt.length > RECENT_TURNS ? (userAt[userAt.length - RECENT_TURNS] ?? 0) : 0;
  const browserAt = history.flatMap((m, i) =>
    m.role === "tool" && names.get(m.toolCallId)?.startsWith("browser_") ? [i] : [],
  );
  const browser = new Set(browserAt);
  const keptBrowser = new Set(browserAt.slice(-RECENT_BROWSER));

  let messages = history.map((message, index) => {
    if (message.role === "assistant") return index < recentFrom ? shortenCalls(message) : message;
    if (message.role !== "tool" || typeof message.content !== "string" || isFailure(message.content)) {
      return message;
    }
    const length = message.content.length;
    if (browser.has(index) && !keptBrowser.has(index) && length > BROWSER_BIG) return leaveOut(message);
    if (index < recentFrom && length > BIG) return leaveOut(message);
    return message;
  });

  const sizes = messages.map(sizeOf);
  let total = sizes.reduce((sum, n) => sum + n, 0);
  let droppedTurns = false;
  if (total > maxChars && userAt.length > 0) {
    // The earliest turn start from which the rest fits, or the latest turn when none does.
    let cut = userAt.at(-1) ?? 0;
    let suffix = 0;
    const fits = new Map<number, number>();
    for (let i = messages.length - 1; i >= 0; i--) {
      suffix += sizes[i] ?? 0;
      if (messages[i]?.role === "user") fits.set(i, suffix);
    }
    for (const start of userAt) {
      if ((fits.get(start) ?? Number.POSITIVE_INFINITY) <= maxChars) {
        cut = start;
        break;
      }
    }
    if (cut > 0) {
      droppedTurns = true;
      messages = messages.slice(cut);
      total = fits.get(cut) ?? total;
    }
  }

  if (total > maxChars) {
    // The latest step's results are what the model is acting on now; earlier big ones go first.
    const lastStep = messages.findLast((m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0);
    const current = new Set(
      lastStep?.role === "assistant" ? (lastStep.toolCalls ?? []).map((c) => c.id) : [],
    );
    messages = messages.map((message) =>
      message.role === "tool" &&
      !current.has(message.toolCallId) &&
      typeof message.content === "string" &&
      message.content.length > BIG &&
      !isFailure(message.content)
        ? leaveOut(message)
        : message,
    );
  }
  return { messages, droppedTurns };
}

/** The text of a user message, whether it came as a string or as content parts. */
export function textOf(message: Message | undefined): string {
  if (!message) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

export function lastUserMessage(messages: readonly Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return messages[i];
  return undefined;
}

/**
 * True once a tool whose results carry outside content has returned anything in this conversation.
 * A result that says the call was refused never ran, so it read nothing; everything else counts,
 * errors included, because failing safe means asking more often, never less.
 */
export function isTainted(messages: readonly Message[], taints: (toolName: string) => boolean): boolean {
  const names = new Map(callsIn(messages).map((c) => [c.id, c.function.name]));
  for (const m of messages) {
    if (m.role !== "tool") continue;
    const name = names.get(m.toolCallId);
    if (name === undefined || !taints(name)) continue;
    if (wasRefused(m.content)) continue;
    return true;
  }
  return false;
}

function wasRefused(content: unknown): boolean {
  if (typeof content !== "string") return false;
  try {
    const parsed = JSON.parse(content) as { ok?: unknown; refused?: unknown };
    return parsed?.ok === false && parsed.refused === true;
  } catch {
    return false;
  }
}
