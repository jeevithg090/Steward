/**
 * Whether a conversation has read outside content: a web page, an email, a file, another agent's
 * answer. The agent's middleware decides taint for the gateway; this is the web app's own reading
 * of the same rule, for cards that warn before the person keeps something (a skill). It fails
 * towards warning: a tool the app does not know counts as outside content.
 */
import type { Message } from "@copilotkit/react-core/v2";
import { isBuiltinTool, TOOLS } from "@steward/shared";

/** Whether a tool's results carry outside content. */
export function carriesOutside(name: string): boolean {
  return isBuiltinTool(name) ? TOOLS[name].taints : true;
}

/** A call the gateway refused read nothing. */
function wasRefused(content: unknown): boolean {
  if (typeof content !== "string") return false;
  try {
    const parsed = JSON.parse(content) as { ok?: unknown; refused?: unknown } | null;
    return parsed?.ok === false && parsed.refused === true;
  } catch {
    return false;
  }
}

export function readOutsideContent(messages: readonly Message[]): boolean {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant")
      for (const call of message.toolCalls ?? []) names.set(call.id, call.function.name);
  }
  return messages.some((message) => {
    if (message.role !== "tool") return false;
    const name = names.get(message.toolCallId);
    return name !== undefined && carriesOutside(name) && !wasRefused(message.content);
  });
}
