import type { Approval, ConversationAllow } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "@/components/cards/ApprovalCard.tsx";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ConversationAllows } from "./ConversationAllows.tsx";

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
    summary: "Click 'Next' on news.example",
    tool: { name: "calendar_create", kind: "write", surface: "calendar", source: "builtin" },
    args: {},
    target: {},
    decision: {
      effect: "ask",
      rule: { id: "default:write-asks", name: "Changes elsewhere ask", source: "preset" },
      reason: "Changes to your calendar, mail or connected services ask first",
      findings: [],
    },
    canAlways: true,
    canConversation: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

const ALLOW: ConversationAllow = {
  id: "cva_1",
  threadId: "thr_1",
  agentId: "steward",
  name: "calendar_create, in this conversation",
  when: 'tool.name == "calendar_create"',
  summary: "Add 'Dentist' to your calendar",
  approvalId: "apr_1",
  createdAt: new Date().toISOString(),
};

describe("Allow in this conversation on the approval card", () => {
  it("is offered where the gateway offers it, and sends that answer", async () => {
    const initial = approval();
    const decided = approval({
      status: "allowed",
      answer: "conversation",
      decidedAt: new Date().toISOString(),
    });
    const { calls } = mockFetch((req) =>
      req.method === "POST" && req.path === "/api/approvals/apr_1/decision"
        ? { body: decided }
        : { body: initial },
    );
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={initial} />);
    expect(screen.getByText(/lets the same again run here only/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow in this conversation" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: "conversation" }),
    );
    expect(await screen.findByText("Allowed in this conversation")).toBeTruthy();
    expect(
      screen.getByText(/for this conversation\. Steward won't ask again for the same thing here/),
    ).toBeTruthy();
  });

  it("is not offered for a routine's ask, a tainted send or anything without Always allow", () => {
    mockFetch(() => undefined);
    renderWithProviders(
      <ApprovalCard approvalId="apr_1" initial={approval({ canAlways: false, canConversation: false })} />,
    );
    expect(screen.queryByRole("button", { name: "Allow in this conversation" })).toBeNull();
    cleanup();
    renderWithProviders(<ApprovalCard approvalId="apr_1" initial={approval({ canConversation: false })} />);
    expect(screen.queryByRole("button", { name: "Allow in this conversation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeTruthy();
  });
});

describe("ConversationAllows", () => {
  it("shows nothing when nothing was allowed", async () => {
    const { calls } = mockFetch(() => ({ body: [] }));
    const { container } = renderWithProviders(<ConversationAllows threadId="thr_1" />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container.textContent).toBe("");
  });

  it("names each allow above the message box, and turns one off", async () => {
    let allows = [ALLOW];
    const { calls } = mockFetch((req) => {
      if (req.method === "GET" && req.path === "/api/threads/thr_1/allows") return { body: allows };
      if (req.method === "DELETE" && req.path === "/api/threads/thr_1/allows/cva_1") {
        allows = [];
        return { body: { ok: true } };
      }
      return undefined;
    });
    renderWithProviders(<ConversationAllows threadId="thr_1" />);
    expect(await screen.findByRole("region", { name: "Allowed in this conversation" })).toBeTruthy();
    expect(screen.getByText(/Add 'Dentist' to your calendar, and the same again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off: Add 'Dentist' to your calendar" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Allowed in this conversation" })).toBeNull(),
    );
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});
