import type { Brief, TriageItem } from "@steward/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BriefCard } from "./BriefCard.tsx";

afterEach(cleanup);

/** Invented names, in nobody's mailbox. */
const item = (id: string, name: string, subject: string, verdict: TriageItem["verdict"]): TriageItem => ({
  emailId: id,
  subject,
  from: { name, email: `${name.toLowerCase().replace(/\s/g, ".")}@example.com` },
  verdict,
  reason: verdict === "needs_you" ? "Asks you to confirm by noon." : "A newsletter.",
  confidence: 0.9,
  by: "model",
});

function brief(over: Partial<Brief> = {}): Brief {
  return {
    id: "brf_1",
    date: "2026-10-27",
    summary: "Two things need you today, and you have one meeting.",
    needsYou: [
      item("e1", "Pat Example", "Delivery on Thursday?", "needs_you"),
      item("e2", "Billing Team", "Payment failed", "needs_you"),
    ],
    canWait: [
      item("e3", "News Weekly", "This week in pottery", "can_wait"),
      item("e4", "Shop Deals", "20% off", "can_wait"),
      item("e5", "News Weekly", "Bonus issue", "can_wait"),
    ],
    calendar: [
      {
        id: "ev1",
        title: "Supplier call",
        start: "2026-10-27T15:00:00Z",
        end: "2026-10-27T15:30:00Z",
        allDay: false,
        attendees: [],
        location: "Studio",
      },
    ],
    tasks: [],
    couldNotCheck: ["Calendar: not connected"],
    createdAt: "2026-10-27T07:00:00Z",
    ...over,
  };
}

describe("BriefCard", () => {
  it("has the four sections in order", () => {
    render(<BriefCard brief={brief()} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent?.replace(/,?\s*\d+$/, ""));
    expect(headings).toEqual(["Your brief", "Needs you", "Can wait", "Today", "Couldn't check"]);
    expect(screen.getByText("Two things need you today, and you have one meeting.")).toBeTruthy();
    // The date follows the browser's locale, so only the parts every locale shares are checked.
    expect(screen.getByText(/Tuesday/).textContent).toMatch(/27/);
  });

  it("lists who needs you, what about, and why", () => {
    render(<BriefCard brief={brief()} />);
    const needs = screen.getByRole("region", { name: /Needs you/ });
    expect(within(needs).getByText("Pat Example")).toBeTruthy();
    expect(within(needs).getByText("Delivery on Thursday?")).toBeTruthy();
    expect(within(needs).getAllByText("Asks you to confirm by noon.")).toHaveLength(2);
  });

  it("folds what can wait into one row that opens", () => {
    render(<BriefCard brief={brief()} />);
    const toggle = screen.getByRole("button", { name: /3 emails can wait/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("News Weekly and Shop Deals");
    const list = screen.getByText("This week in pottery").closest("ul")!;
    expect(list.hidden).toBe(true);
    expect(toggle.getAttribute("aria-controls")).toBe(list.id);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
  });

  it("starts an email and marks it started", () => {
    const onStart = vi.fn();
    render(<BriefCard brief={brief()} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: "Start: Pat Example · Delivery on Thursday?" }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ emailId: "e1" }));
    expect(screen.getByText("Started")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Start:/ })).toHaveLength(1);
  });

  it("has no Start buttons when nobody can start anything", () => {
    render(<BriefCard brief={brief()} />);
    expect(screen.queryByRole("button", { name: /^Start/ })).toBeNull();
  });

  it("says what it couldn't check, and why", () => {
    render(<BriefCard brief={brief()} />);
    const section = screen.getByRole("region", { name: "Couldn't check" });
    expect(within(section).getByText("Calendar:")).toBeTruthy();
    expect(within(section).getByText("not connected")).toBeTruthy();
  });

  it("shows today's calendar", () => {
    render(<BriefCard brief={brief()} />);
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByText("Supplier call")).toBeTruthy();
    expect(within(today).getByText("Studio")).toBeTruthy();
  });

  it("folds a long Needs you list after five rows", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      item(`n${i}`, `Sender ${i}`, `Subject ${i}`, "needs_you"),
    );
    render(<BriefCard brief={brief({ needsYou: many })} />);
    expect(screen.queryByText("Subject 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(screen.getByText("Subject 6")).toBeTruthy();
  });

  it("says so when there is nothing at all", () => {
    render(<BriefCard brief={brief({ needsYou: [], canWait: [], calendar: [], couldNotCheck: [] })} />);
    expect(screen.getByText("Nothing new needs you, and nothing is on your calendar today.")).toBeTruthy();
  });
});
