import type { Device, PhoneCatalogue } from "@steward/shared";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { ShortcutsPage } from "./ShortcutsPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const catalogue: PhoneCatalogue = {
  entries: [
    {
      id: "ask",
      title: "Ask Steward",
      description: "Say what you need.",
      siriPhrase: "Steward",
      action: { kind: "say" },
      scopes: ["chat"],
      source: "core",
      launcher: false,
      steps: ["Say “Hey Siri, Steward”, or open the Steward shortcut."],
    },
    {
      id: "brief",
      title: "What needs me?",
      description: "Today's brief.",
      siriPhrase: "Steward: What needs me?",
      action: { kind: "brief" },
      scopes: ["brief:read"],
      source: "core",
      launcher: true,
      steps: ["Runs the Steward shortcut and goes straight to “What needs me?”."],
    },
    {
      id: "tenant:scam-spotter",
      title: "Scam Spotter",
      description: "Share a text that looks off.",
      siriPhrase: "Tempo: Scam Spotter",
      action: { kind: "tenant", ref: "scam-spotter" },
      scopes: ["chat"],
      source: "tenant",
      launcher: true,
      steps: ["Runs the Steward shortcut and goes straight to “Scam Spotter”."],
      prompt: "/scam-check {input}",
    },
  ],
  steward: {
    steps: ["Pairs with your Steward when you scan the pairing code on your Mac, after you tap Pair."],
    personalSteps: ["Already holds your Steward's address and this phone's key, so it works at once."],
    downloadUrl: "https://mac.tail1234.ts.net/device/shortcut/Steward.shortcut",
    shipped: true,
  },
  automation: { time: "08:00", input: "action:brief" },
  shortcut: {
    id: "steward",
    version: 2,
    minVersion: 1,
    url: "https://mac.tail1234.ts.net/device/shortcut/Steward.shortcut",
    notes: "",
  },
  signing: { available: true },
};

const oldPhone: Device = {
  id: "dev_1",
  name: "Sam's iPhone",
  kind: "shortcut",
  scopes: ["chat"],
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  shortcutVersion: "steward@1",
};

describe("Shortcuts page", () => {
  it("shows the Steward shortcut, suggestions, your setup's shortcuts, installed phones and updates", async () => {
    const server = mockFetch((req) => {
      if (req.path === "/api/phone/catalogue") return { body: catalogue };
      if (req.path === "/api/devices") return { body: [oldPhone] };
      if (req.path === "/api/phone/shortcuts/brief/install")
        return {
          status: 201,
          body: {
            url: "https://mac.tail1234.ts.net/device/install/abc.shortcut",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            name: "Steward What needs me",
            personal: false,
          },
        };
      return undefined;
    });
    renderWithProviders(<ShortcutsPage />);
    expect(await screen.findByRole("img", { name: "QR code to download the Steward shortcut" })).toBeTruthy();

    const suggested = screen.getByRole("region", { name: "Suggested for you" });
    const brief = within(suggested).getByRole("listitem", { name: "What needs me?" });
    expect(within(suggested).queryByRole("listitem", { name: "Ask Steward" })).toBeNull();
    expect(within(brief).getByText("Siri: “Hey Siri, Steward What needs me”")).toBeTruthy();
    fireEvent.click(within(brief).getByRole("button", { name: "Add to iPhone" }));
    expect(
      await within(brief).findByRole("img", { name: "QR code to add What needs me? to your iPhone" }),
    ).toBeTruthy();
    expect(
      within(brief)
        .getByRole("link", { name: /On this iPhone\? Download it/ })
        .getAttribute("href"),
    ).toBe("https://mac.tail1234.ts.net/device/install/abc.shortcut");
    expect(
      server.calls.some((c) => c.method === "POST" && c.path === "/api/phone/shortcuts/brief/install"),
    ).toBe(true);

    const setup = screen.getByRole("region", { name: "From your setup" });
    expect(within(setup).getByRole("listitem", { name: "Scam Spotter" })).toBeTruthy();

    expect(await screen.findByText(/steward@1/)).toBeTruthy();
    const updates = screen.getByRole("region", { name: "Updates" });
    expect(within(updates).getByText(/Sam's iPhone has an older Steward shortcut/)).toBeTruthy();

    const morning = screen.getByRole("region", { name: "Your brief, every weekday morning" });
    expect(within(morning).getByText("action:brief")).toBeTruthy();
  });

  it("warns that the one-tap file holds the phone's key", async () => {
    mockFetch((req) => {
      if (req.path === "/api/phone/catalogue") return { body: catalogue };
      if (req.path === "/api/devices") return { body: [] };
      if (req.path === "/api/phone/shortcuts/steward/install")
        return {
          status: 201,
          body: {
            url: "https://mac.tail1234.ts.net/device/install/def.shortcut",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            name: "Steward",
            personal: true,
          },
        };
      return undefined;
    });
    renderWithProviders(<ShortcutsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a one-tap file" }));
    expect(await screen.findByText("This file holds your phone's key")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "QR code to download your one-tap Steward shortcut" }),
    ).toBeTruthy();
  });
});
