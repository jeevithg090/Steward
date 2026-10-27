/**
 * Helpers over the AG-UI message list. `agent.messages` can be mutated in place by the client, so
 * these are recomputed each render rather than memoised on the array's identity.
 */
import type { Message, ToolCall, ToolMessage } from "@copilotkit/react-core/v2";
import { runningLabel } from "./tool-labels.ts";

/** The text of a message's content, which may be a string or a list of parts. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/** Tool results by the id of the call they answer. */
export function resultsById(messages: readonly Message[]): Map<string, ToolMessage> {
  const results = new Map<string, ToolMessage>();
  for (const message of messages) if (message.role === "tool") results.set(message.toolCallId, message);
  return results;
}

/** Index of the last message the person sent, or -1. */
export function lastUserIndex(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return i;
  return -1;
}

/** Ids of the tool calls made since the person last spoke. */
export function latestTurnToolCalls(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages.slice(lastUserIndex(messages) + 1)) {
    if (message.role === "assistant") for (const call of message.toolCalls ?? []) ids.add(call.id);
  }
  return ids;
}

/** Arguments of a call, parsed leniently: streaming arguments may be cut short. */
export function argsOf(call: ToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The last call in the latest turn that has not returned yet. */
export function openToolCall(messages: readonly Message[]): ToolCall | undefined {
  const results = resultsById(messages);
  let open: ToolCall | undefined;
  for (const message of messages.slice(lastUserIndex(messages) + 1)) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) if (!results.has(call.id)) open = call;
  }
  return open;
}

/**
 * The words for what Steward is doing right now: the step it is on ("Opening news.ycombinator.com"),
 * "Writing" while text streams, else "Thinking".
 */
export function currentStep(messages: readonly Message[]): string {
  const open = openToolCall(messages);
  if (open) return runningLabel(open.function.name, argsOf(open));
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && textOf(last.content).trim() !== "") return "Writing";
  return "Thinking";
}

/** The newest assistant message with words in it, after a given index. */
export function newestAssistantText(
  messages: readonly Message[],
  after = -1,
): { id: string; text: string } | undefined {
  for (let i = messages.length - 1; i > after; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const text = textOf(message.content).trim();
    if (text) return { id: message.id, text };
  }
  return undefined;
}

/** Turns a run failure into a sentence a person can act on. */
export function plainRunError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  // The server already words model failures for people ("The model provider says the account is
  // out of credit..."). Show those as they are rather than a vaguer sentence.
  if (/^(The model|Steward could not reach)/.test(raw.trim())) return raw.trim();
  const text = raw.toLowerCase();
  if (text.includes("pending interrupt")) return "Answer the request above first, then try again.";
  if (text.includes("locked") || text.includes("already running") || text.includes("busy")) {
    return "Steward is still busy with this conversation. Try again in a moment.";
  }
  if (text.includes("failed to fetch") || text.includes("network") || text.includes("econnrefused")) {
    return "Couldn't reach Steward. Check that the server is running, then try again.";
  }
  if (text.includes("401") || text.includes("api key") || text.includes("unauthor")) {
    return "The model provider turned the request away. Check the model key in Settings.";
  }
  if (text.includes("402") || text.includes("credit")) {
    return "The model provider says the account is out of credit. Check your account with them.";
  }
  if (text.includes("429") || text.includes("rate limit"))
    return "The model provider is busy. Try again in a minute.";
  return "Steward couldn't finish that reply.";
}
