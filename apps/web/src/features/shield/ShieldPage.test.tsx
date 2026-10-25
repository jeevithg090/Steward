import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "@/components/ui";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import ShieldPage from "./ShieldPage";

afterEach(() => toast.clear());

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

test("the HMRC sample is a likely scam in the warn zone, spoken in Tempo's words, with its reasons; feedback keeps the verdict, never the message", async () => {
  const speak = vi.fn();
  const { container } = render(<main><ShieldPage {...props({ speak })} /><Toaster /></main>);
  expect(screen.getByRole("heading", { level: 1, name: "Scam Shield" })).toBeInTheDocument();
  expect(screen.getByText(/only the four example messages can be checked/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "A tax refund text" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  expect(await screen.findByRole("heading", { name: "This looks like a scam" })).toBeInTheDocument();
  const verdict = screen.getByRole("region", { name: "This looks like a scam" });
  expect(within(verdict).getByText("Tempo speaks")).toBeInTheDocument();
  expect(within(verdict).getByText("Tempo would say this out loud, straight away.")).toBeInTheDocument();
  expect(within(verdict).getByText(/^Do not touch that message\. It is a trick trying to take your money\./)).toHaveAttribute("lang", "en-GB");
  expect(within(verdict).getByText("hmrc-refunds-gov.uk")).toBeInTheDocument();
  expect(within(verdict).getByText("It pretends to be a refund, a parcel fee or a fraud team.")).toBeInTheDocument();
  expect(within(verdict).getByText(/Text model 2026\.10\.25/)).toBeInTheDocument();

  await userEvent.click(within(verdict).getByRole("button", { name: "Speak it" }));
  expect(speak).toHaveBeenCalledWith(expect.stringMatching(/^Do not touch that message/));

  // The verdict's colour band is strong: white on rose for a likely scam.
  expect(screen.getByRole("heading", { name: "This looks like a scam" }).closest(".bg-rose-700")).not.toBeNull();
  // The Shield log refreshed after the check: today's count includes it.
  const log = await screen.findByRole("list", { name: "Recent checks" });
  expect(within(log).getAllByText("This looks like a scam").length).toBeGreaterThan(0);

  await userEvent.click(within(verdict).getByRole("button", { name: "That was a scam" }));
  expect(await screen.findByText("Thank you. Only the verdict and your answer are kept, never the message.")).toBeInTheDocument();
  expect(within(verdict).getByText(/You said: that was a scam\./)).toBeInTheDocument();
  expect(within(log).getAllByText(/you said: scam/).length).toBeGreaterThan(0);
  expect(within(log).getAllByText("This looks like a scam").length).toBeGreaterThan(0);
  expect(within(log).queryByText(/248\.20/)).not.toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("the warning comes in the chosen language, right to left for Urdu, and the showcase refuses to invent a verdict", async () => {
  render(<main><ShieldPage {...props({ language: "hi" })} /></main>);

  expect(screen.getByLabelText("Say it in")).toHaveValue("hi");
  await userEvent.click(screen.getByRole("button", { name: "An instant loan offer" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));
  const hindi = await screen.findByText(/^उस मैसेज को मत छुएँ।/);
  expect(hindi).toHaveAttribute("lang", "hi-IN");

  await userEvent.selectOptions(screen.getByLabelText("Say it in"), "ur");
  const urdu = await screen.findByText(/^اس پیغام کو ہاتھ نہ لگائیں۔/);
  expect(urdu).toHaveAttribute("dir", "rtl");

  await userEvent.clear(screen.getByLabelText("Paste the text you're unsure of"));
  await userEvent.type(screen.getByLabelText("Paste the text you're unsure of"), "Hello there, fancy a cuppa?");
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("only the sample messages can be checked");
});

test("a bank's genuine code is quiet and never called safe", async () => {
  render(<main><ShieldPage {...props()} /></main>);

  await userEvent.click(screen.getByRole("button", { name: "A bank's genuine code" }));
  await userEvent.click(screen.getByRole("button", { name: "Check this message" }));

  const verdict = await screen.findByRole("region", { name: "No warning signs found" });
  expect(within(verdict).getByText("quiet")).toBeInTheDocument();
  expect(verdict.textContent).not.toMatch(/\bsafe\b/i);
  expect(screen.getByRole("heading", { name: "No warning signs found" }).closest(".bg-emerald-700")).not.toBeNull();
});

test("Paste from clipboard fills the box, and says plainly when the browser won't allow it", async () => {
  render(<main><ShieldPage {...props()} /><Toaster /></main>);
  const box = screen.getByLabelText("Paste the text you're unsure of");

  Object.assign(navigator, { clipboard: { readText: vi.fn(async () => "Your parcel is held. Pay £1.99 at http://evri-redelivery.top") } });
  await userEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));
  expect(box).toHaveValue("Your parcel is held. Pay £1.99 at http://evri-redelivery.top");
  expect(box).toHaveFocus();

  Object.assign(navigator, { clipboard: { readText: vi.fn(async () => { throw new Error("NotAllowedError"); }) } });
  await userEvent.click(screen.getByRole("button", { name: "Paste from clipboard" }));
  expect(await screen.findByText(/won't let Tempo read the clipboard\. Long-press or right-click in the box and choose Paste\./)).toBeInTheDocument();
});

test("Margaret's Tuesday steps through with captions, plays out loud (captions only where the browser cannot speak), and speaks Urdu right to left", async () => {
  const { container } = render(<main><ShieldPage {...props()} /></main>);
  await userEvent.click(screen.getByRole("tab", { name: "Margaret's Tuesday" }));

  expect(screen.getByRole("heading", { name: "1. A text arrives" })).toBeInTheDocument();
  expect(screen.getByText(/This browser cannot speak/)).toBeInTheDocument();
  const steps = screen.getByRole("navigation", { name: "Story steps" });
  expect(within(steps).getByRole("button", { name: /Step 1 of 8/ })).toHaveAttribute("aria-current", "step");

  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("heading", { name: "2. The phone decides, in milliseconds" })).toBeInTheDocument();
  expect(screen.getByText("Its link only looks like HMRC's.")).toBeInTheDocument();

  await userEvent.click(within(steps).getByRole("button", { name: /Step 4 of 8/ }));
  expect(screen.getByText("hmrc-refunds-gov.uk", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText("scam_official_pretext,scam_short_link,scam_urgency")).toBeInTheDocument();

  await userEvent.click(within(steps).getByRole("button", { name: /Step 1 of 8/ }));
  await userEvent.click(screen.getByRole("button", { name: "Play the story out loud" }));
  expect(screen.getByRole("heading", { name: "8. Every door, the same answer" })).toBeInTheDocument();
  await userEvent.click(screen.getByText(/Transcript: everything spoken/));
  const transcript = within(screen.getByRole("list", { name: "Transcript" })).getAllByRole("listitem");
  expect(transcript.length).toBe(11); // eight narrations and three things Tempo says
  expect(transcript.some((li) => li.textContent === "I'm checking that message. Don't tap anything in it yet.")).toBe(true);

  await userEvent.selectOptions(screen.getByLabelText("Tempo speaks in"), "ur");
  await userEvent.click(within(steps).getByRole("button", { name: /Step 3 of 8/ }));
  await userEvent.click(screen.getByRole("button", { name: "Hear this step" }));
  const caption = within(screen.getByTestId("captions")).getByText(/^اس پیغام کو ہاتھ نہ لگائیں۔/);
  expect(caption).toHaveAttribute("dir", "rtl");
  expect(caption).toHaveAttribute("lang", "ur-PK");

  await userEvent.click(screen.getByRole("button", { name: "Eyes closed mode" }));
  expect(screen.getByRole("img", { name: /Margaret's phone/ })).toHaveStyle({ opacity: "0.08" });
  await expectNoA11yViolations(container);
});
