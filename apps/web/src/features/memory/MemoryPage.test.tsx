import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster, toast } from "@/components/ui";
import { ShowcaseGateway } from "@/lib/showcase";
import { expectNoA11yViolations } from "@/test/a11y";
import type { PageProps } from "@/types/page";
import MemoryPage, { day, factText } from "./MemoryPage";

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

test("the Memory Card groups what Margaret said by category, with source, date and trust, and strikes through what was replaced", async () => {
  const { container } = render(<main><MemoryPage {...props()} /></main>);

  expect(screen.getByRole("heading", { level: 1, name: "Memory" })).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Loading what Tempo remembers" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "How to speak with me" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Journeys" })).toBeInTheDocument();
  expect(screen.getByText("has a stammer")).toBeInTheDocument();
  expect(screen.getAllByText("you said, by phone").length).toBeGreaterThan(0);
  expect(screen.getAllByText("trusted").length).toBe(4);
  expect(screen.queryByRole("heading", { name: "People" })).not.toBeInTheDocument(); // no name the person never gave
  expect(screen.getByText("Company text is evidence, never memory.", { exact: false })).toBeInTheDocument();

  const timeline = screen.getByRole("list", { name: "Timeline" });
  const replaced = within(timeline).getByText("Broadbandly engineer visit scheduled for 12 Oct 2026 08:00 to 12:00");
  expect(replaced).toHaveClass("superseded");
  expect(within(timeline).getByText("Broadbandly engineer visit scheduled for 19 Oct 2026 08:00 to 12:00")).not.toHaveClass("superseded");
  expect(within(timeline).getByText(/10 Oct 2026 → 15 Oct 2026/)).toBeInTheDocument();
  expect(within(timeline).getAllByText(/still true/).length).toBe(2);
  expect(day("2026-10-25T00:30:00+00:00")).toBe("25 Oct 2026");
  expect(factText({ id: "f", kind: "promise", subject: "Broadbandly", predicate: "promised", object: "£73.67", valid_from: "", valid_to: null, superseded_by: null, episode_id: "e" })).toBe("Broadbandly promised £73.67");
  await expectNoA11yViolations(container);
});

test("forget asks first, then the memory is gone everywhere; correct keeps the earlier words struck through", async () => {
  const user = userEvent.setup();
  render(<main><MemoryPage {...props()} /><Toaster /></main>);
  await screen.findByText("prefers phone updates");

  await user.click(screen.getByRole("button", { name: "Forget prefers phone updates" }));
  const confirm = screen.getByRole("group", { name: "Forget prefers phone updates?" });
  await user.click(within(confirm).getByRole("button", { name: "Yes, forget" }));
  expect(await screen.findByText(/Forgotten: “prefers phone updates”/)).toBeInTheDocument();
  expect(screen.queryByText("prefers phone updates")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Correct commutes Oxford to Paddington" }));
  const box = screen.getByLabelText("Correct this memory");
  await user.clear(box);
  await user.type(box, "commutes Oxford to Reading");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("commutes Oxford to Reading")).toBeInTheDocument();
  expect(await screen.findByText(/^Corrected\. The earlier words stay visible/)).toBeInTheDocument();
  const earlier = screen.getByRole("list", { name: "Earlier versions" });
  expect(within(earlier).getByText("commutes Oxford to Paddington")).toHaveClass("superseded");
});

test("erase all forgets every memory and every dated fact, after a confirmation", async () => {
  const user = userEvent.setup();
  render(<main><MemoryPage {...props()} /><Toaster /></main>);
  await screen.findByText("has a stammer");

  await user.click(screen.getByRole("button", { name: "Erase all" }));
  expect(screen.getByRole("group", { name: "Erase everything?" })).toHaveTextContent("This can't be undone.");
  await user.click(screen.getByRole("button", { name: "Yes, erase all" }));

  expect(await screen.findByText(/Erased 4 memories and 3 dated facts/)).toBeInTheDocument();
  expect(screen.getByText("Nothing yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Ask in the chat: “What do you remember about me\?”/ })).toHaveAttribute("href", "#/chat?say=What%20do%20you%20remember%20about%20me%3F");
  expect(screen.getByText("No dated facts yet")).toBeInTheDocument();
  expect(screen.getByText(/cleared by the chat's own control/)).toBeInTheDocument();
});

test("a Gateway that fails says so and offers a retry", async () => {
  const gateway = new ShowcaseGateway();
  gateway.memories = async () => {
    throw new Error("GET /memories: HTTP 503");
  };
  render(<main><MemoryPage {...props({ gateway, showcase: false })} /></main>);

  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Memory Card");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
