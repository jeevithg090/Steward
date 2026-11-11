import type { MemoryFact } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { MemoryPage } from "./MemoryPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FACT = {
  id: "mem_1",
  text: "Prefers meetings after 10:00.",
  source: "learned",
  createdAt: "2026-11-10T08:00:00Z",
} as MemoryFact;

function serve(facts: MemoryFact[] = [FACT]) {
  return mockFetch((req) => {
    if (req.path === "/api/memory" && req.method === "GET") return { body: facts };
    if (req.path === "/api/memory" && req.method === "POST") {
      return {
        status: 201,
        body: { ...FACT, id: "mem_2", source: "you", text: (req.body as { text: string }).text },
      };
    }
    if (req.path === "/api/memory/mem_1" && req.method === "DELETE") return { status: 204 };
    return undefined;
  });
}

describe("MemoryPage", () => {
  it("remembers what the person types, trimmed", async () => {
    const server = serve();
    renderWithProviders(<MemoryPage />);
    const box = await screen.findByRole("textbox", { name: /Something to remember/ });
    const remember = screen.getByRole("button", { name: "Remember this" }) as HTMLButtonElement;
    expect(remember.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  I don't take calls on Fridays.  " } });
    fireEvent.click(remember);
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    expect(server.calls.find((c) => c.method === "POST")?.body).toEqual({
      text: "I don't take calls on Fridays.",
    });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(""));
  });

  it("forgets a fact, and says where each one came from", async () => {
    const server = serve();
    renderWithProviders(<MemoryPage />);
    expect(await screen.findByText("Steward noticed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget: Prefers meetings after 10:00." }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(server.calls.find((c) => c.method === "DELETE")?.path).toBe("/api/memory/mem_1");
  });

  it("says when there is nothing remembered yet", async () => {
    serve([]);
    renderWithProviders(<MemoryPage />);
    expect(await screen.findByText("Nothing yet")).toBeTruthy();
  });
});
