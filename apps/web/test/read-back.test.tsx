import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReadBackCard } from "@/components/ReadBackCard";

test("the read-back asks once, and a yes keeps what was read", async () => {
  const answers: [string, boolean][] = [];
  render(
    <ReadBackCard
      question="I read the date of the missed visit as 19 October 2026. Is that right?"
      date="2026-10-19" busy={false} onConfirm={(d, c) => answers.push([d, c])}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Yes, that's right" }));

  expect(screen.getByText(/19 October 2026/)).toBeInTheDocument();
  expect(answers).toEqual([["2026-10-19", false]]);
});

test("a correction is used instead, and marked as corrected", async () => {
  const answers: [string, boolean][] = [];
  render(<ReadBackCard question="Is that right?" date="2026-10-19" busy={false} onConfirm={(d, c) => answers.push([d, c])} />);

  const input = screen.getByLabelText("Or the right date");
  await userEvent.clear(input);
  await userEvent.type(input, "2026-10-12");
  await userEvent.click(screen.getByRole("button", { name: "Use this date" }));

  expect(answers).toEqual([["2026-10-12", true]]);
});
