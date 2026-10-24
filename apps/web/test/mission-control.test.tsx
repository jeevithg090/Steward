import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissionControl } from "@/components/MissionControl";
import { Gateway, type MissionView } from "@/lib/api";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

const WAITING: MissionView = {
  id: "m_1",
  state: "awaiting_consent",
  message: "Shall I claim £14.20 for you?",
  ask: { request_id: "r1", summary: "Shall I claim £14.20 for you?", amount_gbp: "14.20", proof_trace: null },
  outcome: null,
  timeline: [{ to: "understood", at: "", latency_ms: 4 }],
  trace_url: null,
  court: null,
};

const PHONE_UPDATES = {
  id: "mem_1", text: "prefers phone updates", category: "preference", source: "user_voice",
  trust: "trusted" as const, observed_at: "2026-10-24T09:00:00+00:00", confidence: 0.95,
  expires_at: null, superseded_by: null,
};

test("Mission Control shows a waiting mission and sends the approval", async () => {
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  const answered: string[] = [];
  const gateway = new Gateway({ url: "http://gw.test", token: "t" });
  gateway.health = async () => ({ status: "ok", mode: "replay", demo: false, simulated: ["company", "rail data"] });
  gateway.missions = async () => [WAITING];
  gateway.ledger = async () => ({ minutes_returned: "20", hours_returned: "0.3", gbp_recovered: "14.20" });
  gateway.memories = async () => ({
    memories: { preference: [{ item: { ...PHONE_UPDATES }, earlier: [] }] },
    timeline: [],
  });
  gateway.answer = async (requestId: string) => {
    answered.push(requestId);
    return { ...WAITING, state: "waiting", ask: null };
  };

  render(<MissionControl gateway={gateway} />);

  expect(await screen.findByRole("heading", { name: "Waiting for your OK" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("REPLAY data · SIMULATED COMPANY");
  expect(screen.getByText("0.3")).toBeInTheDocument();
  expect(await screen.findByText("prefers phone updates")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £14.20" }));
  await waitFor(() => expect(answered).toEqual(["r1"]));
});
