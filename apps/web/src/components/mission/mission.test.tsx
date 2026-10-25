import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MissionView } from "@/lib/api";
import railJson from "@/showcase/mission-rail-verified.json";
import { expectNoA11yViolations } from "@/test/a11y";
import { ConsentCard } from "./ConsentCard";
import { CourtVotes } from "./CourtVotes";
import { MissionTimeline } from "./MissionTimeline";
import { duration, plainError, skillWords, stateTone } from "./words";

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
  expect(plainError(new TypeError("Failed to fetch"))).toMatch(/can't reach the Gateway/);
  expect(plainError(new Error("POST /approvals/x: HTTP 404"))).toBe("The Gateway could not find that.");
});
