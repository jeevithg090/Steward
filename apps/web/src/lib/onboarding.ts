import { storage } from "./utils.ts";

/** Remembers, in this browser, that the welcome has been seen (finished or skipped). */
export const WELCOME_STORAGE_KEY = "steward.welcome";

/**
 * Also kept for this visit, for a browser that won't store it (storage blocked, some private
 * windows): without it, Skip would send the person to Today, and Today straight back to Welcome.
 */
let finishedThisVisit = false;

export function hasFinishedWelcome(): boolean {
  return finishedThisVisit || storage.get(WELCOME_STORAGE_KEY) === "done";
}

/** Forgets the welcome was seen, so the next visit to Today starts it again. */
export function forgetWelcome(): void {
  finishedThisVisit = false;
  storage.remove(WELCOME_STORAGE_KEY);
}

export function finishWelcome(): void {
  finishedThisVisit = true;
  storage.set(WELCOME_STORAGE_KEY, "done");
}

/** Where a starter or "Start" hands a message to the chat. The chat sends it once and clears it. */
export function chatPromptHref(prompt: string, threadId?: string): string {
  const path = threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
  return `${path}?prompt=${encodeURIComponent(prompt)}`;
}
