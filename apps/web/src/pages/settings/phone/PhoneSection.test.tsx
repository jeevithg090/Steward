import type { Device, PairingOffer, PhoneInfo } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { PhoneSection } from "./PhoneSection.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const info = (over: Partial<PhoneInfo> = {}): PhoneInfo => ({
  listener: { port: 8788, running: true },
  mainPort: 8787,
  url: "https://mac.tail1234.ts.net",
  hosts: ["mac.tail1234.ts.net"],
  transports: [
    { id: "tailscale", found: true, command: "tailscale serve --bg 8788" },
    { id: "cloudflared", found: false, command: "cloudflared tunnel --url http://127.0.0.1:8788" },
  ],
  presets: [
    {
      id: "preset_device_floor",
      name: "From a phone, payments, signing and passwords are finished on your Mac",
      description: "…",
      phoneMessage: "Open Steward on your Mac to finish this.",
    },
  ],
  shortcut: { id: "steward", version: 1, minVersion: 1, url: "https://mac.tail1234.ts.net/x", notes: "" },
  relay: { configured: false, connected: false, sees: [] },
  ...over,
});

const offer: PairingOffer = {
  kind: "shortcut",
  code: "K7M2Q9XP",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  qrText: "shortcuts://run-shortcut?name=Steward&input=text&text=steward-pair%3A1%3Aabc",
  shortcutUrl: "https://mac.tail1234.ts.net/device/shortcut/Steward.shortcut",
  deviceUrl: "https://mac.tail1234.ts.net",
};

const phone: Device = {
  id: "dev_1",
  name: "Sam's iPhone",
  kind: "shortcut",
  scopes: ["brief:read", "approvals:read", "chat", "tasks", "routines:run"],
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  shortcutVersion: "steward@1",
};

describe("Settings → Phone", () => {
  it("offers two QR codes, each with a link and a copy button, then turns green when the phone pairs", async () => {
    let devices: Device[] = [];
    const server = mockFetch((req) => {
      if (req.path === "/api/phone") return { body: info() };
      if (req.path === "/api/devices") return { body: devices };
      if (req.path === "/api/devices/pairing") return { status: 201, body: offer };
      return undefined;
    });
    renderWithProviders(<PhoneSection />);
    expect(await screen.findByText(/never Steward's main port 8787/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Add iPhone" }));

    expect(await screen.findByRole("img", { name: "QR code to download the Steward shortcut" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "QR code to pair your iPhone with Steward" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "On this iPhone? Get the shortcut" }).getAttribute("href")).toBe(
      offer.shortcutUrl,
    );
    expect(screen.getByRole("link", { name: "On this iPhone? Pair it" }).getAttribute("href")).toBe(
      offer.qrText,
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy pairing link" })).toBeTruthy();
    expect(screen.getByText("K7M2 Q9XP")).toBeTruthy();
    expect(server.calls.find((c) => c.path === "/api/devices/pairing")?.body).toEqual({ kind: "shortcut" });

    devices = [phone];
    const status = await screen.findByText("Sam's iPhone paired", {}, { timeout: 5000 });
    expect(status.closest("[role=status]")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /QR code/ })).toBeNull();
  });

  it("explains that the address comes first", async () => {
    mockFetch((req) => {
      if (req.path === "/api/phone") return { body: info({ url: null, hosts: [] }) };
      if (req.path === "/api/devices") return { body: [] };
      return undefined;
    });
    renderWithProviders(<PhoneSection />);
    const add = await screen.findByRole("button", { name: "Add iPhone" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Set the phone address under Connection first.")).toBeTruthy();
  });

  it("names the ports this Steward really uses, not the defaults", async () => {
    mockFetch((req) => {
      if (req.path === "/api/phone")
        return { body: info({ listener: { port: 8798, running: true }, mainPort: 8797 }) };
      if (req.path === "/api/devices") return { body: [] };
      return undefined;
    });
    renderWithProviders(<PhoneSection />);
    expect(await screen.findByText(/Tunnel port 8798, never Steward's main port 8797/)).toBeTruthy();
    expect(screen.getByText(/http:\/\/your-mac\.local:8798 also works/)).toBeTruthy();
  });

  it("keeps saying yes off until switched on, with the plain warning, and revokes after a confirm", async () => {
    const server = mockFetch((req) => {
      if (req.path === "/api/phone") return { body: info() };
      if (req.path === "/api/devices" && req.method === "GET") return { body: [phone] };
      if (req.path === "/api/devices/dev_1" && req.method === "PATCH")
        return { body: { ...phone, scopes: (req.body as { scopes: string[] }).scopes } };
      if (req.path === "/api/devices/dev_1" && req.method === "DELETE") return { body: { ok: true } };
      return undefined;
    });
    renderWithProviders(<PhoneSection />);
    const row = await screen.findByRole("listitem", { name: "Sam's iPhone" });
    const yes = within(row).getByRole("switch", { name: "Say yes to requests" });
    expect(yes.getAttribute("aria-checked")).toBe("false");
    expect(within(row).getByText(/This phone can say yes to things Steward asks about/)).toBeTruthy();
    fireEvent.click(yes);
    await waitFor(() => expect(server.calls.some((c) => c.method === "PATCH")).toBe(true));
    const sent = server.calls.find((c) => c.method === "PATCH")?.body as { scopes: string[] } | undefined;
    expect(sent?.scopes).toContain("approvals:decide");

    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    expect(within(row).getByText(/Its key stops working at once/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Remove phone" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("pairs the phone app only after the person sees the same code on both screens", async () => {
    let state = { state: "waiting", expiresAt: new Date(Date.now() + 120_000).toISOString() } as Record<
      string,
      unknown
    >;
    const server = mockFetch((req) => {
      if (req.path === "/api/phone")
        return {
          body: info({
            relay: {
              configured: true,
              connected: true,
              url: "https://relay.example.com",
              sees: ["Which phones are paired, by id"],
            },
          }),
        };
      if (req.path === "/api/devices") return { body: [] };
      if (req.path === "/api/devices/remote-pairing" && req.method === "POST")
        return {
          status: 201,
          body: {
            pairingId: "p".repeat(32),
            url: `https://relay.example.com/#pair=${"p".repeat(32)}.key`,
            expiresAt: state.expiresAt,
          },
        };
      if (req.path === `/api/devices/remote-pairing/${"p".repeat(32)}`) return { body: state };
      if (req.path.endsWith("/confirm")) return { body: { id: "dev_9", name: "Sam's iPhone" } };
      return undefined;
    });
    renderWithProviders(<PhoneSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Add phone (app)" }));
    expect(await screen.findByRole("img", { name: "QR code to pair the Steward phone app" })).toBeTruthy();
    expect(screen.getByText("Which phones are paired, by id")).toBeTruthy();
    state = { ...state, state: "check", name: "Sam's iPhone", code: "482 913" };
    expect(await screen.findByText("Pair “Sam's iPhone”? Code 482 913", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "The codes match: pair" }));
    await waitFor(() => expect(server.calls.some((c) => c.path.endsWith("/confirm"))).toBe(true));
  });
});
