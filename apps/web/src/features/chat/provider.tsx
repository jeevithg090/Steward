/**
 * CopilotKit for the whole app: the runtime at `/api/copilotkit`, no inspector, and every tool
 * renderer registered once. The chat UI is Steward's own, so CopilotKit's stock chat styles are not
 * imported.
 *
 * Problems CopilotKit reports become a toast in plain words. A failed reply inside an open
 * conversation is already shown there with "Try again", so it is not toasted twice.
 */
import { CopilotKitCoreErrorCode, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { COPILOTKIT_PATH } from "@steward/shared";
import { type ReactNode, useCallback } from "react";
import { toast } from "sonner";
import { DEFAULT_AGENT_ID, setDefaultAgentId, useInfo } from "@/lib/api.ts";
import { StewardToolRenderers } from "./tools.tsx";

/** How many conversations on screen show their own run errors. */
let inlineErrorSurfaces = 0;

/** Called by a conversation while it is mounted: its run errors are shown in place, not toasted. */
export function claimInlineRunErrors(): () => void {
  inlineErrorSurfaces++;
  return () => {
    inlineErrorSurfaces = Math.max(0, inlineErrorSurfaces - 1);
  };
}

const RUN_ERRORS = new Set<string>([
  CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
  CopilotKitCoreErrorCode.AGENT_RUN_FAILED_EVENT,
  CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT,
  CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED,
]);

/** A CopilotKit error code in words a person can act on. */
export function copilotErrorMessage(code: string): string {
  switch (code) {
    case CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED:
      return "Couldn't reach Steward's assistant. Check that the server is running.";
    case CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED:
      return "Couldn't load this conversation. Reload the page to try again.";
    case CopilotKitCoreErrorCode.AGENT_NOT_FOUND:
      return "Steward's assistant isn't available. Check the server's setup.";
    case CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED:
      return "Steward is still busy with this conversation. Try again in a moment.";
    case CopilotKitCoreErrorCode.TOOL_ARGUMENT_PARSE_FAILED:
    case CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED:
    case CopilotKitCoreErrorCode.TOOL_NOT_FOUND:
      return "A step in Steward's reply didn't work.";
    default:
      return "Steward's reply ran into a problem.";
  }
}

/** The runtime's address: on this origin, or on `VITE_STEWARD_API_URL` like the rest of the API. */
const RUNTIME_URL = `${String(import.meta.env.VITE_STEWARD_API_URL ?? "").replace(/\/$/, "")}${COPILOTKIT_PATH}`;

export function StewardCopilotProvider({ children, agentId }: { children: ReactNode; agentId?: string }) {
  // The tenant decides the agents, so wait for /api/info before choosing one. A tenant such as
  // `tempo` has no agent called `steward`.
  const info = useInfo();
  const first = info.data?.agents[0]?.id;
  if (first) setDefaultAgentId(first);
  const resolved = agentId ?? first ?? (info.isError ? DEFAULT_AGENT_ID : undefined);
  const onError = useCallback(({ code, error }: { code: string; error: Error }) => {
    // The console keeps the detail for whoever is debugging; the person gets a sentence.
    console.warn(`[copilotkit] ${code}`, error);
    if (RUN_ERRORS.has(code) && inlineErrorSurfaces > 0) return;
    toast.error(copilotErrorMessage(code), { id: `copilotkit-${code}` });
  }, []);

  if (!resolved) return null;
  return (
    <CopilotKitProvider runtimeUrl={RUNTIME_URL} agentId={resolved} enableInspector={false} onError={onError}>
      <StewardToolRenderers />
      {children}
    </CopilotKitProvider>
  );
}
