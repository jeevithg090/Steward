import type { AuditPage, ChainCheck } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { RecordPage } from "./RecordPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HASH = "3fa9".repeat(16);
const head = { seq: 12, hash: HASH, at: "2026-10-27T09:00:00.000Z" };
const empty: AuditPage = { events: [], total: 0 };

function serve(quick: ChainCheck, more: (req: FakeRequest) => ChainCheck | undefined = () => undefined) {
  return mockFetch((req) => {
    if (req.path === "/api/audit") return { body: empty };
    if (req.path === "/api/audit/verify") {
      const anchor = req.query.get("anchor");
      if (anchor === "nonsense") return { status: 400, body: { error: "That seal doesn't look right." } };
      return { body: more(req) ?? quick };
    }
    return undefined;
  });
}

describe("RecordPage", () => {
  it("says when only the new entries were checked, and checks everything on request", async () => {
    const server = serve(
      { ok: true, count: 12, scope: "recent", fullCheckAt: new Date().toISOString(), head },
      (req) => (req.query.get("full") === "1" ? { ok: true, count: 12, scope: "full", head } : undefined),
    );
    renderWithProviders(<RecordPage />);
    expect(await screen.findByText("Record intact · 12 entries")).toBeTruthy();
    expect(screen.getByText(/^New entries checked\. Every entry was checked just now\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check the whole record" }));
    expect(await screen.findByText("Record intact · 12 entries verified")).toBeTruthy();
    expect(server.calls.some((c) => c.url === "/api/audit/verify?full=1")).toBe(true);
  });

  it("names the first entry that is missing or changed", async () => {
    serve({ ok: false, count: 3, brokenAt: 4, scope: "full" });
    renderWithProviders(<RecordPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Entry #4 is missing or has changed.");
    expect(screen.queryByText(/newest seal/i)).toBeNull();
  });

  it("shows the newest seal to write down, and checks one written down earlier", async () => {
    const server = serve({ ok: true, count: 12, scope: "full", head }, (req) => {
      const anchor = req.query.get("anchor");
      if (!anchor) return undefined;
      const [seq, hash] = anchor.split(":");
      const ok = hash === HASH;
      return { ok, count: 12, scope: "full", head, anchor: { seq: Number(seq), hash: hash ?? "", ok } };
    });
    renderWithProviders(<RecordPage />);
    fireEvent.click(await screen.findByText("Newest seal #12"));
    expect(await screen.findByText(HASH)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the seal" })).toBeTruthy();

    const box = screen.getByRole("textbox", { name: "Check a seal you saved" });
    fireEvent.change(box, { target: { value: `#12:${"0".repeat(64)}` } });
    fireEvent.click(screen.getByRole("button", { name: "Check it" }));
    expect(
      await screen.findByText(
        "That seal doesn't match entry #12. The record was cut short or rewritten since you saved it.",
      ),
    ).toBeTruthy();
    expect(server.calls.some((c) => c.query.get("anchor") === `12:${"0".repeat(64)}`)).toBe(true);

    fireEvent.change(box, { target: { value: `12:${HASH}` } });
    fireEvent.click(screen.getByRole("button", { name: "Check it" }));
    expect(
      await screen.findByText("That seal still matches entry #12. The record up to it has not changed."),
    ).toBeTruthy();

    fireEvent.change(box, { target: { value: "nonsense" } });
    fireEvent.click(screen.getByRole("button", { name: "Check it" }));
    expect(await screen.findByText("That seal doesn't look right.")).toBeTruthy();
  });

  it("downloads the whole record, and filters to calls that failed", async () => {
    const server = serve({ ok: true, count: 1, scope: "full", head: { ...head, seq: 1 } });
    renderWithProviders(<RecordPage />);
    const download = await screen.findByRole("link", { name: "Download the record" });
    expect(download.getAttribute("href")).toBe("/api/audit/export");
    expect(download.hasAttribute("download")).toBe(true);

    fireEvent.change(screen.getByRole("combobox", { name: "Outcome" }), { target: { value: "failed" } });
    await waitFor(() =>
      expect(server.calls.some((c) => c.url === "/api/audit?effect=failed&limit=50")).toBe(true),
    );
  });
});
