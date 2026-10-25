import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Gateway, type ChatReply, type ChatTurn, type MissionView } from "@/lib/api";
import { ZONE_WORDS, recordedVerdict } from "@/lib/shield";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import ChatContainer from "./ChatContainer";
import { chatStore } from "./store";
import { SAMPLE_CHIPS } from "./WelcomeCard";

// jsdom has neither of these; the panels only need them to exist.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});
beforeEach(() => chatStore.reset());

const RAIL: MissionView = {
  id: "m_test1",
  user_id: "u_margaret",
  state: "awaiting_consent",
  message: "38 min late → 50% of £28.40 under GWR DR15 (demo values). Shall I claim £14.20 for you?",
  ask: {
    request_id: "r1",
    summary: "38 min late → 50% of £28.40 under GWR DR15 (demo values: not yet checked). Shall I claim £14.20 for you?",
    amount_gbp: "14.20",
    proof_trace: {
      id: "pt_1",
      amount_gbp: "14.20",
      steps: [{ fact_keys: ["arrival_delay_min", "fare_gbp"], rule_id: "uk-rail.gwr.delay-repay", rule_version: "0.1.0", citation_url: "https://www.gwr.com/delay-repay", explanation: "38 min late → 50% of £28.40" }],
    },
  },
  outcome: null,
  timeline: [{ to: "understood", at: "2026-10-25T08:00:00+00:00", latency_ms: 3 }],
  trace_url: null,
  court: { outcome: "proceed", eligible: true, agreement_rate: 1, verdicts: [{ juror: "claude", verdict: { eligible: true, rule_id: "uk-rail.gwr.delay-repay", confidence: 0.9 } }], absent: ["llama"], flags: [] },
  skill_id: "clawback.uk-rail-delay-repay",
};

function blank(intent: ChatReply["intent"], text: string): ChatReply {
  return { intent, reply: text, say: text, slots: {}, needs: null, mission: null, ask: null, verdict: null, memories: null, ledger: null, flags: null, actions: null, simulated: ["company", "rail data"] };
}

function fakeGateway(onChat: (turn: ChatTurn) => ChatReply) {
  const calls = { answered: [] as string[], stopped: [] as string[], turns: [] as ChatTurn[] };
  const gateway = new Gateway({ url: "http://gw.test", token: "t" });
  gateway.missions = async () => [];
  gateway.ttsConfigured = async () => false;
  gateway.chat = async (turn) => {
    calls.turns.push(turn);
    return onChat(turn);
  };
  gateway.answer = async (requestId) => {
    calls.answered.push(requestId);
    return { ...RAIL, state: "waiting", ask: null, message: "Claim filed. I'll check the payment has arrived on 25 Oct at 00:30." };
  };
  gateway.stop = async (id) => {
    calls.stopped.push(id);
    return { ...RAIL, state: "declined", ask: null };
  };
  return { gateway, calls };
}

function renderChat(gateway: Gateway, extra: Partial<PageProps> = {}) {
  const speak = vi.fn();
  const props: PageProps = {
    gateway,
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase: false,
    health: { status: "ok", mode: "replay", demo: true, simulated: ["company"], deploy: "local", region: "eu", third_parties: [] },
    events: [],
    language: "en",
    params: {},
    speak,
    setProfile: () => undefined,
    ...extra,
  };
  const utils = render(
    <main>
      <ChatContainer {...props} config={{ url: "http://gw.test", token: "t" }} activeModels={["local"]} selectedModel="local" onSelectModel={() => undefined} />
    </main>,
  );
  return { ...utils, speak };
}

test("the empty chat shows the welcome card with every sample chip and is axe-clean", async () => {
  const { gateway } = fakeGateway(() => blank("help", "I can help."));
  const { container } = renderChat(gateway);
  expect(screen.getByRole("heading", { level: 1, name: "Chat" })).toBeInTheDocument();
  const chips = within(screen.getByRole("list", { name: "Things to try" })).getAllByRole("button");
  expect(chips.map((c) => c.textContent)).toEqual(SAMPLE_CHIPS);
  await expectNoA11yViolations(container);
});

test("a chip goes through gateway.chat with the slots; a mission with an ask shows the consent card and Yes answers it", async () => {
  const { gateway, calls } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask, slots: { origin_crs: "OXF" } }));
  const { container, speak } = renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: SAMPLE_CHIPS[0] }));

  const yes = await screen.findByRole("button", { name: "Yes, claim £14.20" });
  expect(calls.turns[0]).toMatchObject({ user_id: "u_margaret", display_name: "Margaret", text: SAMPLE_CHIPS[0], language: "en", slots: {} });
  expect(screen.getByText("Tempo is asking you")).toBeInTheDocument();
  expect(screen.getByText("Delay Repay")).toBeInTheDocument(); // the intent badge
  expect(screen.getByText(/Simulated in this run: company, rail data/)).toBeInTheDocument();
  expect(screen.getByText("demo values")).toBeInTheDocument();
  expect(speak).toHaveBeenCalledWith(RAIL.message);

  // "Why this amount" opens the Proof Trace and the Court inline.
  await userEvent.click(screen.getByRole("button", { name: "Why this amount" }));
  expect(screen.getByText("Proof Trace")).toBeInTheDocument();
  expect(screen.getByText("Consensus Court")).toBeInTheDocument();
  expect(screen.getByText("absent")).toBeInTheDocument();
  await expectNoA11yViolations(container);

  await userEvent.click(yes);
  await waitFor(() => expect(calls.answered).toEqual(["r1"]));
  expect(await screen.findByText(/Claim filed/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Yes, claim £14.20" })).not.toBeInTheDocument();
  expect(chatStore.get().conversations[0]!.slots).toEqual({ origin_crs: "OXF" });
});

test("No stops the mission and says so", async () => {
  const { gateway, calls } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }));
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: SAMPLE_CHIPS[0] }));
  await userEvent.click(await screen.findByRole("button", { name: "No" }));
  await waitFor(() => expect(calls.stopped).toEqual(["m_test1"]));
  expect(await screen.findByText("Stopped: you declined.")).toBeInTheDocument();
});

test("a needs reply shows the one question, keeps the slots, and the next send echoes them", async () => {
  const { gateway, calls } = fakeGateway((turn) =>
    turn.slots?.fare_gbp
      ? { ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }
      : { ...blank("rail_delay", "Got it: Oxford to Paddington. What did the ticket cost?"), slots: { origin_crs: "OXF", destination_crs: "PAD", fare_gbp: null }, needs: [{ field: "fare_gbp", question: "What did the ticket cost?" }] },
  );
  renderChat(gateway);
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "My 08:12 Oxford to Paddington was late{enter}");
  expect(await screen.findByText(/What did the ticket cost\?/)).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Your message" })).toHaveAttribute("placeholder", "What did the ticket cost?");

  // The store merges what the server echoed; the client answers with the fare in its slots.
  chatStore.updateActive((c) => ({ ...c, slots: { ...c.slots, fare_gbp: "28.40" } }));
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "£28.40{enter}");
  await screen.findByRole("button", { name: "Yes, claim £14.20" });
  expect(calls.turns[1]!.slots).toMatchObject({ origin_crs: "OXF", destination_crs: "PAD", fare_gbp: "28.40" });
});

test("a verdict reply renders the Scam Shield card with the level and zone words", async () => {
  const verdict = recordedVerdict("hmrc");
  const { gateway } = fakeGateway(() => ({ ...blank("scam_check", verdict.say), verdict: verdict as unknown as Record<string, unknown>, actions: [{ label: "Open Scam Shield", href: "#/shield" }] }));
  const { container } = renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: SAMPLE_CHIPS[2] }));
  const card = await screen.findByRole("region", { name: "Scam Shield verdict" });
  expect(within(card).getByText("This looks like a scam")).toBeInTheDocument();
  expect(within(card).getByText(ZONE_WORDS[verdict.zone])).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Scam Shield" })).toHaveAttribute("href", "#/shield");
  await expectNoA11yViolations(container);
});

test("Gateway errors appear in the input's alert line in plain words", async () => {
  const gateway = new Gateway({ url: "http://gw.test", token: "t" });
  gateway.missions = async () => [];
  gateway.ttsConfigured = async () => false;
  gateway.chat = async () => {
    throw new Error("POST /chat: HTTP 404");
  };
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: "Help" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This Gateway has no chat door yet (POST /chat is missing).");
});

test("live events update the conversation that owns the mission", async () => {
  const { gateway } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }));
  const { rerender, speak } = renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: SAMPLE_CHIPS[0] }));
  await screen.findByRole("button", { name: "Yes, claim £14.20" });

  const props = { gateway, user: { id: "u_margaret", name: "Margaret", profileId: null }, showcase: false, health: null, language: "en" as const, params: {}, speak, setProfile: () => undefined };
  const state = { type: "state_changed", mission_id: "m_test1", from: "running", to: "waiting", at: "", latency_ms: 1200, actor: "agent" };
  rerender(
    <main>
      <ChatContainer {...props} events={[state]} config={{ url: "http://gw.test", token: "t" }} activeModels={["local"]} selectedModel="local" onSelectModel={() => undefined} />
    </main>,
  );
  expect(await screen.findByText("Waiting for the company · 1.2 s")).toBeInTheDocument();

  const outcome = { type: "outcome", mission_id: "m_test1", state: "verified", message: "GW has paid you £14.20.", amount_gbp: "14.20", reference: "GW-1" };
  rerender(
    <main>
      <ChatContainer {...props} events={[outcome, state]} config={{ url: "http://gw.test", token: "t" }} activeModels={["local"]} selectedModel="local" onSelectModel={() => undefined} />
    </main>,
  );
  expect(await screen.findByText("GW has paid you £14.20.")).toBeInTheDocument();
  expect(speak).toHaveBeenLastCalledWith("GW has paid you £14.20.");
  expect(screen.queryByRole("button", { name: "Yes, claim £14.20" })).not.toBeInTheDocument();
});
