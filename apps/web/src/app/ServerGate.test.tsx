import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys, useInfo } from "@/lib/api.ts";
import { type FakeResponse, mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ServerGate } from "./ServerGate.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INFO = {
  tenant: { id: "steward", name: "Steward" },
  agents: [{ id: "steward", name: "Steward" }],
  model: { provider: "scripted", model: "steward-scripted", scripted: true },
  mail: { isDemo: true },
};

/** Stands for the app: it asks for /api/info itself, as every page does, and counts its mounts. */
let mounts = 0;
function Probe() {
  useInfo();
  useEffect(() => {
    mounts++;
  }, []);
  return <p>The app</p>;
}

function serve(answer: () => FakeResponse | Promise<FakeResponse>) {
  return mockFetch((req) => (req.path === "/api/info" ? answer() : { status: 404 }));
}

const infoCalls = (server: ReturnType<typeof mockFetch>) =>
  server.calls.filter((c) => c.path === "/api/info").length;

describe("ServerGate", () => {
  it("says it is connecting while the server has not answered, inside a main landmark", async () => {
    serve(() => new Promise<FakeResponse>(() => {}));
    renderWithProviders(
      <ServerGate>
        <Probe />
      </ServerGate>,
    );
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Connecting to Steward…");
    expect(screen.getByRole("main").contains(status)).toBe(true);
    expect(screen.queryByText("The app")).toBeNull();
  });

  it("says the server isn't answering, without drawing the app or asking again in a loop", async () => {
    mounts = 0;
    // Vite's proxy answers an empty 502 while the server is down.
    const server = serve(() => ({ status: 502 }));
    renderWithProviders(
      <ServerGate>
        <Probe />
      </ServerGate>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Steward isn't answering");
    expect(alert.textContent).toContain("pnpm dev");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("The app")).toBeNull();
    expect(mounts).toBe(0);
    expect(infoCalls(server)).toBe(1);
  });

  it("draws the app once the server answers, and keeps it drawn when the server goes away", async () => {
    mounts = 0;
    let up = false;
    const server = serve(() => (up ? { body: INFO } : { status: 502 }));
    const { client } = renderWithProviders(
      <ServerGate>
        <Probe />
      </ServerGate>,
    );
    await screen.findByRole("alert");

    up = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("The app");
    expect(mounts).toBe(1);

    up = false;
    await client.invalidateQueries({ queryKey: queryKeys.info });
    await waitFor(() => expect(infoCalls(server)).toBe(3));
    expect(screen.getByText("The app")).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it("shows Steward's own sentence when the server answered with one", async () => {
    serve(() => ({ status: 500, body: { error: "Steward couldn't open its database." } }));
    renderWithProviders(
      <ServerGate>
        <Probe />
      </ServerGate>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Steward couldn't open its database.");
    expect(alert.textContent).not.toContain("pnpm dev");
  });
});
