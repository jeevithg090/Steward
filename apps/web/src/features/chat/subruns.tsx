/**
 * Tasks the conversation's agent handed to another agent (`delegate_task`, plan §5). The child's
 * own messages arrive in this conversation tagged with a `subagentRunId`, which the server derives
 * from the parent's call (`sub-<toolCallId>`). The transcript keeps them out of the main flow and
 * the delegation card shows them, folded, under the call that started them.
 */
import type { Message } from "@copilotkit/react-core/v2";
import { createContext, useContext } from "react";

/** The handed-on task a message belongs to, if it belongs to one. */
export function subRunOf(message: unknown): string | undefined {
  const id = (message as { subagentRunId?: unknown } | null)?.subagentRunId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/** The parent's call a task was started by: `sub-<toolCallId>`, with a suffix when started again. */
export function callOfSubRun(subagentRunId: string, callIds: Iterable<string>): string | undefined {
  for (const callId of callIds) {
    const base = `sub-${callId}`;
    if (subagentRunId === base || subagentRunId.startsWith(`${base}-`)) return callId;
  }
  return undefined;
}

/** Each handed-on task's messages, in order, by the parent call that started it. */
export function groupSubRuns(messages: readonly Message[]): Map<string, Message[]> {
  const callIds = messages.flatMap((m) =>
    m.role === "assistant" && !subRunOf(m) ? (m.toolCalls ?? []).map((c) => c.id) : [],
  );
  const groups = new Map<string, Message[]>();
  for (const message of messages) {
    const sub = subRunOf(message);
    if (!sub) continue;
    const callId = callOfSubRun(sub, callIds) ?? sub;
    groups.set(callId, [...(groups.get(callId) ?? []), message]);
  }
  return groups;
}

export const SubRunsContext = createContext<Map<string, Message[]>>(new Map());

export function useSubRun(callId: string): Message[] {
  return useContext(SubRunsContext).get(callId) ?? [];
}
