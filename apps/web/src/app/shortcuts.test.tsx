import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WELCOME_STORAGE_KEY } from "@/lib/onboarding.ts";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { TodayPage } from "@/pages/TodayPage.tsx";
import { ShortcutsDialog, useShortcuts } from "./shortcuts.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function Harness() {
  const [help, setHelp] = useState(false);
  useShortcuts({ onHelp: () => setHelp(true) });
  return (
    <>
      <label>
        Message
        <input />
      </label>
      <Where />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </>
  );
}

const press = (key: string, target: EventTarget = window, init: KeyboardEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });

describe("keyboard shortcuts", () => {
  it("g then a letter goes somewhere", () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    press("g");
    press("k");
    expect(screen.getByTestId("where").textContent).toBe("/tasks");
    press("g");
    press("c");
    expect(screen.getByTestId("where").textContent).toBe("/chat");
    press("g");
    press("t");
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("never fires while typing, or with a modifier held", () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    const input = screen.getByLabelText("Message");
    press("g", input);
    press("k", input);
    expect(screen.getByTestId("where").textContent).toBe("/");
    press("g", window, { ctrlKey: true });
    press("k");
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("? opens the list of shortcuts", () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    press("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    expect(screen.getByText("Go to Tasks")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("first visit", () => {
  it("Today sends a first visit to the welcome", () => {
    mockFetch(() => ({ body: null }));
    renderWithProviders(
      <>
        <TodayPage />
        <Where />
      </>,
    );
    expect(screen.getByTestId("where").textContent).toBe("/welcome");
  });

  it("Today greets without a name once the welcome is done", async () => {
    localStorage.setItem(WELCOME_STORAGE_KEY, "done");
    mockFetch((req) => (req.path === "/api/approvals" ? { body: [] } : { body: null }));
    renderWithProviders(<TodayPage />);
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/^(Good morning|Good afternoon|Good evening|Hi)$/);
    expect(await screen.findByRole("button", { name: "Make my brief" })).toBeTruthy();
  });
});
