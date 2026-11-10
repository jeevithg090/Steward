import type { Settings } from "@steward/shared";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessibilityProvider } from "@/app/accessibility.tsx";
import { mockFetch, renderWithProviders } from "@/lib/testing.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** The server reports the running model with its resolved address, the provider's default included. */
function serve(model: Settings["model"], running = { provider: "scripted", model: "-", scripted: false }) {
  const settings: Settings = {
    model,
    plainLanguage: false,
    briefTime: "08:00",
    timezone: "Europe/London",
    approvalExpiryHours: 24,
  };
  return mockFetch((req) => {
    if (req.path === "/api/settings" && req.method === "GET") return { body: settings };
    if (req.path === "/api/settings" && req.method === "PUT") return { body: settings };
    // The running model as /api/info names it, before the settings arrive.
    if (req.path === "/api/info") return { body: { model: running } };
    if (req.path === "/api/setup") return { body: [] };
    return undefined;
  });
}

/** Draws the page and waits for the settings, which carry the saved address. */
async function draw(model: string) {
  renderWithProviders(<SettingsPage />, {
    wrap: (children) => (
      <AccessibilityProvider savePlainLanguage={async () => {}}>{children}</AccessibilityProvider>
    ),
  });
  await screen.findByText(model);
}

const provider = () => screen.getByRole("combobox", { name: "Provider" }) as HTMLSelectElement;
const modelField = () => screen.getByRole("textbox", { name: /^Model/ }) as HTMLInputElement;
const address = () => screen.queryByRole("textbox", { name: "Server address" }) as HTMLInputElement | null;

async function choose(server: ReturnType<typeof serve>, to: string, model: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Try another model" }));
  fireEvent.change(provider(), { target: { value: to } });
  fireEvent.change(modelField(), { target: { value: model } });
  fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
  await waitFor(() => expect(server.calls.some((c) => c.method === "PUT")).toBe(true));
  return server.calls.find((c) => c.method === "PUT")?.body;
}

describe("Settings: the model", () => {
  it("never sends the old provider's address with a new provider", async () => {
    const server = serve({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-5.5",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    await draw("anthropic/claude-sonnet-5.5");
    expect(await choose(server, "openai", "gpt-5.6-terra")).toEqual({
      model: { provider: "openai", model: "gpt-5.6-terra" },
    });
  });

  it("starts a newly chosen local server with an empty address", async () => {
    const server = serve({ provider: "ollama", model: "llama4", baseUrl: "http://127.0.0.1:11434/v1" });
    await draw("llama4");
    fireEvent.click(await screen.findByRole("button", { name: "Try another model" }));
    expect(address()?.value).toBe("http://127.0.0.1:11434/v1");
    fireEvent.change(provider(), { target: { value: "openai-compatible" } });
    expect(address()?.value).toBe("");
    fireEvent.change(address()!, { target: { value: "http://10.0.0.5:8000/v1" } });
    fireEvent.change(modelField(), { target: { value: "qwen3" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "PUT")).toBe(true));
    expect(server.calls.find((c) => c.method === "PUT")?.body).toEqual({
      model: { provider: "openai-compatible", model: "qwen3", baseUrl: "http://10.0.0.5:8000/v1" },
    });
  });

  it("keeps a local server's own address when only the model changes", async () => {
    const server = serve({ provider: "ollama", model: "llama4", baseUrl: "http://127.0.0.1:11434/v1" });
    await draw("llama4");
    expect(await choose(server, "ollama", "llama4:70b")).toEqual({
      model: { provider: "ollama", model: "llama4:70b", baseUrl: "http://127.0.0.1:11434/v1" },
    });
  });

  it("drops a local server's address when moving to a provider with its own endpoint", async () => {
    const server = serve({ provider: "ollama", model: "llama4", baseUrl: "http://127.0.0.1:11434/v1" });
    await draw("llama4");
    expect(await choose(server, "anthropic", "claude-sonnet-5.5")).toEqual({
      model: { provider: "anthropic", model: "claude-sonnet-5.5" },
    });
  });
});

describe("Settings: saved and running", () => {
  const SCRIPTED = { provider: "scripted", model: "steward-scripted", scripted: true };

  it("says when the chosen provider has no key and Steward is still on the scripted model", async () => {
    serve({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5" }, SCRIPTED);
    await draw("anthropic/claude-sonnet-5.5");
    expect(await screen.findByText("Steward is still using the scripted demo model")).toBeTruthy();
    expect(screen.getByText(/there's no OPENROUTER_API_KEY in \.env/)).toBeTruthy();
    expect(screen.getByText("Not in use")).toBeTruthy();
    // The page never says .env wins: a choice saved here does.
    expect(screen.queryByText(/for good/)).toBeNull();
    expect(screen.getByText(/used instead of the one in/)).toBeTruthy();
  });

  it("says nothing of a fallback when the scripted model is the one chosen", async () => {
    serve({ provider: "scripted", model: "steward-scripted" }, SCRIPTED);
    await draw("steward-scripted");
    expect(screen.queryByText("Steward is still using the scripted demo model")).toBeNull();
    expect(screen.getByText("Scripted")).toBeTruthy();
  });

  it("starts each provider with its own model name and says which key it reads", async () => {
    serve({ provider: "scripted", model: "steward-scripted" }, SCRIPTED);
    await draw("steward-scripted");
    fireEvent.click(await screen.findByRole("button", { name: "Try another model" }));
    fireEvent.change(provider(), { target: { value: "openrouter" } });
    expect(modelField().value).toBe("anthropic/claude-sonnet-5.5");
    expect(screen.getByText("Reads OPENROUTER_API_KEY from .env.")).toBeTruthy();
    fireEvent.change(provider(), { target: { value: "scripted" } });
    expect(modelField().value).toBe("steward-scripted");
  });
});

describe("Settings: brief time", () => {
  it("asks for a time instead of sending an empty one", async () => {
    const server = serve({ provider: "scripted", model: "steward-scripted" });
    await draw("steward-scripted");
    const time = screen.getByLabelText(/Brief time/) as HTMLInputElement;
    fireEvent.change(time, { target: { value: "" } });
    fireEvent.submit(time.closest("form")!);
    expect(await screen.findByText("Choose a time, like 08:00.")).toBeTruthy();
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
