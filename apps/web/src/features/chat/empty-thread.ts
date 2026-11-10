import type { ThreadSummary } from "@steward/shared";

/**
 * The newest conversation with this agent that nothing has been said in yet, so opening Chat goes
 * back to it instead of making another blank one. Never a routine's or a task's, never one that is
 * working, and never one the person named.
 */
export function reusableThread(
  threads: readonly ThreadSummary[] | undefined,
  agentId: string,
): ThreadSummary | undefined {
  return [...(threads ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find(
      (thread) =>
        thread.kind === "chat" &&
        thread.agentId === agentId &&
        !thread.running &&
        !thread.lastMessagePreview &&
        (thread.title === "" || thread.title === "New conversation"),
    );
}
