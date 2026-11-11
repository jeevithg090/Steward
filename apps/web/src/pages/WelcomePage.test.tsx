import type { SetupCheck } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Navigate, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityProvider } from "@/app/accessibility.tsx";
import { forgetWelcome, hasFinishedWelcome } from "@/lib/onboarding.ts";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { WelcomePage } from "./WelcomePage.tsx";

beforeEach(() => forgetWelcome());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const INFO = {
  brand: { name: "Steward", tagline: "Does the work." },
  agents: [],
  starters: [],
  model: { provider: "scripted", model: "steward-scripted", scripted: true },
  mail: { connected: true, label: "Demo inbox", isDemo: true },
};

const CHECKS: SetupCheck[] = [
  {
    id: "model",
    label: "AI model",
    status: "needs_setup",
    optional: false,
    detail: "Steward is using the scripted demo model.",
    href: "/settings",
  } as SetupCheck,
];

function serve(info = INFO) {
  return mockFetch((req) => {
    if (req.path === "/api/info") return { body: info };
    if (req.path === "/api/setup") return { body: CHECKS };
    return undefined;
  });
}

/** Today's own guard: a first visit goes to the welcome. */
function Today() {
  return hasFinishedWelcome() ? <p>Today</p> : <Navigate to="/welcome" replace />;
}

function draw(route = "/welcome") {
  return renderWithProviders(
    <AccessibilityProvider savePlainLanguage={async () => {}}>
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/" element={<Today />} />
        <Route path="/settings" element={<p>Settings</p>} />
      </Routes>
    </AccessibilityProvider>,
    { route },
  );
}

describe("WelcomePage", () => {
  it("names the scripted model and the demo inbox on the first step", async () => {
    serve();
    draw();
    expect(await screen.findByText("You're trying it with a scripted model")).toBeTruthy();
    expect(screen.getByText("You're trying it with a demo inbox")).toBeTruthy();
  });

  it("lets Skip reach Today even when the browser won't store anything", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    serve();
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByText("Today")).toBeTruthy();
  });

  it("counts leaving from the setup checklist as having seen the welcome", async () => {
    serve();
    draw("/welcome?step=setup");
    fireEvent.click(await screen.findByRole("link", { name: "Go to AI model" }));
    expect(await screen.findByText("Settings")).toBeTruthy();
    await waitFor(() => expect(hasFinishedWelcome()).toBe(true));
  });
});
