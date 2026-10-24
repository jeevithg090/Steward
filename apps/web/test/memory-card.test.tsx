import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryCard, day, factText } from "@/components/MemoryCard";
import type { MemoryCardData, MemoryItem, TemporalFact } from "@/lib/api";

const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: "mem_1", text: "lives in Abingdon", category: "household", source: "user_voice",
  trust: "trusted", observed_at: "2026-10-24T09:00:00+00:00", confidence: 0.95,
  expires_at: null, superseded_by: null, ...over,
});
const fact = (over: Partial<TemporalFact>): TemporalFact => ({
  id: "f_2", kind: "appointment", subject: "Broadbandly engineer visit", predicate: "scheduled_for",
  object: "19 Oct 2026 08:00 to 12:00", valid_from: "2026-10-15T13:00:00+00:00", valid_to: null,
  superseded_by: null, episode_id: "ep_2", ...over,
});
const CARD: MemoryCardData = {
  memories: {
    household: [{ item: item({}), earlier: [item({ id: "mem_0", text: "lives in Didcot", observed_at: "2026-10-01T09:00:00+00:00", superseded_by: "mem_1" })] }],
    health: [{ item: item({ id: "mem_h", text: "has a hearing aid", category: "health", expires_at: "2026-11-23T09:00:00+00:00" }), earlier: [] }],
  },
  timeline: [
    fact({ id: "f_1", object: "12 Oct 2026 08:00 to 12:00", valid_from: "2026-10-10T08:00:00+00:00", valid_to: "2026-10-15T13:00:00+00:00", superseded_by: "f_2", episode_id: "ep_1" }),
    fact({}),
  ],
};
const noop = () => {};

test("memory card shows provenance: source, date, trust and when it expires", () => {
  render(<MemoryCard card={CARD} onForget={noop} onForgetFact={noop} onCorrect={noop} />);

  expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByText("lives in Abingdon")).toBeInTheDocument();
  expect(screen.getAllByText("You said, by voice · 24 Oct 2026 · trusted")).toHaveLength(1);
  expect(screen.getByText(/kept until 23 Nov 2026/)).toBeInTheDocument();
  const earlier = screen.getByRole("list", { name: "Earlier versions" });
  expect(within(earlier).getByText("lives in Didcot").tagName).toBe("S");
});

test("the timeline strikes through what was replaced, with the date it changed", async () => {
  render(<MemoryCard card={CARD} onForget={noop} onForgetFact={noop} onCorrect={noop} />);

  await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));

  const old = screen.getByText(factText(CARD.timeline[0]!));
  expect(old.tagName).toBe("S");
  expect(screen.getByText(/From 10 Oct 2026, replaced 15 Oct 2026/)).toBeInTheDocument();
  expect(screen.getByText(/still true/)).toBeInTheDocument();
});

test("forget and edit call back with the memory", async () => {
  const forgotten: string[] = [];
  const corrected: [string, string][] = [];
  render(
    <MemoryCard card={CARD} onForget={(m) => forgotten.push(m.id)} onForgetFact={(f) => forgotten.push(f.episode_id)}
      onCorrect={(m, text) => corrected.push([m.id, text])} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Forget has a hearing aid" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
  const box = screen.getByLabelText("Correct this memory");
  await userEvent.clear(box);
  await userEvent.type(box, "lives in Oxford");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Forget" })[1]!);

  expect(forgotten).toEqual(["mem_h", "ep_2"]);
  expect(corrected).toEqual([["mem_1", "lives in Oxford"]]);
});

test("an empty card says Tempo only remembers what you tell it", () => {
  render(<MemoryCard card={null} onForget={noop} onForgetFact={noop} onCorrect={noop} />);

  expect(screen.getByText("Nothing yet. Tempo only remembers what you tell it.")).toBeInTheDocument();
  expect(day("2026-10-25T00:30:00+00:00")).toBe("25 Oct 2026");
});
