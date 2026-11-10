import type { NavigateFunction } from "react-router";
import { storage } from "./utils.ts";

/** Remembers, in this browser, that the welcome has been seen (finished or skipped). */
export const WELCOME_STORAGE_KEY = "steward.welcome";

export function hasFinishedWelcome(): boolean {
  return storage.get(WELCOME_STORAGE_KEY) === "done";
}

export function finishWelcome(): void {
  storage.set(WELCOME_STORAGE_KEY, "done");
}

/**
 * What a page hands the chat to send once as the person's first message. It travels in router
 * state, which only Steward's own pages can set: a link from another site or an email can open
 * `/chat`, but never make it send anything.
 */
export interface ChatStarter {
  prompt: string;
}

/** Opens a new conversation and sends `prompt` in it once, as the person's message. */
export function startChat(navigate: NavigateFunction, prompt: string): void {
  navigate("/chat", { state: { prompt } satisfies ChatStarter });
}

/** The message a page handed over in router state, if there is one. */
export function starterFrom(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const prompt = (state as Partial<ChatStarter>).prompt;
  return typeof prompt === "string" && prompt.trim() ? prompt : undefined;
}

/** A plain address, or nothing: an address can carry quoted words, and those are the sender's. */
const PLAIN_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}$/;

/**
 * The brief's Start on an email, as the person's own message. It names the email by its address and
 * id only: the sender's display name and the subject are the sender's words, and in the person's
 * message the agent would read them as the person's request.
 */
export function emailStartPrompt(item: { emailId: string; from: { email: string } }): string {
  const address = item.from.email.trim();
  const id = item.emailId.trim().slice(0, 200);
  return PLAIN_ADDRESS.test(address)
    ? `Take care of the email from ${address} (email id ${id}). Read it first.`
    : `Take care of the email with id ${id}. Read it first.`;
}
