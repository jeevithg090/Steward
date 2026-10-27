import { storage } from "./utils.ts";

/** Remembers, in this browser, that the welcome has been seen (finished or skipped). */
export const WELCOME_STORAGE_KEY = "steward.welcome";

export function hasFinishedWelcome(): boolean {
  return storage.get(WELCOME_STORAGE_KEY) === "done";
}

export function finishWelcome(): void {
  storage.set(WELCOME_STORAGE_KEY, "done");
}

/** Where a starter or "Start" hands a message to the chat. The chat sends it once and clears it. */
export function chatPromptHref(prompt: string, threadId?: string): string {
  const path = threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
  return `${path}?prompt=${encodeURIComponent(prompt)}`;
}
