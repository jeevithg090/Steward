import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MissionView } from "@/lib/api";
import railJson from "@/showcase/mission-rail-verified.json";
import { expectNoA11yViolations } from "@/test/a11y";
import { ConsentCard } from "./ConsentCard";
import { CourtVotes } from "./CourtVotes";
import { MissionTimeline } from "./MissionTimeline";
import ofcomVerifiedJson from "@/showcase/mission-ofcom-verified.json";
import ofcomWaitingJson from "@/showcase/mission-ofcom-waiting.json";
import railWaitingJson from "@/showcase/mission-rail-waiting.json";
import { forgetAmounts, rememberAmount } from "./amounts";
import { RightsPortfolio } from "./RightsPortfolio";
import { afterYes, duration, firstSentence, isLive, missionAmount, plainError, plainMessage, skillWords, stateTone } from "./words";

const rail = railJson as unknown as MissionView;

test("the Court says when it was not needed, and lists absent jurors as dashed", () => {
  const { rerender } = render(<CourtVotes court={null} />);
  expect(screen.getByText("Not needed: the rule is clear, so no models were asked.")).toBeInTheDocument();
  rerender(<CourtVotes court={{ outcome: "proceed_flagged", eligible: true, agreement_rate: 0.67, verdicts: [{ juror: "a", verdict: { eligible: true, rule_id: "r", confidence: 0.8 } }, { juror: "b", verdict: { eligible: false, rule_id: "r", confidence: 0.6 } }], absent: ["c"], flags: ["one juror disagreed"] }} />);
  expect(screen.getByText("67% agreement")).toBeInTheDocument();
  expect(screen.getByText("absent")).toBeInTheDocument();
  expect(screen.getByText("Agreed, with a flag")).toBeInTheDocument();
  expect(screen.getByText("· one juror disagreed")).toBeInTheDocument();
});

test("the consent card labels Yes with the exact amount and flags demo values", async () => {
  const onAnswer = vi.fn();
  const { container } = render(
    <main>
      <h1>Test</h1>
      <ConsentCard ask={{ request_id: "r", summary: "Engineer missed → £32.31 (demo values: not yet checked). Shall I handle this?", amount_gbp: "32.31", proof_trace: null }} court={null} onAnswer={onAnswer} />
    </main>,
  );
  expect(screen.getByText("demo values")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Yes, claim £32.31" }));
  expect(onAnswer).toHaveBeenCalledWith(true);
  await userEvent.click(screen.getByRole("button", { name: "No" }));
  expect(onAnswer).toHaveBeenCalledWith(false);
  await userEvent.click(screen.getByRole("button", { name: "Why this amount" }));
  expect(screen.getByText(/Not needed: the rule is clear/)).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("the timeline highlights how long the person took to decide", () => {
  render(<MissionTimeline mission={rail} personName="Margaret" />);
  expect(screen.getByText("Money arrived")).toBeInTheDocument();
  expect(screen.getByText(/How long Margaret took to decide/)).toBeInTheDocument();
});

test("plain words for skills, states, durations and errors", () => {
  expect(skillWords("clawback.uk-rail-delay-repay")).toBe("Delay Repay");
  expect(skillWords("clawback.ofcom-missed-appointment")).toBe("Missed engineer visit");
  expect(stateTone("verified")).toBe("emerald");
  expect(stateTone("awaiting_consent")).toBe("amber");
  expect(stateTone("failed_safe")).toBe("rose");
  expect(duration(4)).toBe("4 ms");
  expect(duration(2300)).toBe("2.3 s");
  expect(plainError(new TypeError("Failed to fetch"))).toBe("I can't reach Tempo's Gateway. Check Settings, or switch to the showcase.");
  expect(plainMessage("no recorded journey for ('OXF', 'PAD', datetime.date(2026, 10, 24), '0812')")).toBe("Stopped safely: Tempo couldn't confirm the journey.");
  expect(plainMessage("Claim filed.")).toBe("Claim filed.");
  expect(isLive("waiting")).toBe(true);
  expect(isLive("declined")).toBe(false);
  expect(plainError(new Error("POST /approvals/x: HTTP 404"))).toBe("The Gateway could not find that.");
});

const ofcomWaiting = ofcomWaitingJson as unknown as MissionView;
const ofcomVerified = ofcomVerifiedJson as unknown as MissionView;
const railWaiting = railWaitingJson as unknown as MissionView;

test("after Yes the words say what happened: waiting on purpose, filed, paid, or the mission's first sentence", () => {
  expect(afterYes(ofcomWaiting)).toEqual({ tone: "success", text: "Saved. Tempo will wait on purpose until 19 November." });
  expect(afterYes(railWaiting)).toEqual({ tone: "success", text: "Claim filed. Tempo will check for the money." });
  expect(afterYes(rail)).toEqual({ tone: "success", text: "Money arrived: £14.20." });
  expect(afterYes({ ...ofcomWaiting, plan: { ...ofcomWaiting.plan!, action_today: "ofcom.complaint" }, message: "Complaint made. I'll check the money has arrived on 24 Nov at 23:30." })).toEqual({ tone: "info", text: "Complaint made." });
  expect(firstSentence("One. Two.")).toBe("One.");
});

test("a mission's amount: the ask, then the last ask seen, then a 'claim £X' sentence, else nothing", () => {
  forgetAmounts();
  expect(missionAmount(railWaiting)).toBeNull(); // no field says, and no guess is made
  rememberAmount(railWaiting.id, "14.20");
  expect(missionAmount(railWaiting)).toBe("14.20");
  forgetAmounts();
  expect(missionAmount({ ...railWaiting, message: "38 min late → 50% of £28.40. Shall I claim £14.20 for you?" })).toBe("14.20");
  expect(missionAmount({ ...railWaiting, message: "The fare was £28.40." })).toBeNull();
  expect(missionAmount(ofcomWaiting)).toBe("32.31"); // the plan's resolved value
});

test("the Rights Portfolio is settled once paid, stopped once stopped, and only a live mission waits or acts", async () => {
  const { container, rerender } = render(
    <main>
      <h1>Test</h1>
      <h2>Mission</h2>
      <RightsPortfolio plan={ofcomVerified.plan!} mission={ofcomVerified} />
    </main>,
  );
  expect(screen.getByText("Settled")).toBeInTheDocument();
  expect(screen.getByText("Paid £32.31 on 24 November. Nothing more to do.")).toBeInTheDocument();
  expect(screen.queryByText("Acting now")).not.toBeInTheDocument();
  expect(screen.queryByText("At stake if you do nothing")).not.toBeInTheDocument();
  expect(screen.getByText("What Tempo weighed").closest("details")).not.toHaveAttribute("open");
  await expectNoA11yViolations(container);

  rerender(
    <main>
      <h1>Test</h1>
      <RightsPortfolio plan={ofcomWaiting.plan!} mission={{ ...ofcomWaiting, state: "declined", timeline: [...ofcomWaiting.timeline, { to: "declined", at: "2026-10-25T09:00:00+00:00", latency_ms: 0 }] }} />
    </main>,
  );
  expect(screen.getByText("Stopped")).toBeInTheDocument();
  expect(screen.getByText("Stopped on 25 October. Nothing more will be sent.")).toBeInTheDocument();
  expect(screen.queryByText("Waiting, on purpose")).not.toBeInTheDocument();

  rerender(
    <main>
      <h1>Test</h1>
      <RightsPortfolio plan={ofcomWaiting.plan!} mission={ofcomWaiting} />
    </main>,
  );
  expect(screen.getByText("Waiting, on purpose")).toBeInTheDocument();
  expect(screen.getByText("At stake if you do nothing")).toBeInTheDocument();
});
