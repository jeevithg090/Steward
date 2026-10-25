import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Speaker } from "@/components/site/LetterReadingCard";
import { ReadItToMe } from "@/components/site/ReadItToMe";
import { SiteChrome } from "@/components/site/SiteChrome";
import { LETTER_KINDS, MONEY_DIRECTIONS, draftReplyLocally } from "@/lib/letters";
import { ShowcaseCatalog } from "@/lib/showcase";
import { expectNoA11yViolations } from "./a11y";

const source = new ShowcaseCatalog();

function fakeSpeaker(): Speaker & { spoken: { text: string; lang: string }[] } {
  const spoken: { text: string; lang: string }[] = [];
  return { available: true, spoken, speak: (text, lang) => void spoken.push({ text, lang }), stop: () => undefined };
}

test("the council letter is read back with its one read-back question first, and can be read aloud in its language", async () => {
  const speaker = fakeSpeaker();
  const { container } = render(<SiteChrome pathname="/read"><ReadItToMe source={source} speaker={speaker} /></SiteChrome>);

  await userEvent.click(await screen.findByRole("button", { name: "A council tax reminder" }));

  expect(screen.getByRole("heading", { name: /A council tax letter from Oxford City Council, dated 20 October 2026/ })).toBeInTheDocument();
  expect(screen.getByText("It says you owe Oxford City Council £112.00.")).toBeInTheDocument();
  expect(screen.getByText("Money is owed by you: £112.00")).toBeInTheDocument();
  expect(screen.getByText(/Pay £112.00 by 10 November 2026. If you cannot pay, ring them/, { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText(/By 10 November 2026\./)).toBeInTheDocument();
  expect(screen.getByText("Recorded from the replay Gateway")).toBeInTheDocument();
  expect(screen.queryByText(/written by hand/)).not.toBeInTheDocument();

  const unsure = screen.getByRole("group", { name: "Before I go on, one thing I wasn't sure of" });
  expect(within(unsure).getByText("I read the date to pay by as 10 November 2026. Is that right?")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Read it aloud" }));
  expect(speaker.spoken).toEqual([{ text: expect.stringContaining("This is a council tax letter from Oxford City Council, dated 20 October 2026"), lang: "en" }]);
  expect(screen.getByRole("button", { name: "Stop reading" })).toBeInTheDocument();

  await userEvent.click(within(unsure).getByRole("button", { name: "Yes, that's right" }));
  expect(screen.queryByRole("group", { name: /Before I go on/ })).not.toBeInTheDocument();
  expect(screen.getByText(/By 10 November 2026\./)).toBeInTheDocument(); // a plain yes keeps the date that was read
  await expectNoA11yViolations(container);
});

test("correcting the read-back date changes the date shown", async () => {
  render(<ReadItToMe source={source} speaker={fakeSpeaker()} />);
  await userEvent.click(await screen.findByRole("button", { name: "A council tax reminder" }));

  const unsure = screen.getByRole("group", { name: /Before I go on/ });
  const input = within(unsure).getByLabelText("Or the right one");
  await userEvent.type(input, "2026-11-12");
  await userEvent.click(within(unsure).getByRole("button", { name: "Use this" }));

  expect(screen.getByText(/By 12 November 2026\./)).toBeInTheDocument();
});

test("the water letter says Thames Water owes you £23.40 and there is nothing to do; a reply is drafted from your words only", async () => {
  render(<ReadItToMe source={source} speaker={fakeSpeaker()} />);

  await userEvent.click(await screen.findByRole("button", { name: "A water bill: you paid too much" }));

  expect(screen.getByRole("heading", { name: /A water bill from Thames Water, dated 3 October 2026/ })).toBeInTheDocument();
  expect(screen.getByText("It says you paid too much. Thames Water owes you £23.40. You do not owe anything.")).toBeInTheDocument();
  expect(screen.getByText("Money is coming to you: £23.40")).toBeInTheDocument();
  expect(screen.getByText("There is nothing you need to do.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: /Before I go on/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/^By /)).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("What do you want to say?"), "Please send the credit back to my bank account.");
  await userEvent.click(screen.getByRole("button", { name: "Draft my reply" }));

  const draft = await screen.findByText(/Dear Thames Water/);
  expect(draft).toHaveTextContent("your letter of 3 October 2026, which I understand is a water bill.");
  expect(draft).toHaveTextContent("Please send the credit back to my bank account.");
  expect(draft).not.toHaveTextContent(/£|account number|sort code/);
  expect(screen.getByText(/nothing else was added/)).toBeInTheDocument();
});

test("the showcase cannot read a new letter and says so; a browser without speech says so too", async () => {
  render(<ReadItToMe source={source} speaker={{ available: false, speak: () => undefined, stop: () => undefined }} />);

  expect(screen.getByText(/no Gateway to read a new letter/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Take a photo/)).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "A council tax reminder" }));
  expect(screen.getByText(/This browser can't read aloud/)).toBeInTheDocument();
});

test("the recorded readings use the contract's codes, and the local drafter adds no facts", async () => {
  const letters = await source.sampleLetters();
  for (const { reading } of letters) {
    expect(LETTER_KINDS).toContain(reading.kind);
    expect(MONEY_DIRECTIONS).toContain(reading.money.direction);
    expect(reading.sample).toBe(false);
  }
  const [water] = letters;
  const draft = draftReplyLocally(water!.reading, "I moved house in June.\nPlease close the account.", "Margaret");

  expect(draft.adds_no_facts).toBe(true);
  expect(draft.language).toBe("en");
  expect(draft.draft.split("\n")).toEqual(expect.arrayContaining(["Dear Thames Water,", "I moved house in June.", "Please close the account.", "Margaret"]));
});
