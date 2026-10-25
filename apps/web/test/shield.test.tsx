import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShieldPanel } from "@/components/ShieldPanel";
import { ShieldPage } from "@/app/shield/ShieldPage";
import { SAMPLES, ShowcaseShield, translatedSay, type Voice } from "@/lib/shield";
import { expectNoA11yViolations } from "./a11y";

function fakeVoice(): Voice & { spoken: { text: string; language: string }[] } {
  const spoken: { text: string; language: string }[] = [];
  return { available: true, spoken, speak: (text, language) => void spoken.push({ text, language }), stop: () => undefined };
}

test("a look-alike refund text is a likely scam, spoken in the user's words, with its reasons", async () => {
  const voice = fakeVoice();
  const { container } = render(<ShieldPanel source={new ShowcaseShield()} voice={voice} />);

  await userEvent.click(screen.getByRole("button", { name: "A tax refund text" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  expect(await screen.findByRole("heading", { name: "This looks like a scam" })).toBeInTheDocument();
  expect(screen.getByText(/^Do not touch that message\. It is a trick trying to take your money\./)).toBeInTheDocument();
  const verdict = screen.getByRole("region", { name: "This looks like a scam" });
  expect(within(verdict).getByText(/hmrc-refunds-gov\.uk/, { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("It pretends to be a refund, a parcel fee or a fraud team.")).toBeInTheDocument();
  expect(screen.getByText(/Tempo would say this out loud, straight away\./)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Say it out loud" }));
  expect(voice.spoken[0]).toEqual({ text: expect.stringContaining("Do not touch that message"), language: "en" });
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("a short link from a stranger is held, looked at, and then settled", async () => {
  render(<ShieldPanel source={new ShowcaseShield()} voice={fakeVoice()} />);

  await userEvent.click(screen.getByRole("button", { name: "A short link from a stranger" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  expect(await screen.findByRole("heading", { name: "This looks like a scam" })).toBeInTheDocument();
  expect(screen.getByText(/It held this one and looked behind the link before speaking\./)).toBeInTheDocument();
  const verdict = screen.getByRole("region", { name: "This looks like a scam" });
  expect(within(verdict).getByText(/rb\.gy/, { selector: "span" })).toBeInTheDocument();
});

test("a bank's genuine code is quiet and never called safe", async () => {
  render(<ShieldPanel source={new ShowcaseShield()} voice={fakeVoice()} />);

  await userEvent.click(screen.getByRole("button", { name: "A bank's genuine code" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  expect(await screen.findByRole("heading", { name: "No warning signs found" })).toBeInTheDocument();
  expect(screen.getAllByText(/That doesn't prove it's genuine/).length).toBeGreaterThan(0);
  const verdict = screen.getByRole("region", { name: "No warning signs found" });
  expect(verdict.textContent).not.toMatch(/\bsafe\b/i); // the words Tempo never says
});

test("the warning comes in the chosen language and the log counts without the message", async () => {
  const voice = fakeVoice();
  render(<ShieldPanel source={new ShowcaseShield()} voice={voice} />);

  await userEvent.selectOptions(screen.getByLabelText("Say it in"), "hi");
  await userEvent.click(screen.getByRole("button", { name: "An instant loan offer" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  const said = await screen.findByText(/उस मैसेज को मत छुएँ।/);
  expect(said).toHaveAttribute("lang", "hi-IN");
  await userEvent.click(screen.getByRole("button", { name: "Say it out loud" }));
  expect(voice.spoken[0]?.language).toBe("hi");

  const log = screen.getByRole("list", { name: "Recent checks" });
  expect(within(log).getAllByText("This looks like a scam").length).toBeGreaterThan(0);
  expect(within(log).queryByText(/Rs 50,000/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "It was a scam" }));
  expect(screen.getByRole("status")).toHaveTextContent("never the message");
});

test("the showcase refuses to invent a verdict for an unknown message", async () => {
  render(<ShieldPanel source={new ShowcaseShield()} voice={fakeVoice()} />);

  await userEvent.type(screen.getByLabelText("The message"), "Hello there, fancy a cuppa?");
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("only the sample messages can be checked");
});

test("the page explains the showcase and translatedSay covers every level", async () => {
  const { container } = render(<ShieldPage source={new ShowcaseShield()} />);
  expect(screen.getByRole("heading", { name: "Scam Shield" })).toBeInTheDocument();
  expect(screen.getByText(/recorded from a real replay-mode Gateway\. Run/)).toBeInTheDocument();
  await expectNoA11yViolations(container);

  const source = new ShowcaseShield();
  const warn = await source.check(SAMPLES[0].text, "en");
  const quiet = await source.check(SAMPLES[2].text, "en");
  expect(translatedSay(warn, "cy")).toMatch(/^Peidiwch â chyffwrdd/);
  expect(translatedSay(quiet, "ur")).toBe(quiet.say); // nothing to warn about: the English answer stands
});
