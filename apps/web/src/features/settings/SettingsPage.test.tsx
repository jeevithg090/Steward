import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps } from "react";
import { Toaster, toast } from "@/components/ui";
import { setPrefs } from "@/lib/a11y-prefs";
import type { Health } from "@/lib/api";
import { expectNoA11yViolations } from "@/test/a11y";
import { SettingsPage } from "./SettingsPage";

const HEALTH: Health = { status: "ok", mode: "replay", demo: true, simulated: ["company", "rail data", "jurors", "vision"], deploy: "cloud-standard", region: "eu", third_parties: ["cortex", "elevenlabs", "gemini"] };

function props(over: Partial<ComponentProps<typeof SettingsPage>> = {}): ComponentProps<typeof SettingsPage> {
  return {
    gatewayUrl: "http://127.0.0.1:8000",
    token: "devtoken",
    showcase: false,
    showcaseForced: false,
    onSaveGateway: vi.fn(),
    onToggleShowcase: vi.fn(),
    health: HEALTH,
    ttsConfigured: false,
    language: "en",
    onLanguage: vi.fn(),
    activeModels: ["local"],
    onToggleActiveModel: vi.fn(),
    apiKeys: { claude: "", openai: "", elevenlabs: "" },
    onUpdateApiKey: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  toast.clear();
  setPrefs({ textSize: "default", plain: false });
  localStorage.clear();
});

test("settings has one heading, says what is real, and confirms a Gateway save with a toast", async () => {
  const onSaveGateway = vi.fn();
  const { container } = render(<main><SettingsPage {...props({ onSaveGateway })} /><Toaster /></main>);

  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  expect(screen.getByText("replay · cloud-standard")).toBeInTheDocument();
  expect(screen.getByText(/no model ever sets an amount/)).toBeInTheDocument();
  await expectNoA11yViolations(container);

  const url = screen.getByLabelText("URL");
  await userEvent.clear(url);
  await userEvent.type(url, "127.0.0.1:9000");
  await userEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
  expect(onSaveGateway).not.toHaveBeenCalled();
  expect(await screen.findByText(/should start with http:\/\/ or https:\/\//)).toBeInTheDocument();

  await userEvent.clear(url);
  await userEvent.type(url, "http://127.0.0.1:9000");
  await userEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
  expect(onSaveGateway).toHaveBeenCalledWith("http://127.0.0.1:9000", "devtoken");
  expect(await screen.findByText(/Gateway saved and reconnected: http:\/\/127\.0\.0\.1:9000/)).toBeInTheDocument();
});

test("the showcase switch says what changed, both ways", async () => {
  const onToggleShowcase = vi.fn();
  const { rerender } = render(<main><SettingsPage {...props({ onToggleShowcase })} /><Toaster /></main>);

  await userEvent.click(screen.getByRole("switch", { name: "Showcase mode" }));
  expect(onToggleShowcase).toHaveBeenCalledWith(true);
  expect(await screen.findByText(/Showcase on: every page now answers from recorded replies/)).toBeInTheDocument();

  rerender(<main><SettingsPage {...props({ onToggleShowcase, showcase: true })} /><Toaster /></main>);
  expect(screen.getByLabelText("URL")).toBeDisabled();
  await userEvent.click(screen.getByRole("switch", { name: "Showcase mode" }));
  expect(onToggleShowcase).toHaveBeenLastCalledWith(false);
  expect(await screen.findByText("Showcase off: Tempo talks to the Gateway at http://127.0.0.1:8000.")).toBeInTheDocument();
});

test("text size is one radio group the arrow keys move through; a key is saved from a dialog that Escape closes", async () => {
  const onUpdateApiKey = vi.fn();
  render(<main><SettingsPage {...props({ onUpdateApiKey })} /><Toaster /></main>);

  const sizes = screen.getByRole("radiogroup", { name: "Text size" });
  const normal = within(sizes).getByRole("radio", { name: "Normal text" });
  expect(normal).toHaveAttribute("aria-checked", "true");
  normal.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(within(sizes).getByRole("radio", { name: "Large text" })).toHaveAttribute("aria-checked", "true");
  expect(within(sizes).getByRole("radio", { name: "Large text" })).toHaveFocus();
  expect(document.documentElement).toHaveAttribute("data-text-size", "large");

  await userEvent.click(screen.getByRole("button", { name: "Add an ElevenLabs key" }));
  expect(screen.getByRole("dialog", { name: "Set the ElevenLabs key" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add an ElevenLabs key" })).toHaveFocus();

  await userEvent.click(screen.getByRole("button", { name: "Add an ElevenLabs key" }));
  await userEvent.type(screen.getByLabelText("ElevenLabs key"), "sk-test{Enter}");
  expect(onUpdateApiKey).toHaveBeenCalledWith("elevenlabs", "sk-test");
  expect(await screen.findByText("ElevenLabs key saved on this device only.")).toBeInTheDocument();
});
