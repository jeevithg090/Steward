import type { Approval } from "@steward/shared";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { bannerQuietOn, NeedsYouBanner } from "./banners.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pending = (id: string, threadId: string) =>
  ({ id, threadId, status: "pending", summary: `Send the email ${id}` }) as Approval;

describe("the waiting-on-you banner", () => {
  it("stays quiet where the requests are already on screen", () => {
    const one = [pending("apr_1", "thr_1")];
    expect(bannerQuietOn("/", one)).toBe(true);
    expect(bannerQuietOn("/tasks", one)).toBe(true);
    expect(bannerQuietOn("/chat/thr_1", one)).toBe(true);
    expect(bannerQuietOn("/rules", one)).toBe(false);
    expect(bannerQuietOn("/record", one)).toBe(false);
    expect(bannerQuietOn("/chat/thr_2", one)).toBe(false);
    expect(bannerQuietOn("/chat/thr_1", [...one, pending("apr_2", "thr_2")])).toBe(false);
  });

  it("sends one request to its own conversation, and several to Tasks", async () => {
    mockFetch((req) => (req.path === "/api/approvals" ? { body: [pending("apr_1", "thr 1")] } : undefined));
    renderWithProviders(<NeedsYouBanner />, { route: "/rules" });
    const link = (await screen.findByRole("link", { name: "Answer it" })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/chat/thr%201");
    cleanup();

    mockFetch((req) =>
      req.path === "/api/approvals"
        ? { body: [pending("apr_1", "thr_1"), pending("apr_2", "thr_2")] }
        : undefined,
    );
    renderWithProviders(<NeedsYouBanner />, { route: "/rules" });
    const many = (await screen.findByRole("link", { name: "Answer them" })) as HTMLAnchorElement;
    expect(many.getAttribute("href")).toBe("/tasks?view=needs_you");
  });
});
