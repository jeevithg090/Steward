import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import OwedPage, { QUESTIONS, toAnswers } from "./OwedPage";

function props(over: Partial<PageProps> = {}): PageProps {
  return {
    gateway: new ShowcaseGateway(),
    user: { id: "u_margaret", name: "Margaret", profileId: null },
    showcase: true,
    health: null,
    events: [],
    language: "en",
    params: {},
    speak: vi.fn(),
    setProfile: vi.fn(),
    ...over,
  };
}

test("ten plain questions, one at a time, then what is worth claiming with the official page and the disclaimer", async () => {
  const user = userEvent.setup();
  const gateway = new ShowcaseGateway();
  const screenSpy = vi.spyOn(gateway, "screen");
  const speak = vi.fn();
  const { container } = render(<main><OwedPage {...props({ gateway, speak })} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "Am I Owed Anything?" })).toBeInTheDocument();
  expect(QUESTIONS).toHaveLength(10);
  expect(screen.getByText("Question 1 of 10")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  await expectNoA11yViolations(container);

  await user.type(screen.getByLabelText("Your age"), "74");
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Question 2 of 10")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "No" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  // Back works and keeps the answer.
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "No" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.type(screen.getByLabelText("Weekly income in pounds"), "180");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByLabelText("Savings in pounds"), "3000");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByLabelText("State Pension"));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "No" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByLabelText("Months you have needed help"), "8");
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Question 9 of 10")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "I'd rather not say" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Question 10 of 10")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await user.click(screen.getByRole("button", { name: "See what I may be owed" }));

  expect(await screen.findByRole("heading", { name: "Pension Credit" })).toBeInTheDocument();
  expect(screenSpy).toHaveBeenCalledWith({
    age: 74,
    couple: false,
    weekly_income_gbp: "180.00",
    savings_gbp: "3000.00",
    benefits: ["state_pension"],
    needs_care_day: true,
    needs_care_night: false,
    care_months: 8,
    terminally_ill: false,
    has_broadband_or_phone: true,
  });
  expect(screen.getAllByText("likely").length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: "Attendance Allowance" })).toBeInTheDocument();
  expect(screen.getByText(/about £73\.90/)).toBeInTheDocument();
  expect(screen.getByText("Screening, not a decision")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /The official page/ })[0]).toHaveAttribute("href", "https://www.gov.uk/pension-credit");

  await user.click(screen.getByRole("button", { name: "Speak the results" }));
  expect(speak).toHaveBeenCalledWith(expect.stringContaining("Pension Credit: likely, about £60.00 a week"));
  await expectNoA11yViolations(container);

  await user.click(screen.getByRole("button", { name: "Start again" }));
  expect(screen.getByText("Question 1 of 10")).toBeInTheDocument();
});

test("answers are sent in the Gateway's shape: money as two-decimal strings, none-of-these as an empty list", () => {
  expect(
    toAnswers({ age: "70", couple: null, weekly_income: "£1,200", savings: "", benefits: ["pip"], none: true, care_day: null, care_night: true, care_months: "", terminally_ill: null, broadband: null }),
  ).toEqual({
    age: 70,
    couple: false,
    weekly_income_gbp: "1200.00",
    savings_gbp: "0.00",
    benefits: [],
    needs_care_day: false,
    needs_care_night: true,
    care_months: 0,
    terminally_ill: false,
    has_broadband_or_phone: true,
  });
});
