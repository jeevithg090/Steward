import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCESSIBILITY_STORAGE_KEY, AccessibilityProvider } from "@/app/accessibility.tsx";
import { VOICE_SAMPLE, VoiceControls } from "./VoiceControls.tsx";

type Scope = Record<string, unknown>;
const scope = globalThis as unknown as Scope;

class FakeUtterance {
  voice: unknown = null;
  lang = "";
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

/** A speech engine whose voices arrive late, as Chrome's do. */
function fakeSynth() {
  const listeners = new Set<() => void>();
  let voices: { voiceURI: string; name: string; lang: string }[] = [];
  const spoken: FakeUtterance[] = [];
  const synth = {
    spoken,
    getVoices: () => voices,
    speak: (u: FakeUtterance) => {
      spoken.push(u);
      u.onstart?.();
    },
    cancel: () => {},
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    load(next: typeof voices) {
      voices = next;
      for (const fn of listeners) fn();
    },
  };
  return synth;
}

function renderControls() {
  return render(
    <AccessibilityProvider savePlainLanguage={async () => {}}>
      <VoiceControls />
    </AccessibilityProvider>,
  );
}

let synth: ReturnType<typeof fakeSynth>;

beforeEach(() => {
  synth = fakeSynth();
  scope.speechSynthesis = synth;
  scope.SpeechSynthesisUtterance = FakeUtterance;
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
  delete scope.speechSynthesis;
  delete scope.SpeechSynthesisUtterance;
  localStorage.clear();
});

describe("VoiceControls", () => {
  it("lists the voices once the browser has them, this page's language first", () => {
    renderControls();
    const select = screen.getByLabelText("Voice") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["This device's usual voice"]);
    act(() =>
      synth.load([
        { voiceURI: "amelie", name: "Amélie", lang: "fr-CA" },
        { voiceURI: "kate", name: "Kate", lang: "en-GB" },
      ]),
    );
    const groups = [...select.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["In this page's language", "Other languages"]);
    expect([...select.options].map((o) => o.text)).toEqual([
      "This device's usual voice",
      "Kate (en-GB)",
      "Amélie (fr-CA)",
    ]);
  });

  it("keeps the chosen voice and speed in this browser, and the sample uses them", () => {
    synth.load([{ voiceURI: "kate", name: "Kate", lang: "en-GB" }]);
    renderControls();
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "kate" } });
    fireEvent.click(screen.getByRole("radio", { name: "Slower" }));
    expect(JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? "{}")).toMatchObject({
      speechVoice: "kate",
      speechRate: 0.8,
    });

    fireEvent.click(screen.getByRole("button", { name: "Hear a sample" }));
    const [said] = synth.spoken;
    expect(said?.text).toBe(VOICE_SAMPLE);
    expect(said?.voice).toMatchObject({ voiceURI: "kate" });
    expect(said?.rate).toBe(0.8);
    expect(screen.getByRole("button", { name: "Stop the sample" })).toBeTruthy();
  });

  it("comes back with the stored choice, and ignores a speed it doesn't offer", () => {
    localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify({ speechVoice: "gone", speechRate: 9 }));
    renderControls();
    const loading = screen.getByLabelText("Voice") as HTMLSelectElement;
    expect(loading.selectedOptions[0]?.text).toBe("The voice you chose");
    act(() => synth.load([{ voiceURI: "kate", name: "Kate", lang: "en-GB" }]));
    const select = screen.getByLabelText("Voice") as HTMLSelectElement;
    expect(select.value).toBe("gone");
    expect(select.selectedOptions[0]?.text).toBe("A voice this browser doesn't have");
    expect((screen.getByRole("radio", { name: "Normal" }) as HTMLInputElement).checked).toBe(true);
  });

  it("says so when the browser can't speak", () => {
    delete scope.speechSynthesis;
    delete scope.SpeechSynthesisUtterance;
    renderControls();
    expect(screen.getByText("This browser can't read aloud, so there is no voice to choose.")).toBeTruthy();
    expect(screen.queryByLabelText("Voice")).toBeNull();
  });
});
