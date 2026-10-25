import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forgetAmounts } from "@/components/mission";
import { Toaster, toast } from "@/components/ui";
import { Gateway, type MissionView } from "@/lib/api";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import MissionsPage from "./MissionsPage";

function props(gateway: Gateway, params: Record<string, string> = {}): PageProps {
  return {
    gateway,
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase: true,
    health: { status: "ok", mode: "replay", demo: true, simulated: ["company", "rail data", "jurors", "vision"], deploy: "cloud-standard", region: "eu", third_parties: [] },
    events: [],
    language: "en",
    params,
    speak: vi.fn(),
    setProfile: () => undefined,
  };
}

function renderPage(p: PageProps) {
  return render(
    <main>
      <MissionsPage {...p} />
      <Toaster />
    </main>,
  );
}

beforeEach(() => {
  window.location.hash = "";
  toast.clear();
  forgetAmounts();
});

test("Mission Control lists Margaret's missions by default, Everyone adds Amir's, and is axe-clean", async () => {
  const gateway = new ShowcaseGateway();
  const { container } = renderPage(props(gateway));
  expect(screen.getByRole("heading", { level: 1, name: "Mission Control" })).toBeInTheDocument();
  const list = await screen.findByRole("list", { name: "Missions" });
  let items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(within(items[0]!).getByText("Missed engineer visit")).toBeInTheDocument();
  expect(within(items[0]!).getByText("Waiting for your OK")).toBeInTheDocument();
  expect(within(items[0]!).getByText("waiting on purpose")).toBeInTheDocument(); // live, so the plan shows
  expect(within(items[1]!).getByText("Delay Repay")).toBeInTheDocument();
  // Each card is one big link that says what it is and how far along.
  expect(within(items[1]!).getByRole("link")).toHaveAccessibleName("Delay Repay for Margaret, £14.20: Waiting for your OK");
  expect(screen.getByRole("button", { name: "Margaret" })).toHaveAttribute("aria-pressed", "true");

  await userEvent.click(screen.getByRole("button", { name: "Everyone" }));
  items = within(screen.getByRole("list", { name: "Missions" })).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(within(items[2]!).getByText("Money arrived")).toBeInTheDocument();
  expect(within(items[2]!).getByText("Amir")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /^Finished/ }));
  items = within(screen.getByRole("list", { name: "Missions" })).getAllByRole("listitem");
  expect(items).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: /^Live/ }));
  expect(within(screen.getByRole("list", { name: "Missions" })).getAllByRole("listitem")).toHaveLength(2);

  const ledger = screen.getByRole("region", { name: "Time Ledger" });
  expect(within(ledger).getByText("0.3")).toBeInTheDocument();
  expect(within(ledger).getByText("£28.40")).toBeInTheDocument();
  expect(within(ledger).getByText("Counted only once the money arrived.")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("a finished mission shows no plan badge, and a message that leaks code is said plainly", async () => {
  const gateway = new ShowcaseGateway();
  const [ofcom, rail] = await gateway.missions();
  gateway.missions = async () => [
    { ...ofcom!, state: "declined", ask: null, message: "Stopped: you said no. Nothing was sent." },
    { ...rail!, state: "failed_safe", ask: null, message: "I couldn't find that train in the rail records (no recorded journey for ('OXF', 'PAD', datetime.date(2026, 10, 24), '0812'))." },
  ];
  renderPage(props(gateway));
  const list = await screen.findByRole("list", { name: "Missions" });
  expect(within(list).queryByText("waiting on purpose")).not.toBeInTheDocument();
  expect(within(list).getByText("Stopped safely: Tempo couldn't confirm the journey.")).toBeInTheDocument();
  expect(screen.queryByText(/datetime/)).not.toBeInTheDocument();
});

test("while the list loads it keeps its shape; with no missions it offers to start Margaret's claim", async () => {
  const gateway = new ShowcaseGateway();
  let release: (m: MissionView[]) => void = () => undefined;
  gateway.missions = () => new Promise<MissionView[]>((resolve) => (release = resolve));
  renderPage(props(gateway));
  expect(screen.getByRole("status", { name: "Loading missions" })).toBeInTheDocument();
  release([]);
  expect(await screen.findByText("No missions yet")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Start Margaret's claim" })).toHaveLength(2);
});

test("a Gateway that does not answer says so in plain words, with Try again and Settings", async () => {
  const gateway = new Gateway({ url: "http://gw.test", token: "t" });
  gateway.missions = async () => {
    throw new TypeError("Failed to fetch");
  };
  gateway.ledger = async () => ({ minutes_returned: "0", hours_returned: "0", gbp_recovered: "0.00" });
  renderPage(props(gateway));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("I can't reach Tempo's Gateway. Check Settings, or switch to the showcase.");
  expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(within(alert).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "#/settings");
});

test("Start Margaret's claim adds a mission, opens it and says so", async () => {
  const gateway = new ShowcaseGateway();
  renderPage(props(gateway));
  await screen.findByRole("list", { name: "Missions" });
  await userEvent.click(screen.getByRole("button", { name: "Start Margaret's claim" }));
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/missions\/m_/));
  expect(await gateway.missions()).toHaveLength(4);
  expect(await screen.findByText("Margaret's claim has started. Tempo will ask before it acts.")).toBeInTheDocument();
});

test("the detail: a sticky header with STOP, then the ask, Proof Trace, Court, Passport and timeline; Yes and the payment check toast", async () => {
  const gateway = new ShowcaseGateway();
  const rail = (await gateway.missions()).find((m) => m.skill_id?.includes("rail"))!;
  const p = props(gateway, { id: rail.id });
  const { container, rerender } = renderPage(p);
  expect(await screen.findByRole("button", { name: "Yes, claim £14.20" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Delay Repay for Margaret" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All missions" })).toHaveAttribute("href", "#/missions");
  // The sections, in order.
  const text = container.textContent ?? "";
  const order = ["Tempo is asking you", "Proof Trace", "Consensus Court", "Agent Passport", "Timeline"].map((t) => text.indexOf(t));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(screen.getAllByText("claude-sonnet-5-5").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("link", { name: "published source" })[0]).toHaveAttribute("href", expect.stringContaining("gwr.com"));
  await expectNoA11yViolations(container);

  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £14.20" }));
  expect(await screen.findByRole("button", { name: "Check the payment now" })).toBeInTheDocument();
  expect(screen.getByText("Claim filed. Tempo will check for the money.")).toBeInTheDocument();
  expect(screen.getAllByText("Waiting for the company").length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole("button", { name: "Check the payment now" }));
  expect(await screen.findByText(/has paid you £14.20/)).toBeInTheDocument();
  expect(screen.getByText("Money arrived: £14.20.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument(); // nothing left to stop
  rerender(
    <main>
      <MissionsPage {...p} />
      <Toaster />
    </main>,
  );
  expect(p.speak).toHaveBeenCalledWith(expect.stringContaining("paid you £14.20"));
});

test("without demo mode the payment check stays (it only fires due checks); the clock and credit buttons go", async () => {
  const gateway = new ShowcaseGateway();
  const ofcom = (await gateway.missions()).find((m) => m.skill_id?.includes("ofcom"))!;
  const p = props(gateway, { id: ofcom.id });
  renderPage({ ...p, health: { ...p.health!, demo: false } });
  await userEvent.click(await screen.findByRole("button", { name: "Yes, claim £32.31" }));
  const check = await screen.findByRole("button", { name: "Check the payment now" });
  expect(screen.queryByRole("button", { name: "Jump ahead 31 days" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "The credit arrives" })).not.toBeInTheDocument();
  await userEvent.click(check);
  // Waiting on purpose: its timer is weeks away, so nothing fired.
  expect(await screen.findByText("Not due yet: Tempo checks on the day it said.")).toBeInTheDocument();
});

test("Stop on the detail stops the mission and says so", async () => {
  const gateway = new ShowcaseGateway();
  const rail = (await gateway.missions()).find((m) => m.skill_id?.includes("rail"))!;
  renderPage(props(gateway, { id: rail.id }));
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
  expect(await screen.findByText("Stopped. Nothing more will be sent.")).toBeInTheDocument();
  expect((await gateway.mission(rail.id)).state).toBe("declined");
});

test("the broadband mission waits on purpose; the clock jump makes it act and shows the demo clock", async () => {
  const gateway = new ShowcaseGateway();
  const ofcom = (await gateway.missions()).find((m) => m.skill_id?.includes("ofcom"))!;
  renderPage(props(gateway, { id: ofcom.id }));
  expect(await screen.findByText("Waiting, on purpose")).toBeInTheDocument();
  expect(screen.getByText("Complain to Broadbandly")).toBeInTheDocument();
  expect(screen.getAllByText("demo values").length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £32.31" }));
  const jump = await screen.findByRole("button", { name: "Jump ahead 31 days" });
  // Waiting on purpose is not a filed claim: the toast says what happened.
  expect(screen.getByText("Saved. Tempo will wait on purpose until 19 November.")).toBeInTheDocument();
  expect(screen.queryByText("Claim filed. Tempo will check for the money.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "The credit arrives" })).toBeInTheDocument();
  await userEvent.click(jump);
  expect(await screen.findByText("Acting now")).toBeInTheDocument();
  expect(screen.getByText(/The demo clock moved 31 days ahead/)).toBeInTheDocument();
  expect(screen.getAllByText(/Demo clock \+31 days/).length).toBeGreaterThan(0);

  // The money arrives: the portfolio is settled, not "Acting now" with money at stake.
  await userEvent.click(screen.getByRole("button", { name: "Check the payment now" }));
  expect(await screen.findByText("Settled")).toBeInTheDocument();
  expect(screen.getByText("Paid £32.31 on 24 November. Nothing more to do.")).toBeInTheDocument();
  expect(screen.queryByText("Acting now")).not.toBeInTheDocument();
  expect(screen.queryByText("At stake if you do nothing")).not.toBeInTheDocument();
  expect(screen.getByText("What Tempo weighed")).toBeInTheDocument();
});

test("a waiting rail mission keeps its amount on the list after Yes (from the ask this page saw)", async () => {
  const gateway = new ShowcaseGateway();
  const { unmount } = renderPage(props(gateway));
  const list = await screen.findByRole("list", { name: "Missions" });
  expect(within(list).getByRole("link", { name: /^Delay Repay for Margaret, £14\.20: Waiting for your OK$/ })).toBeInTheDocument();
  unmount();
  const rail = (await gateway.missions()).find((m) => m.skill_id?.includes("rail"))!;
  const waiting = await gateway.answer(rail.ask!.request_id, true);
  expect(waiting.ask).toBeNull(); // the Gateway's waiting view carries no amount of its own
  renderPage(props(gateway));
  const after = await screen.findByRole("list", { name: "Missions" });
  expect(within(after).getByRole("link", { name: /^Delay Repay for Margaret, £14\.20: Waiting for the company$/ })).toBeInTheDocument();
});

test("the credit arriving is confirmed", async () => {
  const gateway = new ShowcaseGateway();
  const ofcom = (await gateway.missions()).find((m) => m.skill_id?.includes("ofcom"))!;
  renderPage(props(gateway, { id: ofcom.id }));
  await userEvent.click(await screen.findByRole("button", { name: "Yes, claim £32.31" }));
  await userEvent.click(await screen.findByRole("button", { name: "The credit arrives" }));
  expect(await screen.findByText("The credit has arrived. The next check will find it.")).toBeInTheDocument();
});

test("reading Margaret's card asks the one read-back question, and Yes starts the broadband case", async () => {
  const gateway = new ShowcaseGateway();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }));
  renderPage(props(gateway));
  await screen.findByRole("list", { name: "Missions" });
  await userEvent.click(screen.getByRole("button", { name: "Read Margaret's missed-visit card" }));
  expect(await screen.findByText(/I read the date of the missed visit as 19 October 2026/)).toBeInTheDocument();
  expect(screen.getByText("Tempo read the card. One thing to check.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, that's right" }));
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/missions\/m_/));
  expect((await gateway.missions())[0]!.skill_id).toContain("ofcom");
  expect(await screen.findByText("Thanks. The broadband case has started.")).toBeInTheDocument();
  fetchSpy.mockRestore();
});

test("a failed action says what went wrong in a toast", async () => {
  const gateway = new ShowcaseGateway();
  const ofcom = (await gateway.missions()).find((m) => m.skill_id?.includes("ofcom"))!;
  gateway.stop = async () => {
    throw new Error("POST /missions/x/stop: HTTP 500");
  };
  renderPage(props(gateway, { id: ofcom.id }));
  await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The Gateway hit a problem. Try again in a moment.");
});
