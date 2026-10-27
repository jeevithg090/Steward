import type { Approval } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function approval(over: Partial<Approval> = {}): Approval {
  return {
    id: "apr_1",
    toolCallId: "call_1",
    runId: "run_1",
    threadId: "thr_1",
    agentId: "steward",
    status: "pending",
    summary: "Pay £24.00 to shop.example.com",
    tool: { name: "browser_click", kind: "pay", surface: "browser", source: "builtin" },
    args: { ref: "e12" },
    target: { host: "shop.example.com", amount: { value: 2400, currency: "GBP" } },
    decision: {
      effect: "ask",
      rule: { id: "preset.pay", name: "Payments always ask", source: "preset" },
      reason: "Paying for something always asks.",
      findings: [{ kind: "card_number", hint: "•••• 4242", label: "Card number" }],
    },
    canAlways: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

describe("ApprovalCard", () => {
  it("shows what, where, why and what is sensitive", async () => {
    const initial = approval();
    mockFetch(() => ({ body: initial }));
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);

    expect(screen.getByRole("region", { name: "Pay £24.00 to shop.example.com" })).toBeTruthy();
    expect(screen.getByText("Click on the page")).toBeTruthy();
    expect(screen.getByText(/shop\.example\.com/, { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("Payments always ask")).toBeTruthy();
    expect(screen.getByText("Card number", { exact: false }).textContent).toContain("•••• 4242");
    expect(screen.getByText("Steward is asking")).toBeTruthy();
  });

  it("offers Refuse and Allow once, and no Always allow when the gateway forbids it", () => {
    const initial = approval({ canAlways: false });
    mockFetch(() => ({ body: initial }));
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    expect(screen.getByRole("button", { name: "Refuse" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.getByText(/always asks, so there is no Always allow/)).toBeTruthy();
  });

  it("offers Always allow when canAlways is true", () => {
    const initial = approval({ canAlways: true });
    mockFetch(() => ({ body: initial }));
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    expect(screen.getByRole("button", { name: "Always allow" })).toBeTruthy();
  });

  it("posts the answer, calls onDecided and announces the result", async () => {
    const initial = approval({ canAlways: true });
    const decided = approval({ status: "allowed", answer: "once", decidedAt: new Date().toISOString() });
    const { calls } = mockFetch((req) =>
      req.method === "POST" && req.path === "/api/approvals/apr_1/decision"
        ? { body: decided }
        : { body: initial },
    );
    const onDecided = vi.fn();
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} onDecided={onDecided} />);

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(decided));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ answer: "once" });
    expect(await screen.findByText("Allowed once. Steward will carry on.")).toBeTruthy();
    expect(screen.getByText("Allowed once")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  });

  it("sends a note with a refusal", async () => {
    const initial = approval();
    const { calls } = mockFetch((req) =>
      req.method === "POST" ? { body: approval({ status: "refused", answer: "refuse" }) } : { body: initial },
    );
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.change(screen.getByLabelText("Tell Steward why (optional)"), {
      target: { value: "Too expensive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: "refuse", note: "Too expensive" });
  });

  it("shows where an already-answered request stands", () => {
    const initial = approval({ status: "refused", answer: "refuse", decidedAt: new Date().toISOString() });
    mockFetch(() => ({ body: initial }));
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    expect(screen.getByText("Refused")).toBeTruthy();
    expect(screen.getByText(/You refused this/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refuse" })).toBeNull();
  });

  it("says an expired request did nothing", () => {
    const initial = approval({ status: "expired" });
    mockFetch(() => ({ body: initial }));
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("Nobody answered in time, so Steward didn't do it.")).toBeTruthy();
  });

  it("explains when someone else answered first", async () => {
    const initial = approval();
    mockFetch((req) =>
      req.method === "POST"
        ? { status: 409, body: { error: "Already decided." } }
        : { body: approval({ status: "allowed", answer: "once" }) },
    );
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/already answered/);
  });

  it("fetches the request when it has nothing to start from", async () => {
    mockFetch(() => ({ body: approval({ summary: "Delete report.md" }) }));
    renderWithProviders(<ApprovalCard approvalId="apr_1" />);
    expect(screen.getByText("Loading the request…")).toBeTruthy();
    expect(await screen.findByText("Delete report.md")).toBeTruthy();
  });
});
