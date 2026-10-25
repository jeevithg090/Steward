import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import StoryPage, { BEATS, NOT_DONE, readingMs } from "./StoryPage";

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

test("the story tells the ten beats in order, each linking to the page that shows it, and ends with what is honestly not done", async () => {
  const { container } = render(<main><StoryPage {...props()} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "The story" })).toBeInTheDocument();
  const beats = within(screen.getByRole("list", { name: "The ten beats" })).getAllByRole("listitem");
  expect(beats).toHaveLength(10);
  expect(BEATS.map((b) => b.name)).toEqual(["Hear", "Read", "Price", "Check", "Weigh", "Time it", "Ask once", "Prove it", "Remember only her words", "Return the time"]);
  expect(within(beats[0]!).getByRole("link", { name: /Who's calling\?/ })).toHaveAttribute("href", "#/callers");
  expect(within(beats[1]!).getByRole("link", { name: /Read It To Me/ })).toHaveAttribute("href", "#/read");
  expect(within(beats[6]!).getByRole("link", { name: /The chat/ })).toHaveAttribute("href", "#/chat");
  expect(within(beats[8]!).getByRole("link", { name: /Memory/ })).toHaveAttribute("href", "#/memory");
  expect(within(beats[2]!).getByText(/Built as the Rights Engine/)).toBeInTheDocument();
  expect(screen.getByText(/The same people are hit from every side at once/)).toBeInTheDocument();
  for (const line of NOT_DONE) expect(screen.getByText(line)).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("Play the story reads the ten sentences one after another and highlights the current beat", async () => {
  const speak = vi.fn();
  render(<main><StoryPage {...props({ speak })} /></main>);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Play the story" }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenLastCalledWith(expect.stringMatching(/^Hear\. Tempo answers the way Margaret asked/));
    expect(screen.getByText(/Reading beat 1 of 10: Hear\./)).toBeInTheDocument();
    const beats = within(screen.getByRole("list", { name: "The ten beats" })).getAllByRole("listitem");
    expect(within(beats[0]!).getByRole("heading", { name: "Hear" }).closest("[aria-current]")).toHaveAttribute("aria-current", "step");

    act(() => {
      vi.advanceTimersByTime(readingMs(BEATS[0]!.sentence));
    });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenLastCalledWith(expect.stringMatching(/^Read\. /));
    expect(screen.getByText(/Reading beat 2 of 10: Read\./)).toBeInTheDocument();
    expect(within(beats[1]!).getByRole("heading", { name: "Read" }).closest("[aria-current]")).toHaveAttribute("aria-current", "step");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Play the story" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Read “Price” aloud" }));
    expect(speak).toHaveBeenLastCalledWith(expect.stringMatching(/^Price\. The amount comes from a YAML rule pack/));
  } finally {
    vi.useRealTimers();
  }
});
