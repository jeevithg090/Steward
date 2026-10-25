import { StrictMode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "@/components/ui";
import { Gateway, type ChatReply, type ChatTurn, type Health, type MissionView } from "@/lib/api";
import { ZONE_WORDS, recordedVerdict } from "@/lib/shield";
import { ShowcaseGateway } from "@/lib/showcase";
import { SUGGESTIONS } from "@/lib/showcase-chat";
import lettersJson from "@/showcase/letters.json";
import { reveal } from "@/lib/reveal";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import ChatContainer, { gatewayModelWords } from "./ChatContainer";
import { MAX_CONVERSATIONS, STORE_KEY, chatStore } from "./store";
import { TOOL_INTRO } from "./tools";
import { BEATS, SAMPLE_CHIPS } from "./WelcomeCard";

// This device's Mesh state (plan.md §12.2): by default it does not sign; one test makes it sign.
const meshMock = vi.hoisted(() => ({ signs: false, answered: [] as [string, boolean][], view: null as unknown }));
vi.mock("@/lib/mesh-context", () => ({
  useMesh: () => ({
    mesh: {
      answer: async (requestId: string, approved: boolean) => {
        meshMock.answered.push([requestId, approved]);
        return meshMock.view;
      },
    },
    devices: null,
    signs: meshMock.signs,
    canPasskey: false,
    showcase: false,
    refresh: async () => undefined,
  }),
}));

// jsdom has neither of these; the panels only need them to exist.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
});
beforeEach(() => {
  localStorage.clear();
  reveal.set(false);
  chatStore.reset();
  toast.clear();
  meshMock.signs = false;
  meshMock.answered = [];
  window.location.hash = "#/chat";
});
afterEach(() => {
  (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
});

/** Pretend the screen is a phone (below `lg`) or a desktop. */
function setWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

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

const FILED = "Claim filed. I'll check the payment has arrived on 25 Oct at 00:30.";

function blank(intent: ChatReply["intent"], text: string): ChatReply {
  return { intent, reply: text, say: text, slots: {}, needs: null, mission: null, ask: null, verdict: null, memories: null, ledger: null, flags: null, actions: null, simulated: ["company", "rail data"] };
}

function fakeGateway(onChat: (turn: ChatTurn) => ChatReply | Promise<ChatReply>) {
  const calls = { answered: [] as [string, boolean][], stopped: [] as string[], turns: [] as ChatTurn[] };
  const gateway = new Gateway({ url: "http://gw.test", token: "t" });
  gateway.missions = async () => [];
  gateway.ttsConfigured = async () => false;
  gateway.chat = async (turn) => {
    calls.turns.push(turn);
    return onChat(turn);
  };
  gateway.answer = async (requestId, approved) => {
    calls.answered.push([requestId, approved]);
    return approved ? { ...RAIL, state: "waiting", ask: null, message: FILED } : { ...RAIL, state: "declined", ask: null, message: "Stopped: you said no. Nothing was sent." };
  };
  gateway.stop = async (id) => {
    calls.stopped.push(id);
    return { ...RAIL, state: "declined", ask: null };
  };
  return { gateway, calls };
}

function renderChat(gateway: Gateway, extra: Partial<PageProps> = {}, strict = false) {
  const speak = vi.fn();
  const props: PageProps = {
    gateway,
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase: false,
    health: { status: "ok", mode: "replay", demo: true, simulated: ["company"], deploy: "local", region: "eu", third_parties: [] },
    connected: true,
    events: [],
    language: "en",
    params: {},
    speak,
    setProfile: () => undefined,
    ...extra,
  };
  const tree = (
    <main>
      <ChatContainer {...props} config={{ url: "http://gw.test", token: "t" }} activeModels={["local"]} selectedModel="local" onSelectModel={() => undefined} />
      <Toaster />
    </main>
  );
  const utils = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...utils, speak };
}

const RAIL_CHIP = SAMPLE_CHIPS[0]!;

test("the empty chat greets Margaret, groups a sample for every beat, says the promise, and is axe-clean", async () => {
  const { gateway } = fakeGateway(() => blank("help", "I can help."));
  const { container } = renderChat(gateway);
  expect(screen.getByRole("heading", { level: 1, name: "Chat" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Hello Margaret. I'm Tempo." })).toBeInTheDocument();
  expect(screen.getByText("I ask once before I act. Say STOP any time.")).toBeInTheDocument();
  const list = screen.getByRole("list", { name: "Things to try" });
  const groups = within(list).getAllByRole("listitem");
  expect(groups).toHaveLength(BEATS.length);
  expect(groups.map((g) => g.firstChild?.textContent)).toEqual(["A late train", "A missed engineer", "Is this a scam?", "What I remember", "Money back", "Money in my email", "Read a letter"]);
  const chips = within(list).getAllByRole("button");
  expect(chips.map((c) => c.textContent)).toEqual(SAMPLE_CHIPS);
  // The e2e test clicks this one by name.
  expect(screen.getByRole("button", { name: /08:12 Oxford to Paddington/ })).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("a chip goes through gateway.chat with the slots; the ask shows; Yes is answered through answerAsk and toasts", async () => {
  const { gateway, calls } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask, slots: { origin_crs: "OXF" } }));
  const { container, speak } = renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));

  const yes = await screen.findByRole("button", { name: "Yes, claim £14.20" });
  expect(calls.turns[0]).toMatchObject({ user_id: "u_margaret", display_name: "Margaret", text: RAIL_CHIP, language: "en", slots: {} });
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
  await waitFor(() => expect(calls.answered).toEqual([["r1", true]]));
  expect(meshMock.answered).toEqual([]); // this device does not sign: the bearer answers
  expect(await screen.findByText(FILED)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Yes, claim £14.20" })).not.toBeInTheDocument();
  expect(screen.getByText("Claim filed. Tempo will check for the money.")).toBeInTheDocument(); // the toast
  expect(screen.getByRole("button", { name: "Stop the mission" })).toBeInTheDocument(); // STOP is one tap away while it waits
  expect(chatStore.get().conversations[0]!.slots).toEqual({ origin_crs: "OXF" });
});

test("No is an answer too (answerAsk with false), and says nothing was sent", async () => {
  const { gateway, calls } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }));
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  await userEvent.click(await screen.findByRole("button", { name: "No" }));
  await waitFor(() => expect(calls.answered).toEqual([["r1", false]]));
  expect(calls.stopped).toEqual([]);
  expect(await screen.findAllByText("Stopped: you said no. Nothing was sent.")).toHaveLength(1);
  expect(screen.getByText("You said no. Nothing was sent.")).toBeInTheDocument(); // the toast
});

test("Yes on a case Tempo waits on purpose says so, not 'claim filed'", async () => {
  const { gateway } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }));
  const plan = { today: "2026-10-25", horizon: "2026-12-31", action_today: "wait", way: null, next_decision_on: "2026-11-19", days: [], rights: [], explanation: "", why: [], assumptions: { time_value_gbp_h: "18", attention_minutes_per_week: "10", hazard_id: "h", hazard_demo_values: true, pays_share: "0.28", pays_share_source: "demo" } };
  gateway.answer = async () => ({ ...RAIL, state: "waiting", ask: null, plan, message: "I'll wait for now. You can complain to Broadbandly from 19 November." });
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  await userEvent.click(await screen.findByRole("button", { name: "Yes, claim £14.20" }));
  expect(await screen.findByText("Saved. Tempo will wait on purpose until 19 November.")).toBeInTheDocument();
  expect(screen.queryByText("Claim filed. Tempo will check for the money.")).not.toBeInTheDocument();
});

test("on a device that signs, Yes goes to the passkey (mesh.answer), not the bearer", async () => {
  meshMock.signs = true;
  meshMock.view = { ...RAIL, state: "waiting", ask: null, message: FILED };
  const { gateway, calls } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }));
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  expect(await screen.findByText(/You'll confirm with Face ID or your fingerprint/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £14.20 with Face ID" }));
  await waitFor(() => expect(meshMock.answered).toEqual([["r1", true]]));
  expect(calls.answered).toEqual([]);
  expect(await screen.findByText(FILED)).toBeInTheDocument();
});

test("a typed yes that the Gateway sends back for Face ID keeps the ask on screen", async () => {
  const { gateway } = fakeGateway((turn) =>
    turn.text === "yes"
      ? { ...blank("approve", "Please confirm with Face ID or your fingerprint on this device."), mission: RAIL, ask: RAIL.ask }
      : { ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask },
  );
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  await screen.findByRole("button", { name: "Yes, claim £14.20" });
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "yes{enter}");
  expect(await screen.findByText("Please confirm with Face ID or your fingerprint on this device.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yes, claim £14.20" })).toBeInTheDocument();
  expect(screen.getByText("Confirm on the device that has your Face ID or fingerprint.")).toBeInTheDocument(); // the toast
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
  await expectNoA11yViolations(container);
  // Scam Shield's page is hidden (plan.md §19): its button opens the checker here instead.
  await userEvent.click(screen.getByRole("button", { name: "Open Scam Shield" }));
  expect(await screen.findByRole("heading", { name: "Check a message" })).toBeInTheDocument();
  // After L, the button is a link to the page again.
  act(() => reveal.set(true));
  expect(screen.getByRole("link", { name: "Open Scam Shield" })).toHaveAttribute("href", "#/shield");
});

test("by default a reply's button to Mission Control is left out: History shows the status instead", async () => {
  const { gateway } = fakeGateway(() => ({ ...blank("help", "Filed."), actions: [{ label: "Open Mission Control", href: "#/missions/m_1" }, { label: "Open Connectors", href: "#/connectors" }] }));
  renderChat(gateway);
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "What happened?{enter}");
  expect(await screen.findByRole("link", { name: "Open Connectors" })).toHaveAttribute("href", "#/connectors");
  expect(screen.queryByText("Open Mission Control")).not.toBeInTheDocument();
  act(() => reveal.set(true));
  expect(screen.getByRole("link", { name: "Open Mission Control" })).toHaveAttribute("href", "#/missions/m_1");
});

test("the chat's tools: the ten owed questions and the scam check open as cards in the conversation", async () => {
  const { gateway } = fakeGateway(() => blank("help", ""));
  const { container, speak } = renderChat(gateway);
  const tools = screen.getByRole("list", { name: "Chat tools" });
  expect(within(tools).getAllByRole("button").map((b) => b.textContent)).toEqual(["Upload a letter or PDF", "Am I owed anything?", "Is this a scam?"]);

  await userEvent.click(within(tools).getByRole("button", { name: "Am I owed anything?" }));
  expect(await screen.findByRole("heading", { name: "How old are you?" })).toBeInTheDocument();
  expect(screen.getByText(TOOL_INTRO.owed.text)).toBeInTheDocument();
  expect(speak).toHaveBeenCalledWith(TOOL_INTRO.owed.text);

  await userEvent.click(within(tools).getByRole("button", { name: "Is this a scam?" }));
  expect(await screen.findByRole("heading", { name: "Check a message" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "The Shield log" })).not.toBeInTheDocument(); // the page's log stays on the page
  expect(chatStore.get().conversations).toHaveLength(1);
  await expectNoA11yViolations(container);
});

test("a PDF from the paperclip is read by the Gateway's letter reader and read aloud", async () => {
  const reading = lettersJson.letters[0]!.reading;
  const sent: { filename: string; image_b64: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).endsWith("/letters/read")) return new Response("{}", { status: 404 });
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reading), { status: 200 });
  }) as typeof fetch;
  try {
    const { gateway } = fakeGateway(() => blank("help", ""));
    const { container, speak } = renderChat(gateway);
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(picker.accept).toContain("application/pdf");
    expect(screen.getByRole("button", { name: "Upload a letter, bill or PDF to read" })).toBeInTheDocument();
    await userEvent.upload(picker, new File(["%PDF-1.7"], "water bill.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("PDF to read: water bill.pdf")).toBeInTheDocument();
    await waitFor(() => expect(speak).toHaveBeenCalledWith(reading.reading_text));
    expect(sent[0]?.filename).toBe("water bill.pdf");
    expect(atob(sent[0]!.image_b64)).toBe("%PDF-1.7");
    expect(screen.queryByRole("link", { name: "Open Read It To Me" })).not.toBeInTheDocument();
  } finally {
    globalThis.fetch = original;
  }
});

test("suggestions become chips under the reply; a chip sends its text", async () => {
  const { gateway, calls } = fakeGateway((turn) =>
    turn.text === "Hello" ? { ...blank("smalltalk", "I'm Tempo."), suggestions: ["What do you remember about me?", "How much have you got back for me?"] } : blank("memory_recall", "Here's what I remember: you have a stammer."),
  );
  const { container } = renderChat(gateway);
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "Hello{enter}");
  const next = await screen.findByRole("list", { name: "You could say" });
  expect(within(next).getAllByRole("button").map((b) => b.textContent)).toEqual(["What do you remember about me?", "How much have you got back for me?"]);
  await expectNoA11yViolations(container);
  await userEvent.click(within(next).getByRole("button", { name: "What do you remember about me?" }));
  expect(await screen.findByText(/Here's what I remember/)).toBeInTheDocument();
  expect(calls.turns.map((t) => t.text)).toEqual(["Hello", "What do you remember about me?"]);
  // Only the newest reply offers chips.
  expect(screen.queryByRole("list", { name: "You could say" })).not.toBeInTheDocument();
});

test("three dots say Tempo is thinking while the turn is in flight", async () => {
  let release: (r: ChatReply) => void = () => undefined;
  const { gateway } = fakeGateway(() => new Promise<ChatReply>((resolve) => (release = resolve)));
  renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: "What do you remember about me?" }));
  expect(await screen.findByText("Tempo is thinking")).toBeInTheDocument();
  release(blank("memory_recall", "I don't remember anything about you yet."));
  expect(await screen.findByText("I don't remember anything about you yet.")).toBeInTheDocument();
  expect(screen.queryByText("Tempo is thinking")).not.toBeInTheDocument();
});

test("Gateway errors appear in the input's alert line in plain words", async () => {
  const { gateway } = fakeGateway(() => {
    throw new Error("POST /chat: HTTP 404");
  });
  renderChat(gateway);
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "Help{enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("This Gateway has no chat door yet (POST /chat is missing).");
});

test("a Gateway that does not answer gets the friendly line and a toast with a way to Settings", async () => {
  const { gateway } = fakeGateway(() => {
    throw new TypeError("Failed to fetch");
  });
  renderChat(gateway, { health: null, connected: false });
  expect(screen.getByText("NO GATEWAY")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Read this letter" }));
  const words = "I can't reach Tempo's Gateway. Check Settings, or switch to the showcase.";
  await waitFor(() => expect(screen.getAllByText(words).length).toBe(2)); // the chip's line and the toast
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(window.location.hash).toBe("#/settings");
});

test("the stream badge follows the live socket, not /health", () => {
  const { gateway } = fakeGateway(() => blank("help", ""));
  const { unmount } = renderChat(gateway, { connected: false });
  expect(screen.getByText("NO LIVE STREAM")).toBeInTheDocument();
  unmount();
  renderChat(gateway, { connected: true });
  expect(screen.getByText("LIVE STREAM")).toBeInTheDocument();
});

test("live events update the conversation that owns the mission; the money arriving offers what next", async () => {
  const { gateway } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask }));
  const { rerender, speak } = renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  await screen.findByRole("button", { name: "Yes, claim £14.20" });

  const props = { gateway, user: { id: "u_margaret", name: "Margaret", profileId: null }, showcase: false, health: null, language: "en" as const, params: {}, speak, setProfile: () => undefined };
  const state = { type: "state_changed", mission_id: "m_test1", from: "running", to: "waiting", at: "", latency_ms: 1200, actor: "agent" };
  rerender(
    <main>
      <ChatContainer {...props} events={[state]} config={{ url: "http://gw.test", token: "t" }} activeModels={["local"]} selectedModel="local" onSelectModel={() => undefined} />
      <Toaster />
    </main>,
  );
  expect(await screen.findByText("Waiting for the company · 1.2 s")).toBeInTheDocument();

  const outcome = { type: "outcome", mission_id: "m_test1", state: "verified", message: "GW has paid you £14.20.", amount_gbp: "14.20", reference: "GW-1" };
  rerender(
    <main>
      <ChatContainer {...props} events={[outcome, state]} config={{ url: "http://gw.test", token: "t" }} activeModels={["local"]} selectedModel="local" onSelectModel={() => undefined} />
      <Toaster />
    </main>,
  );
  expect(await screen.findByText("GW has paid you £14.20.")).toBeInTheDocument();
  expect(speak).toHaveBeenLastCalledWith("GW has paid you £14.20.");
  expect(screen.queryByRole("button", { name: "Yes, claim £14.20" })).not.toBeInTheDocument();
  expect(screen.getByText("Money arrived: £14.20.")).toBeInTheDocument();
  const next = screen.getByRole("list", { name: "You could say" });
  expect(within(next).getAllByRole("button").map((b) => b.textContent)).toEqual([...SUGGESTIONS.paid]);
});

test("#/chat?say= sends the sentence once (even in StrictMode), in a fresh chat, then clears the address", async () => {
  const { gateway, calls } = fakeGateway(() => blank("memory_recall", "I don't remember anything about you yet."));
  chatStore.appendTo(chatStore.ensureActive("Earlier"), [{ id: "x", role: "user", text: "Earlier chat" }]);
  window.location.hash = `#/chat?say=${encodeURIComponent("What do you remember about me?")}`;
  renderChat(gateway, {}, true);
  expect(await screen.findByText("I don't remember anything about you yet.")).toBeInTheDocument();
  expect(calls.turns.map((t) => t.text)).toEqual(["What do you remember about me?"]);
  expect(window.location.hash).toBe("#/chat");
  expect(chatStore.get().conversations).toHaveLength(2);
  expect(screen.queryByText("Earlier chat")).not.toBeInTheDocument();
});

test("conversations survive a reload (without audio), capped, and erase clears them", async () => {
  const { gateway } = fakeGateway(() => ({ ...blank("rail_delay", RAIL.message!), mission: RAIL, ask: RAIL.ask, suggestions: ["Show me my profiles"] }));
  const { unmount } = renderChat(gateway);
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  await screen.findByRole("button", { name: "Yes, claim £14.20" });
  chatStore.appendTo(chatStore.get().activeId!, [{ id: "a", role: "user", text: "Voice message", audio: { url: "blob:gone", durationMs: 900 } }]);
  unmount();

  const saved = JSON.parse(localStorage.getItem(STORE_KEY)!);
  expect(saved.conversations).toHaveLength(1);
  expect(saved.conversations[0].messages.at(-1).audio).toBeUndefined();

  chatStore.reload();
  renderChat(gateway);
  expect(screen.getByText(RAIL.message!)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yes, claim £14.20" })).toBeInTheDocument();

  // The Gateway still lists the same mission: it is not added a second time, and a change is picked up.
  chatStore.syncMissions([{ ...RAIL }]);
  expect(chatStore.get().conversations).toHaveLength(1);
  chatStore.syncMissions([{ ...RAIL, state: "waiting", ask: null }]);
  expect(chatStore.get().conversations[0]).toMatchObject({ missionState: "waiting", ask: null });
  // A Gateway with no such mission (a fresh demo): nothing is left waiting or stoppable.
  chatStore.syncMissions([]);
  expect(chatStore.get().conversations[0]).toMatchObject({ missionState: null, ask: null, status: null });

  for (let i = 0; i < MAX_CONVERSATIONS + 5; i++) {
    chatStore.newChat();
    chatStore.ensureActive(`chat ${i}`);
  }
  expect(JSON.parse(localStorage.getItem(STORE_KEY)!).conversations).toHaveLength(MAX_CONVERSATIONS);

  chatStore.eraseAll();
  chatStore.reload();
  expect(chatStore.get().conversations).toEqual([]);
});

test("on a phone the avatar is a strip at the top: a small face, the name, the mode and the speaker; axe-clean", async () => {
  setWide(false);
  const { gateway } = fakeGateway(() => blank("help", ""));
  const { container } = renderChat(gateway);
  const strip = screen.getByRole("complementary", { name: "Tempo's voice and face" });
  expect(within(strip).queryByLabelText("Who is speaking")).not.toBeInTheDocument();
  expect(within(strip).getByRole("button", { name: /Read the last reply aloud/ })).toBeInTheDocument();
  expect(within(strip).getByText("Tempo")).toBeInTheDocument();
  expect(within(strip).getByRole("button", { name: /Reply mode: Avatar/ })).toBeInTheDocument();
  expect(within(strip).getByRole("button", { name: /Volume/ })).toBeInTheDocument();
  expect(within(strip).getByText("LIVE STREAM")).toBeInTheDocument(); // read out in full, shown short
  expect(screen.queryByRole("separator", { name: "Resize avatar panel" })).not.toBeInTheDocument();
  await userEvent.click(within(strip).getByRole("button", { name: /Reply mode: Avatar/ }));
  expect(within(strip).getByRole("button", { name: /Reply mode: Voice/ })).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("on a desktop the full avatar panel stays beside the conversation; the stream badge sits in a row above the thread", async () => {
  setWide(true);
  const { gateway } = fakeGateway(() => blank("help", "I can help."));
  renderChat(gateway);
  expect(screen.getByLabelText("Who is speaking")).toBeInTheDocument();
  expect(screen.getByRole("separator", { name: "Resize avatar panel" })).toBeInTheDocument();
  // In the flow (not floating over the thread): a row with the conversation's title, before the log.
  const row = screen.getByText("LIVE STREAM").closest("[role=status]")!.parentElement!;
  expect(row).toHaveTextContent("New conversation");
  await userEvent.click(screen.getByRole("button", { name: "Read this letter" }));
  expect(await screen.findByText("I can help.")).toBeInTheDocument();
  expect(row).toHaveTextContent("Read this letter");
  expect(row.compareDocumentPosition(screen.getByRole("log", { name: "Conversation" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("in the showcase, help offers the four samples and a profile that may not claim refuses before asking", async () => {
  const gateway = new ShowcaseGateway();
  const { unmount } = renderChat(gateway, { showcase: true, health: null, connected: false });
  await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "Help{enter}");
  const next = await screen.findByRole("list", { name: "You could say" });
  expect(within(next).getAllByRole("button").map((b) => b.textContent)).toEqual([...SUGGESTIONS.doors]);
  unmount();

  chatStore.reset();
  renderChat(gateway, { showcase: true, health: null, connected: false, user: { id: "u_margaret", name: "Margaret", profileId: "read-it-to-me" } });
  await userEvent.click(screen.getByRole("button", { name: RAIL_CHIP }));
  expect(await screen.findByText("Your profile, Read It To Me, doesn't let me file a claim or accept cash, so I haven't started. Choose another profile if you want me to file a claim.")).toBeInTheDocument();
  expect(screen.queryByText("Tempo is asking you")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Show my profiles" })).toHaveAttribute("href", "#/profiles");
  expect(screen.getByRole("button", { name: "Show me my profiles" })).toBeInTheDocument();
});

test("the chat names the Gateway's real model, not a picker that chooses nothing", () => {
  const base: Health = { status: "ok", mode: "replay", demo: true, simulated: ["company"], deploy: "cloud-apis", region: "eu", third_parties: [] };
  expect(gatewayModelWords({ ...base, model: { kind: "apis", name: "gemini-3.5-flash-lite", processor: "Google Gemini" } })).toBe("Google Gemini");
  expect(gatewayModelWords({ ...base, model: { kind: "runpod-vllm", name: "tempo-private", processor: "RunPod" } })).toBe("our model, RunPod GPU");
  expect(gatewayModelWords({ ...base, model: null })).toBeNull(); // an older Gateway: the picker stays
  expect(gatewayModelWords(null)).toBeNull();
});

test("pressing the mic stops Tempo talking but never mutes it: the next reply is still read aloud", async () => {
  // jsdom has no voices: a stand-in records what the browser's own voice would say.
  const said: string[] = [];
  class Utterance {
    text: string;
    lang = "";
    rate = 1;
    pitch = 1;
    volume = 1;
    voice = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = { speaking: false, paused: false, speak: (u: Utterance) => void said.push(u.text), cancel: () => undefined, pause: () => undefined, resume: () => undefined, getVoices: () => [], addEventListener: () => undefined, removeEventListener: () => undefined };
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", synth);
  try {
    const { gateway } = fakeGateway((turn) => blank("smalltalk", turn.text === "One" ? "First reply." : "Second reply."));
    const tree = (speak: (text: string) => void) => (
      <ChatContainer
        gateway={gateway}
        user={{ id: "u_margaret", name: "Margaret", profileId: null }}
        showcase={false}
        health={null}
        connected={false}
        events={[]}
        language="en"
        params={{}}
        speak={speak}
        setProfile={() => undefined}
        config={{ url: "http://gw.test", token: "t" }}
        activeModels={["local"]}
        selectedModel="local"
        onSelectModel={() => undefined}
      />
    );
    render(tree((text) => chatStore.setSpeech({ id: crypto.randomUUID(), text })));
    const box = screen.getByRole("textbox", { name: "Your message" });
    await userEvent.type(box, "One{enter}");
    await waitFor(() => expect(said).toContain("First reply."));
    await userEvent.click(screen.getByRole("button", { name: /Speak your message|Record a voice clip/ }));
    await userEvent.click(screen.queryByRole("button", { name: "Stop recording" }) ?? document.body);
    await userEvent.type(screen.getByRole("textbox", { name: "Your message" }), "Two{enter}");
    await waitFor(() => expect(said).toContain("Second reply."));
  } finally {
    vi.unstubAllGlobals();
  }
});

