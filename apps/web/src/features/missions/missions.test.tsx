import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import MissionsPage from "./MissionsPage";

function props(gateway: ShowcaseGateway, params: Record<string, string> = {}): PageProps {
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

beforeEach(() => {
  window.location.hash = "";
});

test("Mission Control lists the three recorded missions with the ledger, and is axe-clean", async () => {
  const gateway = new ShowcaseGateway();
  const { container } = render(
    <main>
      <MissionsPage {...props(gateway)} />
    </main>,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Mission Control" })).toBeInTheDocument();
  const list = await screen.findByRole("list", { name: "Missions" });
  const items = within(list).getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(within(items[0]!).getByText("Missed engineer visit")).toBeInTheDocument();
  expect(within(items[0]!).getByText("Waiting for your OK")).toBeInTheDocument();
  expect(within(items[1]!).getByText("Delay Repay")).toBeInTheDocument();
  expect(within(items[2]!).getByText("Money arrived")).toBeInTheDocument();
  expect(within(items[2]!).getByText("Amir")).toBeInTheDocument();
  const ledger = screen.getByRole("region", { name: "Time Ledger" });
  expect(within(ledger).getByText("0.3")).toBeInTheDocument();
  expect(within(ledger).getByText("£28.40")).toBeInTheDocument();
  expect(within(ledger).getByText("Counted only once the money arrived.")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("Start Margaret's claim adds a mission and opens it", async () => {
  const gateway = new ShowcaseGateway();
  render(
    <main>
      <MissionsPage {...props(gateway)} />
    </main>,
  );
  await screen.findByRole("list", { name: "Missions" });
  await userEvent.click(screen.getByRole("button", { name: "Start Margaret's claim" }));
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/missions\/m_/));
  expect(await gateway.missions()).toHaveLength(4);
});

test("the detail shows the consent card, Proof Trace, the Court and the timeline; Yes moves the mission on", async () => {
  const gateway = new ShowcaseGateway();
  const rail = (await gateway.missions()).find((m) => m.skill_id?.includes("rail"))!;
  const p = props(gateway, { id: rail.id });
  const { container, rerender } = render(
    <main>
      <MissionsPage {...p} />
    </main>,
  );
  expect(await screen.findByRole("button", { name: "Yes, claim £14.20" })).toBeInTheDocument();
  expect(screen.getByText("Proof Trace")).toBeInTheDocument();
  expect(screen.getByText("Consensus Court")).toBeInTheDocument();
  expect(screen.getAllByText("claude-sonnet-5-5").length).toBeGreaterThan(0);
  expect(screen.getByText("Timeline")).toBeInTheDocument();
  expect(screen.getByText("Agent Passport")).toBeInTheDocument();
  expect(screen.getByText(/Tempo Mesh .* is not in this UI/)).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "published source" })[0]).toHaveAttribute("href", expect.stringContaining("gwr.com"));
  await expectNoA11yViolations(container);

  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £14.20" }));
  expect(await screen.findByRole("button", { name: "Check the payment now" })).toBeInTheDocument();
  expect(screen.getAllByText("Waiting for the company").length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole("button", { name: "Check the payment now" }));
  expect(await screen.findByText(/has paid you £14.20/)).toBeInTheDocument();
  rerender(
    <main>
      <MissionsPage {...p} />
    </main>,
  );
  expect(p.speak).toHaveBeenCalledWith(expect.stringContaining("paid you £14.20"));
});

test("the broadband mission shows the Rights Portfolio waiting on purpose, and the clock jump makes it act", async () => {
  const gateway = new ShowcaseGateway();
  const ofcom = (await gateway.missions()).find((m) => m.skill_id?.includes("ofcom"))!;
  render(
    <main>
      <MissionsPage {...props(gateway, { id: ofcom.id })} />
    </main>,
  );
  expect(await screen.findByText("Waiting, on purpose")).toBeInTheDocument();
  expect(screen.getByText("Complain to Broadbandly")).toBeInTheDocument();
  expect(screen.getAllByText("demo values").length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £32.31" }));
  const jump = await screen.findByRole("button", { name: "Jump ahead 31 days" });
  expect(screen.getByRole("button", { name: "The credit arrives" })).toBeInTheDocument();
  await userEvent.click(jump);
  expect(await screen.findByText("Acting now")).toBeInTheDocument();
  expect(screen.getByText(/The demo clock moved 31 days ahead/)).toBeInTheDocument();
});

test("reading Margaret's card asks the one read-back question, and Yes starts the broadband case", async () => {
  const gateway = new ShowcaseGateway();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }));
  render(
    <main>
      <MissionsPage {...props(gateway)} />
    </main>,
  );
  await screen.findByRole("list", { name: "Missions" });
  await userEvent.click(screen.getByRole("button", { name: "Read Margaret's missed-visit card" }));
  expect(await screen.findByText(/I read the date of the missed visit as 19 October 2026/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, that's right" }));
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/missions\/m_/));
  expect((await gateway.missions())[0]!.skill_id).toContain("ofcom");
  fetchSpy.mockRestore();
});
