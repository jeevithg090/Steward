import type { ReactNode } from "react";
import { setDefaultAgentId, useInfo } from "@/lib/api.ts";

/**
 * Waits for `/api/info`, then makes the tenant's first agent the one the app talks to by default.
 * A tenant such as `tempo` has no agent called `steward`, and pages read the default as they draw,
 * so nothing draws before it is known. When the server cannot be reached, the app draws anyway
 * with `steward`, and each page says what failed.
 *
 * This used to be CopilotKit's provider at the root. CopilotKit now loads with the chat
 * (`features.ts`), so the other pages no longer fetch it.
 */
export function DefaultAgent({ children }: { children: ReactNode }) {
  const info = useInfo();
  const first = info.data?.agents[0]?.id;
  if (first) setDefaultAgentId(first);
  if (!first && !info.isError) return null;
  return children;
}
