import type { SetupCheck } from "@steward/shared";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { SetupChecklist, summariseSetup, withBrowserFacts } from "./SetupChecklist.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** What the server says: it can't see the browser, so both of these are "not checked". */
const CHECKS: SetupCheck[] = [
  { id: "model", label: "AI model", status: "ready", optional: false, detail: "A real model." },
  {
    id: "notifications",
    label: "Notifications",
    status: "not_checked",
    optional: true,
    detail: "Your browser decides.",
    fix: "Turn them on in Settings.",
    href: "/settings",
  },
  {
    id: "voice",
    label: "Voice",
    status: "not_checked",
    optional: true,
    detail: "Replies can be read aloud.",
    fix: "Try it in Settings.",
    href: "/settings",
  },
];

describe("the setup checklist in this browser", () => {
  it("answers Notifications and Voice from what the browser says", () => {
    const allowed = withBrowserFacts(CHECKS, { notifications: "granted", speech: true });
    expect(allowed.map((c) => c.status)).toEqual(["ready", "ready", "ready"]);
    expect(summariseSetup(allowed)).toBe("Everything is set up.");

    const blocked = withBrowserFacts(CHECKS, { notifications: "denied", speech: false });
    const notifications = blocked.find((c) => c.id === "notifications")!;
    expect(notifications.status).toBe("needs_setup");
    expect(notifications.fix).toBe("Allow notifications for this site in your browser's settings.");
    expect(blocked.find((c) => c.id === "voice")?.status).toBe("needs_setup");
    expect(summariseSetup(blocked)).toBe("2 things need setup. Steward works without them.");

    const off = withBrowserFacts(CHECKS, { notifications: "default", speech: true });
    expect(off.find((c) => c.id === "notifications")).toMatchObject({
      status: "needs_setup",
      fix: "Turn them on in Settings.",
    });
  });

  it("can say everything is set up", async () => {
    vi.stubGlobal("Notification", { permission: "granted", requestPermission: async () => "granted" });
    vi.stubGlobal("speechSynthesis", { speak() {}, cancel() {}, getVoices: () => [] });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    mockFetch((req) => (req.path === "/api/setup" ? { body: CHECKS } : undefined));
    renderWithProviders(<SetupChecklist />);
    expect(await screen.findByText("Everything is set up.")).toBeTruthy();
    expect(screen.queryByText("Not checked")).toBeNull();
  });
});
