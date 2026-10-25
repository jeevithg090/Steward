import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import { SAY, chatSay } from "./demo";
import StoryPage, { BEATS, NOT_DONE, REAL, demoProgress, readingMs } from "./StoryPage";

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

afterEach(() => {
  demoProgress.reset();
  window.location.hash = "";
});

const LATE = "#/chat?say=My%2008%3A12%20Oxford%20to%20Paddington%20was%2038%20minutes%20late%20on%2023%20October%2C%20ticket%20%C2%A328.40";

test("the story tells the ten beats in order, each with a Try it that does the real thing, and ends with what is real and what is not", async () => {
  const { container } = render(<main><StoryPage {...props()} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "The story" })).toBeInTheDocument();
  const beats = within(screen.getByRole("list", { name: "The ten beats" })).getAllByRole("listitem");
  expect(beats).toHaveLength(10);
  expect(BEATS.map((b) => b.name)).toEqual(["Hear", "Read", "Price", "Check", "Weigh", "Time it", "Ask once", "Prove it", "Remember only her words", "Return the time"]);

  const tryHref = (i: number) => within(beats[i]!).getByRole("link", { name: `Try it: ${BEATS[i]!.name}` }).getAttribute("href");
  expect(chatSay(SAY.lateTrain)).toBe(LATE);
  expect([...Array(10).keys()].map(tryHref)).toEqual([
    "#/callers",
    "#/read",
    LATE,
    LATE,
    LATE,
    "#/chat?say=The%20Broadbandly%20engineer%20never%20came%20on%2019%20October",
    LATE,
    "#/devices",
    "#/chat?say=What%20do%20you%20remember%20about%20me%3F",
    "#/chat?say=How%20much%20have%20you%20got%20back%20for%20me%3F",
  ]);
  // The page that shows each beat is still linked where it differs from Try it.
  expect(within(beats[2]!).getByRole("link", { name: "See it on Mission Control" })).toHaveAttribute("href", "#/missions");
  expect(within(beats[6]!).getByRole("link", { name: "See it on The chat" })).toHaveAttribute("href", "#/chat");
  expect(within(beats[8]!).getByRole("link", { name: "See it on Memory" })).toHaveAttribute("href", "#/memory");
  expect(within(beats[0]!).queryByRole("link", { name: /See it on/ })).not.toBeInTheDocument();
  expect(within(beats[2]!).getByText(/Built as the Rights Engine/)).toBeInTheDocument();
  expect(within(beats[2]!).getByText(/Sends “My 08:12 Oxford to Paddington/)).toBeInTheDocument();

  expect(screen.getByText(/The same people are hit from every side at once/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "For judges: what is real" })).toBeInTheDocument();
  for (const line of [...REAL, ...NOT_DONE]) expect(screen.getByText(line)).toBeInTheDocument();
  await expectNoA11yViolations(container);
});

test("Start the demo goes to the first beat's Try it; the progress rail then marks it tried and offers the next", async () => {
  render(<main><StoryPage {...props()} /></main>);
  const start = screen.getByRole("link", { name: "Start the demo" });
  expect(start).toHaveAttribute("href", "#/callers");
  expect(screen.getByText("0 of 10 tried")).toBeInTheDocument();

  await userEvent.click(start);
  expect(window.location.hash).toBe("#/callers");
  expect(screen.getByText("1 of 10 tried")).toBeInTheDocument();
  const rail = screen.getByRole("navigation", { name: "Demo progress" });
  expect(within(rail).getByRole("button", { name: "Beat 1: Hear, tried" })).toBeInTheDocument();
  expect(within(rail).getByRole("button", { name: "Beat 2: Read" })).toHaveAttribute("aria-current", "step");
  expect(screen.getByRole("link", { name: "Continue: Read" })).toHaveAttribute("href", "#/read");

  const beats = within(screen.getByRole("list", { name: "The ten beats" })).getAllByRole("listitem");
  await userEvent.click(within(beats[2]!).getByRole("link", { name: "Try it: Price" }));
  expect(window.location.hash).toBe(LATE);
  expect(within(rail).getByRole("button", { name: "Beat 3: Price, tried" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Start over" }));
  expect(screen.getByText("0 of 10 tried")).toBeInTheDocument();
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
