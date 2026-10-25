// The simpler app (plan.md §19): History under New chat with each chat's status, Memory under
// its own title, a few pages under More, and the rest only once L is pressed.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRevealKey, useRevealed, reveal } from "@/lib/reveal";
import { expectNoA11yViolations } from "@/test/a11y";
import { baseCommands } from "./CommandPalette";
import { Sidebar, type HistoryItem } from "./Sidebar";

const HISTORY: HistoryItem[] = [
  { title: "My 08:12 was late", status: "live", current: true },
  { title: "The engineer never came", status: "finished" },
  { title: "Hotels in Oxford", status: "read" },
];
const HIDDEN_LABELS = ["Mission Control", "Read It To Me", "Am I owed anything?", "Scam Shield", "Who's calling?", "Devices", "The story"];

beforeEach(() => reveal.set(false));

test("by default: New chat, History with each chat's status, Memory, then More; the hidden pages are not there", async () => {
  const { container } = render(<Sidebar section="/chat" history={HISTORY} ledger={{ gbp: "28.40", hours: "1.2" }} />);
  const headings = screen.getAllByRole("heading").map((h) => h.textContent?.trim());
  expect(headings).toEqual(["History", "Memory"]);
  const order = [...container.querySelectorAll("button, a, h2, p")].map((el) => el.textContent?.trim()).filter(Boolean);
  expect(order.indexOf("New chat")).toBeLessThan(order.indexOf("History"));
  expect(order.indexOf("History")).toBeLessThan(order.indexOf("Memory"));
  expect(order.indexOf("Memory")).toBeLessThan(order.indexOf("More"));

  const history = screen.getByRole("region", { name: "History" });
  expect(within(history).getAllByRole("button").map((b) => b.textContent)).toEqual([
    "My 08:12 was late, Live",
    "The engineer never came, Finished",
    "Hotels in Oxford, Completed and read",
  ]);
  expect(within(history).getByRole("button", { name: /My 08:12/ })).toHaveAttribute("aria-current", "page");

  for (const label of ["Memory", "Connectors", "Summary", "Skills", "Privacy Proof", "Settings"]) expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  for (const label of [...HIDDEN_LABELS, "Profiles"]) expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
  // Mission Control is hidden, so the money returned is shown, not a way to it.
  expect(screen.getByText("Returned so far").closest("a")).toBeNull();
  await expectNoA11yViolations(container);
});

test("once L has been pressed, every hidden page is back, grouped as before", () => {
  reveal.set(true);
  render(<Sidebar section="/missions" history={[]} revealed ledger={{ gbp: "28.40", hours: "1.2" }} />);
  for (const label of HIDDEN_LABELS) expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  expect(screen.getByText("Doing")).toBeInTheDocument();
  expect(screen.getByText("Trust")).toBeInTheDocument();
  expect(screen.getByText("Your chats will appear here.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open Mission Control/ })).toHaveAttribute("href", "#/missions");
});

test("the ⌘K palette lists the hidden pages and the guided demo only after L", () => {
  const hidden = baseCommands([], false).map((c) => c.label);
  expect(hidden).toContain("Summary");
  expect(hidden).toContain("Memory");
  for (const label of [...HIDDEN_LABELS, "Start the guided demo"]) expect(hidden).not.toContain(label);
  const all = baseCommands([], true).map((c) => c.label);
  for (const label of [...HIDDEN_LABELS, "Start the guided demo"]) expect(all).toContain(label);
});

function Probe({ onToggle }: { onToggle: (on: boolean) => void }) {
  useRevealKey(onToggle);
  return (
    <div>
      <p>{useRevealed() ? "shown" : "hidden"}</p>
      <label>
        Message <input />
      </label>
    </div>
  );
}

test("L shows and hides the pages, but never while typing or with Ctrl, ⌘ or Alt", () => {
  const heard = vi.fn();
  render(<Probe onToggle={heard} />);
  expect(screen.getByText("hidden")).toBeInTheDocument();
  act(() => void fireEvent.keyDown(window, { key: "l" }));
  expect(screen.getByText("shown")).toBeInTheDocument();
  expect(heard).toHaveBeenLastCalledWith(true);
  act(() => void fireEvent.keyDown(window, { key: "L" }));
  expect(screen.getByText("hidden")).toBeInTheDocument();
  expect(heard).toHaveBeenLastCalledWith(false);

  fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "l" });
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  fireEvent.keyDown(window, { key: "l", metaKey: true });
  fireEvent.keyDown(window, { key: "l", altKey: true });
  expect(screen.getByText("hidden")).toBeInTheDocument();
  expect(heard).toHaveBeenCalledTimes(2);
});
