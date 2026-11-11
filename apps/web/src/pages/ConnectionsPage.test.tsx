import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerDetail } from "@/lib/api.ts";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ConnectionsPage } from "./ConnectionsPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOTES: McpServerDetail = {
  id: "notes",
  name: "My notes",
  transport: "stdio",
  status: "connected",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/My Notes"],
  tools: [],
};

function serve(mail = { connected: true, label: "Demo inbox", isDemo: true }, mcp: McpServerDetail[] = []) {
  return mockFetch((req) => {
    if (req.path === "/api/connections") return { body: { mail, mcp, builtin: [] } };
    if (req.path === "/api/connections/mcp" && req.method === "POST") {
      return { status: 201, body: { ...NOTES, ...(req.body as object), tools: [] } };
    }
    return undefined;
  });
}

const field = (name: RegExp) => screen.getByRole("textbox", { name }) as HTMLInputElement;

async function fill(args: string) {
  await screen.findByRole("heading", { name: "Add an app" });
  fireEvent.change(field(/^Name/), { target: { value: "My notes" } });
  fireEvent.change(field(/^Short id/), { target: { value: "notes" } });
  fireEvent.change(field(/^Program/), { target: { value: "npx" } });
  fireEvent.change(field(/^Arguments/), { target: { value: args } });
}

describe("Connections: adding an app", () => {
  it("keeps a quoted argument with a space in it whole, without its quotes", async () => {
    const server = serve();
    renderWithProviders(<ConnectionsPage />);
    await fill('-y @modelcontextprotocol/server-filesystem "/Users/me/My Notes"');
    // The person sees the arguments as the program will get them, before adding it.
    expect(screen.getByText("/Users/me/My Notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add app" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    expect(server.calls.find((c) => c.method === "POST")?.body).toMatchObject({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/My Notes"],
    });
  });

  it("refuses arguments with a quote left open", async () => {
    const server = serve();
    renderWithProviders(<ConnectionsPage />);
    await fill("-y server-filesystem '/Users/me/My Notes");
    expect(screen.getByText(/single quote isn't closed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add app" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows a saved argument with a space in it in quotes", async () => {
    serve(undefined, [NOTES]);
    renderWithProviders(<ConnectionsPage />);
    expect(
      await screen.findByText(/npx -y @modelcontextprotocol\/server-filesystem "\/Users\/me\/My Notes"/),
    ).toBeTruthy();
  });
});

describe("Connections: mail", () => {
  it("never asks for Google credentials that Steward can't use yet", async () => {
    serve();
    renderWithProviders(<ConnectionsPage />);
    const text = (await screen.findByText(/made-up inbox/)).textContent ?? "";
    expect(text).toContain("isn't available yet");
    expect(text).not.toMatch(/credentials|STEWARD_DEMO_GOOGLE=0/);
  });

  it("says how to get the demo inbox back when no mail is connected", async () => {
    serve({ connected: false, label: "Not connected", isDemo: false });
    renderWithProviders(<ConnectionsPage />);
    expect(await screen.findByText(/STEWARD_DEMO_GOOGLE=1/)).toBeTruthy();
  });
});
