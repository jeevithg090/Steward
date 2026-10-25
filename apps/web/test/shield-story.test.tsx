import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShieldStory } from "@/components/ShieldStory";
import { ShieldPage } from "@/app/shield/ShieldPage";
import { ShowcaseShield, type Narrator, type SpokenLine } from "@/lib/shield";
import { expectNoA11yViolations } from "./a11y";

/** A narrator that speaks instantly and remembers every line, so the tour can be followed in a test. */
function fakeNarrator(available = true): Narrator & { lines: SpokenLine[]; stopped: number } {
  const n = {
    available,
    lines: [] as SpokenLine[],
    stopped: 0,
    play(lines: SpokenLine[], onLine: (i: number) => void, onDone: () => void) {
      lines.forEach((line, i) => {
        n.lines.push(line);
        onLine(i);
      });
      onDone();
    },
    stop() {
      n.stopped += 1;
    },
  };
  return n;
}

test("the story can be stepped through with buttons, and each step says where it is", async () => {
  const { container } = render(<ShieldStory narrator={fakeNarrator()} reducedMotion={false} />);

  expect(screen.getByRole("heading", { name: "1. A text arrives" })).toBeInTheDocument();
  const steps = screen.getByRole("navigation", { name: "Story steps" });
  expect(within(steps).getByRole("button", { name: /Step 1 of 8/ })).toHaveAttribute("aria-current", "step");

  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("heading", { name: "2. The phone decides, in milliseconds" })).toBeInTheDocument();
  expect(screen.getByText("Its link only looks like HMRC's.")).toBeInTheDocument();

  await userEvent.click(within(steps).getByRole("button", { name: /Step 4 of 8/ }));
  expect(screen.getByRole("heading", { name: "4. Only four fields leave the phone" })).toBeInTheDocument();
  expect(screen.getByText("hmrc-refunds-gov.uk", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText("scam_official_pretext,scam_short_link,scam_urgency")).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("playing the story out loud narrates every step and speaks Tempo's exact warning", async () => {
  const narrator = fakeNarrator();
  render(<ShieldStory narrator={narrator} reducedMotion />);

  await userEvent.click(screen.getByRole("button", { name: "Play the story out loud" }));

  const spoken = narrator.lines.map((l) => l.text);
  expect(spoken[0]).toMatch(/^It is Tuesday afternoon/);
  expect(spoken).toContain("I'm checking that message. Don't tap anything in it yet.");
  expect(spoken.some((t) => t.startsWith("Do not touch that message. It is a trick trying to take your money."))).toBe(true);
  expect(screen.getByRole("heading", { name: "8. Every door, the same answer" })).toBeInTheDocument();

  await userEvent.click(screen.getByText(/Transcript: everything spoken/));
  const transcript = screen.getByRole("list", { name: "Transcript" });
  expect(within(transcript).getAllByRole("listitem").length).toBe(spoken.length);
});

test("in Urdu the warning is spoken and shown right to left, with the language marked", async () => {
  const narrator = fakeNarrator();
  render(<ShieldStory narrator={narrator} reducedMotion />);

  await userEvent.selectOptions(screen.getByLabelText("Tempo speaks in"), "ur");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Hear this step" }));

  const tempo = narrator.lines.find((l) => l.language === "ur");
  expect(tempo?.text).toMatch(/^اس پیغام کو ہاتھ نہ لگائیں۔/);
  const caption = within(screen.getByTestId("captions")).getByText(tempo!.text);
  expect(caption).toHaveAttribute("dir", "rtl");
  expect(caption).toHaveAttribute("lang", "ur-PK");
});

test("the Shield card's buttons work, and a sender that is a name cannot be trusted", async () => {
  const narrator = fakeNarrator();
  render(<ShieldStory narrator={narrator} reducedMotion />);

  await userEvent.click(screen.getByRole("navigation", { name: "Story steps" }).querySelector("li:nth-child(3) button")!);
  const card = screen.getByRole("group", { name: "The Shield card's buttons, working" });
  await userEvent.click(within(card).getByRole("button", { name: "I know this sender" }));
  expect(within(card).getByRole("status")).toHaveTextContent("a name, not a number");

  await userEvent.click(within(card).getByRole("button", { name: "Read it again" }));
  expect(narrator.lines.at(-1)?.text).toMatch(/^Do not touch that message/);
});

test("eyes closed mode fades the pictures, and reduced motion is acknowledged", async () => {
  render(<ShieldStory narrator={fakeNarrator()} reducedMotion />);

  expect(screen.getByText("Your system asked for less motion, so nothing on this page animates.")).toBeInTheDocument();
  const phone = screen.getByRole("img", { name: /Margaret's phone/ });
  expect(phone).toHaveStyle({ opacity: "1" });

  await userEvent.click(screen.getByRole("button", { name: "Eyes closed mode" }));
  expect(phone).toHaveStyle({ opacity: "0.08" });
  expect(screen.getByRole("button", { name: "Eyes open" })).toHaveAttribute("aria-pressed", "true");
});

test("the focus trail names the control a keyboard user has reached", async () => {
  render(<ShieldStory narrator={fakeNarrator()} reducedMotion />);

  await userEvent.tab();
  expect(screen.getByText(/Focus is on:/)).toHaveTextContent("Play the story out loud");
});

test("without speech the page says so and the quiet step shows the recorded no-flags answer", async () => {
  const { container } = render(<ShieldPage source={new ShowcaseShield()} narrator={fakeNarrator(false)} />);

  expect(screen.getByText(/This browser cannot speak/)).toBeInTheDocument();
  expect(screen.getByText(/recorded from a real replay-mode Gateway\. Run/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("navigation", { name: "Story steps" }).querySelector("li:nth-child(7) button")!);
  expect(screen.getByText(/No warning signs found\. That doesn't prove it's genuine/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Try it yourself" })).toBeInTheDocument();
  await expectNoA11yViolations(container);
});
