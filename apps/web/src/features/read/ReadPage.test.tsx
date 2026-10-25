import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import ReadPage from "./ReadPage";

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

test("the council letter is read back with its one read-back question first, and the avatar reads the whole thing aloud", async () => {
  const speak = vi.fn();
  const { container } = render(<main><ReadPage {...props({ speak })} /></main>);
  expect(screen.getByRole("heading", { level: 1, name: "Read It To Me" })).toBeInTheDocument();
  expect(screen.getByText(/no Gateway to read a new letter/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Take a photo/)).not.toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: /A council tax reminder/ }));

  expect(screen.getByRole("heading", { name: "A council tax letter from Oxford City Council, dated 20 October 2026" })).toBeInTheDocument();
  expect(screen.getByText("It says you owe Oxford City Council £112.00.")).toBeInTheDocument();
  expect(screen.getByText("Money is owed by you: £112.00")).toBeInTheDocument();
  expect(screen.getByText(/By 10 November 2026\./)).toBeInTheDocument();
  expect(screen.getByText("Recorded from the replay Gateway")).toBeInTheDocument();

  const unsure = screen.getByRole("group", { name: "Before I go on, one thing I wasn't sure of" });
  expect(within(unsure).getByText("I read the date to pay by as 10 November 2026. Is that right?")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Read it to me" }));
  expect(speak).toHaveBeenCalledWith(expect.stringMatching(/^This is a council tax letter from Oxford City Council, dated 20 October 2026/));

  await userEvent.click(within(unsure).getByRole("button", { name: "Yes, that's right" }));
  expect(screen.queryByRole("group", { name: /Before I go on/ })).not.toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("correcting the read-back date changes the date shown", async () => {
  render(<main><ReadPage {...props()} /></main>);
  await userEvent.click(await screen.findByRole("button", { name: /A council tax reminder/ }));

  const unsure = screen.getByRole("group", { name: /Before I go on/ });
  await userEvent.type(within(unsure).getByLabelText("Or the right one"), "2026-11-12");
  await userEvent.click(within(unsure).getByRole("button", { name: "Use this" }));

  expect(screen.getByText(/By 12 November 2026\./)).toBeInTheDocument();
});

test("the water letter says Thames Water owes you £23.40; a reply is drafted from your words only and can be copied", async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  render(<main><ReadPage {...props()} /></main>);

  await userEvent.click(await screen.findByRole("button", { name: /A water bill: you paid too much/ }));
  expect(screen.getByRole("heading", { name: "A water bill from Thames Water, dated 3 October 2026" })).toBeInTheDocument();
  expect(screen.getByText("Money is coming to you: £23.40")).toBeInTheDocument();
  expect(screen.getByText("There is nothing you need to do.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Before I go on/ })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("What do you want to say?"), "Please send the credit back to my bank account.");
  await userEvent.click(screen.getByRole("button", { name: "Draft my reply" }));

  const draft = await screen.findByText(/Dear Thames Water/);
  expect(draft).toHaveTextContent("your letter of 3 October 2026, which I understand is a water bill.");
  expect(draft).toHaveTextContent("Please send the credit back to my bank account.");
  expect(draft).toHaveTextContent("Margaret");
  expect(screen.getByText(/Made from your words and this reading only/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Dear Thames Water"));
});
