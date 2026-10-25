import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import CallersPage from "./CallersPage";

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

test("shows how Tempo will speak with each caller and why, and never a voice id", async () => {
  const speak = vi.fn();
  const { container } = render(<main><CallersPage {...props({ speak })} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "Who's calling?" })).toBeInTheDocument();
  expect(await screen.findByText(/This caller has a stammer\. Never finish their words for them\./)).toBeInTheDocument();
  expect(screen.getByText("Extra: never rushed")).toBeInTheDocument();
  const why = screen.getByRole("list", { name: "Because they said" });
  expect(within(why).getByText(/needs more time to answer/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Speak it" }));
  expect(speak).toHaveBeenCalledWith(expect.stringMatching(/^This caller has a stammer/));
  await expectNoA11yViolations(container);

  await userEvent.click(screen.getByRole("button", { name: "Dilip" }));
  expect(await screen.findByText("Hindi")).toBeInTheDocument();
  expect(screen.getByText("Slower (0.85×)")).toBeInTheDocument();
  expect(screen.getByText(/नमस्ते/)).toHaveAttribute("lang", "hi");
  const heard = screen.getByRole("list", { name: "Words it listens out for" });
  expect(within(heard).getByText("Paddington")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/voice_/);

  await userEvent.click(screen.getByRole("button", { name: "Joan" }));
  expect(await screen.findByText(/Tempo, lower/)).toHaveTextContent("not set up yet");
  expect(screen.getByText("Offered by text too")).toBeInTheDocument();
});

test("a live call shows who was just answered, and how", async () => {
  const events = [{ type: "profile_applied", user_id: "u_margaret", language: "en", speed: "1.0", voice: "default", patience: "high" }];
  render(<main><CallersPage {...props({ events, showcase: false })} /></main>);

  expect(await screen.findByText(/Last call: Margaret, in English, extra time\./)).toBeInTheDocument();
});
