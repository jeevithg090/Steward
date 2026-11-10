import { createElement, lazy } from "react";

/**
 * The only place the shell touches the chat track's code (`src/features/*`), by the names agreed in
 * PLAN.md §5.1. The chat and computer pages are split into their own chunks, and CopilotKit comes
 * with the chat: its client and the markdown, maths and charts that replies draw with are about
 * 2 MB that Today, Settings and the other pages never use. Nothing here may import them statically
 * (`features.test.tsx` checks).
 */

const loadChat = () => Promise.all([import("@/features/chat/ChatPage"), import("@/features/chat/provider")]);

/** The chat, inside CopilotKit's provider. It stays mounted while one conversation leads to another. */
export const ChatPage = lazy(async () => {
  const [{ ChatPage: Page }, { StewardCopilotProvider }] = await loadChat();
  return {
    default: function ChatWithCopilotKit() {
      return createElement(StewardCopilotProvider, null, createElement(Page));
    },
  };
});

export const ComputerPage = lazy(() =>
  import("@/features/computer/ComputerPage").then((m) => ({ default: m.ComputerPage })),
);

/** How long after the app starts the chat is fetched in the background, so the first page goes first. */
export const CHAT_PREFETCH_DELAY_MS = 3000;

/**
 * Fetches the chat in the background a little after the first page, when the browser is idle, so
 * opening it from Today is quick. (An idle callback alone fires while the first page's own files
 * are still on their way.) Skipped when the person has asked their browser to save data. A failure
 * is ignored here: opening the chat tries again, and says so if it cannot.
 */
export function prefetchChat(): () => void {
  const nav = globalThis.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined;
  if (nav?.connection?.saveData) return () => {};
  const load = () => void loadChat().catch(() => {});
  let idle: number | undefined;
  const timer = setTimeout(() => {
    if (typeof globalThis.requestIdleCallback === "function") {
      idle = globalThis.requestIdleCallback(load, { timeout: 5000 });
    } else load();
  }, CHAT_PREFETCH_DELAY_MS);
  return () => {
    clearTimeout(timer);
    if (idle !== undefined) globalThis.cancelIdleCallback(idle);
  };
}
