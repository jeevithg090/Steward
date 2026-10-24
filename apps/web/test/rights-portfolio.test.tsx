import { render, screen, within } from "@testing-library/react";
import { HonestyBadge } from "@/components/HonestyBadge";
import { RightsPortfolio, span, verdict } from "@/components/RightsPortfolio";
import type { PlanView } from "@/lib/api";

const PLAN: PlanView = {
  today: "2026-10-25",
  horizon: "2027-04-23",
  action_today: "wait",
  way: null,
  next_decision_on: "2026-11-18",
  days: [{ day: "2026-10-25", best: "wait", value_gbp: "28.97", value_at_risk_gbp: "11.25", cost_of_delay_gbp: "0" }],
  rights: [
    {
      id: "ofcom.complaint", label: "Complain to Broadbandly", status: "opens_later", opens_on: "2026-11-18",
      expires_on: null, unlocked_by: [], ev_gbp: "27.2635", best_way: "tempo_calls",
    },
    {
      id: "telecoms.ombudsman", label: "Go to the ombudsman", status: "locked", opens_on: null,
      expires_on: null, unlocked_by: ["complaint_sent"], ev_gbp: "19.29", best_way: "tempo_refers",
    },
  ],
  explanation: "I'll wait for now. You can complain to Broadbandly from 18 November.",
  why: ["31% of cases like this are paid without a fight by 18 November", "An open problem costs you about 2 minutes a week"],
  assumptions: {
    time_value_gbp_h: "18", attention_minutes_per_week: "2", hazard_id: "nyc311.hpd.all",
    hazard_demo_values: true, pays_share: "0.53", pays_share_source: "FCA H1 2026",
  },
};

test("RightsPortfolio says why it waits, and what's at stake", () => {
  render(<RightsPortfolio plan={PLAN} />);

  expect(screen.getByText("Waiting, on purpose")).toBeInTheDocument();
  expect(screen.getByText(PLAN.explanation)).toBeInTheDocument();
  expect(screen.getByText("£11.25")).toBeInTheDocument();
  expect(screen.getByText(/Next decision/)).toHaveTextContent("18 November");
  expect(screen.getByText(/a stand-in, not this company's own data/)).toBeInTheDocument();
});

test("each right is a bar in time, and a locked one says what unlocks it", () => {
  render(<RightsPortfolio plan={PLAN} />);

  const bars = screen.getAllByRole("img");
  expect(bars).toHaveLength(2);
  expect(bars[0]).toHaveAccessibleName("Complain to Broadbandly: opens later, opens on 18 November");
  expect(bars[1]).toHaveAccessibleName("Go to the ombudsman: locked until complaint sent");
  const list = screen.getAllByRole("listitem")[0]!;
  expect(within(list).getByText(/worth £27.26/)).toBeInTheDocument();
});

test("a bar starts on the day its right opens", () => {
  const { left, width } = span(PLAN, PLAN.rights[0]!);

  expect(Math.round(left)).toBe(13); // 24 of 180 days in
  expect(Math.round(left + width)).toBe(100); // no deadline: it runs to the horizon
});

test("the verdict names acting and dropping too", () => {
  expect(verdict({ ...PLAN, action_today: "ofcom.complaint" })).toBe("Acting now");
  expect(verdict({ ...PLAN, action_today: "drop" })).toBe("Not worth chasing");
});

test("HonestyBadge says when the demo clock has moved", () => {
  render(<HonestyBadge health={{ status: "ok", mode: "replay", demo: true, simulated: ["company"], clock_offset_days: 31 }} />);

  expect(screen.getByRole("status")).toHaveTextContent("DEMO CLOCK +31 DAYS");
});
