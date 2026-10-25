import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoA11yViolations } from "@/test/a11y";
import { Sources, StepsRow } from "./TurnTrace";

test("sources open the page itself in a new tab, named with its site", async () => {
  const { container } = render(<Sources sources={[{ title: "The Buttery Hotel", url: "https://www.thebutteryhotel.co.uk/" }]} />);
  const link = screen.getByRole("link", { name: /The Buttery Hotel.*thebutteryhotel\.co\.uk.*opens in a new tab/ });
  expect(link).toHaveAttribute("href", "https://www.thebutteryhotel.co.uk/");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expectNoA11yViolations(container);
});

test("the steps row opens what Tempo did, each step with its time", async () => {
  const steps = [
    { kind: "think" as const, label: "Understood your message", ms: 980 },
    { kind: "look_up" as const, label: "Checked the weather for Oxford", ms: 268 },
    { kind: "think" as const, label: "Read what it found", ms: 2421 },
  ];
  const { container } = render(<StepsRow steps={steps} />);
  const row = screen.getByRole("button", { name: "How Tempo got here · 3 steps · 3.7 s" });
  expect(row).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Checked the weather for Oxford")).toBeInTheDocument();
  expect(screen.getByText("268 ms")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});
