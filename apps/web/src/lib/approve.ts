// One way to answer Tempo's question (plan.md §12.3): with this device's passkey when it has one
// (the Gateway refuses an unsigned yes once the person has a passkey), otherwise with the bearer.
import type { Gateway, MissionView } from "./api";
import type { MeshClient } from "./mesh";

export interface Answerer {
  gateway: Gateway;
  mesh: MeshClient;
  /** This device signs approvals (useMesh().signs). */
  signs: boolean;
}

/** What the person reads when an unsigned yes is refused because they have Face ID set up (a no is always taken). */
export const SIGNED_ANSWER_NEEDED =
  "You've set up Face ID, so Tempo only takes a yes signed on one of your devices. Say yes on that device, or add Face ID to this browser on Devices.";

export async function answerAsk({ gateway, mesh, signs }: Answerer, requestId: string, approved: boolean): Promise<MissionView> {
  if (signs) return mesh.answer(requestId, approved);
  try {
    return await gateway.answer(requestId, approved);
  } catch (e) {
    // POST /approvals answers 403 once the person has a passkey ("approve with your passkey").
    if (/\/approvals\/\S*: HTTP 403/.test(e instanceof Error ? e.message : String(e))) throw new Error(SIGNED_ANSWER_NEEDED);
    throw e;
  }
}
