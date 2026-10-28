import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeRequest, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { INVOICE_CHASER } from "./fixtures.ts";
import { SubmitToDirectory } from "./SubmitToDirectory.tsx";

let saved: string[];

beforeEach(() => {
  saved = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function serve(directory: { name: string; site?: string }, exportStatus = 200) {
  return mockFetch((req: FakeRequest) => {
    if (req.path === "/api/bots") return { body: { bots: [], total: 0, directory } };
    if (req.path === "/api/bots/export") {
      return exportStatus === 200
        ? { body: "PK" }
        : {
            status: exportStatus,
            body: { error: 'This bot can\'t be submitted: The rule "Pay" would allow something.' },
          };
    }
    return undefined;
  });
}

describe("SubmitToDirectory", () => {
  it("links the hosted directory's submit page and downloads the pack folder with the handle", async () => {
    const { calls } = serve({ name: "Steward bots", site: "https://bots.example.org/" });
    renderWithProviders(<SubmitToDirectory pack={INVOICE_CHASER} />);
    expect(screen.getByRole("heading", { name: "Submit to the directory" })).toBeTruthy();
    const link = await screen.findByRole("link", { name: /Open the submit page/ });
    expect(link.getAttribute("href")).toBe("https://bots.example.org/submit");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.change(screen.getByLabelText(/Your GitHub handle/), { target: { value: "@ana-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Download the pack folder" }));
    await screen.findByRole("status");
    expect(screen.getByRole("status").textContent).toContain(`Saved ${INVOICE_CHASER.id}.zip`);
    expect(saved).toEqual([`${INVOICE_CHASER.id}.zip`]);
    const exported = calls.find((c) => c.path === "/api/bots/export");
    expect(exported?.method).toBe("POST");
    expect(exported?.body).toEqual({ pack: INVOICE_CHASER, handle: "ana-b" });
  });

  it("says a folder directory takes no submissions, and still offers the download", async () => {
    serve({ name: "Steward bots" });
    renderWithProviders(<SubmitToDirectory pack={INVOICE_CHASER} />);
    expect(await screen.findByRole("note")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("takes no submissions");
    expect(screen.queryByRole("link", { name: /submit page/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Download the pack folder" })).toBeTruthy();
  });

  it("never links a directory site that is not a web address", async () => {
    serve({ name: "Odd", site: "javascript:alert(1)" });
    renderWithProviders(<SubmitToDirectory pack={INVOICE_CHASER} />);
    await screen.findByRole("note");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("refuses a handle that is not one, and shows the server's refusal", async () => {
    serve({ name: "Steward bots", site: "https://bots.example.org" }, 400);
    renderWithProviders(<SubmitToDirectory pack={INVOICE_CHASER} />);
    fireEvent.change(screen.getByLabelText(/Your GitHub handle/), { target: { value: "not a handle" } });
    expect(screen.getByText("A GitHub handle is letters, digits and single hyphens.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Download the pack folder" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/Your GitHub handle/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Download the pack folder" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("can't be submitted"));
    expect(saved).toEqual([]);
  });
});
