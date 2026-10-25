import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoA11yViolations } from "@/test/a11y";
import { ConsentCard } from "./ConsentCard";

const ASK = { request_id: "r1", summary: "Your 08:12 was 38 minutes late. Shall I claim £14.20 for you?", amount_gbp: "14.20", proof_trace: null };

test("signed: the yes says Face ID and why, and still starts with 'Yes, claim £'", async () => {
  const onAnswer = vi.fn();
  const { container } = render(
    <main>
      <ConsentCard ask={ASK} court={null} onAnswer={onAnswer} signed />
    </main>,
  );
  const yes = screen.getByRole("button", { name: "Yes, claim £14.20 with Face ID" });
  expect(yes).toHaveAccessibleName(/^Yes, claim £/);
  expect(yes).toHaveAccessibleDescription("You'll confirm with Face ID or your fingerprint. Your answer is signed on this device.");
  expect(screen.getByText(/You'll confirm with Face ID or your fingerprint/)).toBeInTheDocument();
  await expectNoA11yViolations(container);

  await userEvent.click(yes);
  await userEvent.click(screen.getByRole("button", { name: "No" }));
  expect(onAnswer.mock.calls).toEqual([[true], [false]]);
});

test("not signed (the default): the card is as before", () => {
  render(<ConsentCard ask={ASK} court={null} onAnswer={() => undefined} />);
  expect(screen.getByRole("button", { name: "Yes, claim £14.20" })).toBeInTheDocument();
  expect(screen.queryByText(/You'll confirm with Face ID/)).not.toBeInTheDocument();
});

test("a plan to wait on purpose: the yes hands the case over instead of promising a claim today", () => {
  const wait = { ...ASK, summary: "I'll wait for now. You can complain to Broadbandly from 19 November. Shall I handle this for you?", amount_gbp: "32.31" };
  const { rerender } = render(<ConsentCard ask={wait} court={null} onAnswer={() => undefined} />);
  expect(screen.getByRole("button", { name: "Yes, handle it for me" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Yes, claim/ })).not.toBeInTheDocument();
  rerender(<ConsentCard ask={wait} court={null} onAnswer={() => undefined} signed />);
  expect(screen.getByRole("button", { name: "Yes, handle it for me with Face ID" })).toBeInTheDocument();
  rerender(<ConsentCard ask={ASK} court={null} onAnswer={() => undefined} waits={false} />);
  expect(screen.getByRole("button", { name: "Yes, claim £14.20" })).toBeInTheDocument();
});
