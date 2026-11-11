import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Page } from "@/components/ui/PageHeader.tsx";
import { claimRouteFocus } from "@/lib/focus.ts";
import { mockFetch, testQueryClient } from "@/lib/testing.tsx";
import { AccessibilityProvider } from "./accessibility.tsx";
import { AppShell } from "./Layout.tsx";

/** Pretends the window is this many CSS pixels wide, at the browser's default 16px text. */
function stubWidth(px: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const em = /min-width:\s*([\d.]+)em/.exec(query);
    return {
      matches: em ? px >= Number(em[1]) * 16 : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

// One component per place, as the app has: React keeps a component it can reuse, and a page that
// is reused never mounts its heading again.
const Today = () => <Page title="Today">Your day.</Page>;
const Tasks = () => <Page title="Tasks">Your tasks.</Page>;
const Rules = () => <Page title="Rules">Your rules.</Page>;

/** A place with no heading of its own, so only the shell's fallback can give it focus. */
const NoHeading = () => <p>Nothing to focus here.</p>;

/** A page that sends itself somewhere else with `replace`, as /chat does once it has a conversation. */
function Redirects({ to = "/rules" }: { to?: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    const timer = setTimeout(() => navigate(to, { replace: true }), 0);
    return () => clearTimeout(timer);
  }, [navigate, to]);
  return <p>Moving on…</p>;
}

function draw(path = "/") {
  mockFetch((req) => {
    if (req.path === "/api/tasks") return { body: { tasks: [], counts: {} } };
    if (["/api/approvals", "/api/threads", "/api/notifications"].includes(req.path)) return { body: [] };
    return { body: null };
  });
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <AccessibilityProvider savePlainLanguage={async () => {}}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Today />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/moving" element={<Redirects />} />
              {/* Like Chat: a link that lands on a page which moves on with `replace`. */}
              <Route path="/routines" element={<Redirects to="/no-heading" />} />
              <Route path="/no-heading" element={<NoHeading />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AccessibilityProvider>
    </QueryClientProvider>,
  );
}

const heading = () => screen.getByRole("heading", { level: 1 });

/** Clicks and lets React finish the navigation, its effects and anything they queued. */
async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  window.scrollTo = () => {};
  claimRouteFocus();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("AppShell: focus after navigation", () => {
  it("puts focus on the new page's heading straight away, not after the fallback", async () => {
    stubWidth(1440);
    draw();
    const rail = screen.getByRole("navigation", { name: "Main" });
    await click(within(rail).getByRole("link", { name: "Tasks" }));
    expect(heading().textContent).toBe("Tasks");
    expect(document.activeElement).toBe(heading());

    // Back to a page that was shown before: still the heading.
    await click(within(rail).getByRole("link", { name: "Today" }));
    expect(document.activeElement).toBe(heading());
    expect(heading().textContent).toBe("Today");
  });

  it("leaves focus alone when the app redirects", async () => {
    stubWidth(1440);
    vi.useFakeTimers();
    draw("/moving");
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    skip.focus();
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(heading().textContent).toBe("Rules");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.activeElement).toBe(skip);
  });

  it("keeps the fallback when a page the person went to redirects on to one with no heading", async () => {
    stubWidth(1440);
    vi.useFakeTimers();
    draw();
    const rail = screen.getByRole("navigation", { name: "Main" });
    await click(within(rail).getByRole("link", { name: "Routines" }));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText("Nothing to focus here.")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("on a phone, a place picked from More gets focus, not the More button", async () => {
    stubWidth(390);
    draw();
    await click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    await click(within(sheet).getByRole("link", { name: "Rules" }));
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
    expect(heading().textContent).toBe("Rules");
    expect(document.activeElement).toBe(heading());
  });

  it("on a phone, closing More without going anywhere gives focus back to More", async () => {
    stubWidth(390);
    draw();
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    await click(more);
    await click(within(screen.getByRole("dialog", { name: "More" })).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(more);
  });
});
