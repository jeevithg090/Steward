import { lazy } from "react";

/**
 * The only place the shell touches the chat track's code (`src/features/*`), by the names agreed in
 * PLAN.md §5.1. The chat and computer pages are split into their own chunks: CopilotKit's chat pulls
 * in markdown, code highlighting and charts, which Today and Settings do not need.
 */

export { StewardCopilotProvider } from "@/features/chat/provider";

export const ChatPage = lazy(() => import("@/features/chat/ChatPage").then((m) => ({ default: m.ChatPage })));

export const ComputerPage = lazy(() =>
  import("@/features/computer/ComputerPage").then((m) => ({ default: m.ComputerPage })),
);
