import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentCard, AgentCards, RAIL_TEAM, budgetPercent } from "@/components/AgentCards";
import { ConsentCard } from "@/components/ConsentCard";
import { HonestyBadge } from "@/components/HonestyBadge";
import { MissionTimeline, duration } from "@/components/MissionTimeline";
import { ProofTrace } from "@/components/ProofTrace";
import { StallRadar } from "@/components/StallRadar";
import type { ConsentAsk, MissionView, ProofTraceData } from "@/lib/api";

const TRACE: ProofTraceData = {
  id: "pt_m_1",
  amount_gbp: "14.20",
  steps: [
    {
      fact_keys: ["arrival_delay_min", "fare_gbp"],
      rule_id: "uk-rail.gwr.delay-repay",
      rule_version: "0.1.0",
      citation_url: "https://www.gwr.com/help-and-support/refunds-and-compensation/delay-repay",
      explanation: "38 min late → 50% of £28.40 under GWR DR15",
    },
  ],
};

test("ProofTrace renders citation link", () => {
  render(<ProofTrace trace={TRACE} />);

  const link = screen.getByRole("link", { name: "published source" });
  expect(link).toHaveAttribute("href", TRACE.steps[0]!.citation_url);
  expect(screen.getByText("38 min late → 50% of £28.40 under GWR DR15")).toBeInTheDocument();
  expect(screen.getByText("£14.20")).toBeInTheDocument();
});

test("HonestyBadge visible when TEMPO_DEMO", () => {
  render(<HonestyBadge health={{ status: "ok", mode: "live", demo: true, simulated: ["company"] }} />);

  expect(screen.getByRole("status")).toHaveTextContent("LIVE call · SIMULATED COMPANY");
});

test("HonestyBadge says replay data is replayed", () => {
  render(<HonestyBadge health={{ status: "ok", mode: "replay", demo: false, simulated: ["company", "rail data"] }} />);

  expect(screen.getByRole("status")).toHaveTextContent("REPLAY data · SIMULATED COMPANY");
});

test("HonestyBadge hides when nothing is simulated", () => {
  const { container } = render(<HonestyBadge health={{ status: "ok", mode: "live", demo: false, simulated: [] }} />);

  expect(container).toBeEmptyDOMElement();
});

test("AgentCard shows budget %", () => {
  const claims = { ...RAIL_TEAM.find((a) => a.role === "Claims")!, spentGbp: 0.03 };

  render(<ul><AgentCard agent={claims} state="active" /></ul>);

  expect(budgetPercent(claims)).toBe(30);
  expect(screen.getByText(/budget 30% of £0.10/)).toBeInTheDocument();
  expect(screen.getByRole("listitem")).toHaveAttribute("aria-current", "step");
});

test("AgentCards mark the active agent and the finished ones", () => {
  render(<AgentCards state="awaiting_consent" reached={["understood", "planned", "appraised", "awaiting_consent"]} />);

  const consent = screen.getByText("Consent").closest("li")!;
  const intake = screen.getByText("Intake").closest("li")!;
  const watchdog = screen.getByText("Watchdog").closest("li")!;
  expect(consent).toHaveTextContent("● working");
  expect(intake).toHaveTextContent("✓ done");
  expect(watchdog).toHaveTextContent("waiting");
});

test("MissionTimeline shows how long each stage lasted", () => {
  const mission = {
    id: "m_1", state: "running", message: null, ask: null, outcome: null,
    timeline: [
      { to: "understood", at: "", latency_ms: 12 },
      { to: "awaiting_consent", at: "", latency_ms: 3 },
      { to: "running", at: "", latency_ms: 8111 }, // the person took 8.1 s to approve
    ],
  } as MissionView;

  render(<MissionTimeline mission={mission} />);

  expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Understood the journey3 ms",
    "Waiting for your OK8.1 s",
    "Acting for younow",
  ]);
});

test("durations read naturally", () => {
  expect([duration(950), duration(8111), duration(185_000)]).toEqual(["950 ms", "8.1 s", "3 min"]);
});

test("ConsentCard answers yes or no", async () => {
  const ask: ConsentAsk = { request_id: "r1", summary: "Shall I claim £14.20 for you?", amount_gbp: "14.20", proof_trace: TRACE };
  const answers: boolean[] = [];

  render(<ConsentCard ask={ask} busy={false} onAnswer={(yes) => answers.push(yes)} />);
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £14.20" }));
  await userEvent.click(screen.getByRole("button", { name: "No" }));

  expect(answers).toEqual([true, false]);
});

test("StallRadar shows the tactic, the quote and the counter-play", () => {
  render(
    <StallRadar
      events={[
        { type: "state_changed", mission_id: "m_1" },
        { type: "log_stall", category: "hold_extension", quote: "Please continue to hold.", counter: "Log the minutes." },
      ]}
    />,
  );

  expect(screen.getByText("hold extension")).toBeInTheDocument();
  expect(screen.getByText("“Please continue to hold.”")).toBeInTheDocument();
  expect(screen.getByText("→ Log the minutes.")).toBeInTheDocument();
});
