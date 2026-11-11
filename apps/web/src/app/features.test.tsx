import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_ID, setDefaultAgentId } from "@/lib/api.ts";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";

// The chat's heavy dependencies refuse to load in this file. Anything the shell imports statically
// that reaches them fails here, as it would put them back on every page's first load.
vi.mock("@copilotkit/react-core/v2", () => {
  throw new Error("CopilotKit was loaded by the app shell; it belongs to the chat chunk.");
});
vi.mock("streamdown", () => {
  throw new Error("Streamdown was loaded by the app shell; it belongs to the chat chunk.");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setDefaultAgentId("steward");
});

describe("the app shell", () => {
  it("loads without CopilotKit or the chat's markdown", async () => {
    const app = await import("./App.tsx");
    const routes = await import("./routes.tsx");
    expect(typeof app.App).toBe("function");
    expect(typeof routes.AppRoutes).toBe("function");
  });

  it("draws nothing until the tenant's agents are known, then makes the first the default", async () => {
    const { DefaultAgent } = await import("./default-agent.tsx");
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    mockFetch(async (req) => {
      if (req.path !== "/api/info") return undefined;
      await answered;
      return { body: { agents: [{ id: "tempo", name: "Tempo" }] } };
    });
    renderWithProviders(
      <DefaultAgent>
        <p>Today</p>
      </DefaultAgent>,
    );
    expect(screen.queryByText("Today")).toBeNull();
    answer();
    expect(await screen.findByText("Today")).toBeTruthy();
    expect(DEFAULT_AGENT_ID).toBe("tempo");
  });

  it("draws with the built-in default when the server cannot be reached", async () => {
    const { DefaultAgent } = await import("./default-agent.tsx");
    mockFetch(() => ({ status: 503, body: { error: "Steward isn't running." } }));
    renderWithProviders(
      <DefaultAgent>
        <p>Today</p>
      </DefaultAgent>,
    );
    expect(await screen.findByText("Today")).toBeTruthy();
    expect(DEFAULT_AGENT_ID).toBe("steward");
  });
});

describe("prefetchChat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the first page go first, then waits for the browser to be idle, and can be cancelled", async () => {
    const { CHAT_PREFETCH_DELAY_MS, prefetchChat } = await import("./features.ts");
    vi.useFakeTimers();
    const requestIdleCallback = vi.fn(() => 7);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const cancel = prefetchChat();
    vi.advanceTimersByTime(CHAT_PREFETCH_DELAY_MS - 1);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestIdleCallback).toHaveBeenCalledOnce();
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("fetches nothing when cancelled before the delay, or when the person's browser saves data", async () => {
    const { CHAT_PREFETCH_DELAY_MS, prefetchChat } = await import("./features.ts");
    vi.useFakeTimers();
    const requestIdleCallback = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    prefetchChat()();
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } });
    prefetchChat();
    vi.advanceTimersByTime(CHAT_PREFETCH_DELAY_MS * 2);
    expect(requestIdleCallback).not.toHaveBeenCalled();
  });
});
