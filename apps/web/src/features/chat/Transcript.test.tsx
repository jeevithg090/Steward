import type { Message } from "@copilotkit/react-core/v2";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { Transcript } from "./Transcript.tsx";

vi.mock("@copilotkit/react-core/v2", () => ({
  useInterrupt: () => null,
  useRenderToolCall: () => () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const MESSAGES = [
  { id: "u1", role: "user", content: "What's in my inbox?" },
  { id: "a1", role: "assistant", content: "# Your inbox\n\nTwo emails.\n\n## Urgent\n\nThe landlord wrote." },
] as unknown as Message[];

function draw(props: Partial<Parameters<typeof Transcript>[0]> = {}) {
  mockFetch(() => undefined);
  return renderWithProviders(<Transcript messages={MESSAGES} running={false} {...props} />);
}

describe("Transcript", () => {
  it("is a live log around a list, so every message stays a list item", () => {
    draw();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.tagName).toBe("DIV");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-relevant")).toBe("additions");
    const items = within(log).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.parentElement?.tagName).toBe("OL");
    expect(within(log).getByRole("list").getAttribute("role")).toBeNull();
  });

  it("stays quiet while the history loads", () => {
    draw({ live: false });
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(log.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps a reply's # headings under the conversation's own, never a second h1", async () => {
    draw();
    expect(await screen.findByRole("heading", { level: 3, name: "Your inbox" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Urgent" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Messages" })).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
  });

  it("starts a handed-on task's headings one further down, in a plain list", async () => {
    // Other words than above: the Markdown renderer keeps what it drew for the same text.
    const task = [
      { id: "c1", role: "assistant", content: "# Test run\n\nAll 12 passed." },
    ] as unknown as Message[];
    draw({ messages: task, nested: true, label: "What Codex did" });
    expect(await screen.findByRole("heading", { level: 4, name: "Test run" })).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.getByRole("list", { name: "What Codex did" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Messages" })).toBeNull();
  });

  it("adds no heading to an empty conversation", () => {
    draw({ messages: [] });
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
