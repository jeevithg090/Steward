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
