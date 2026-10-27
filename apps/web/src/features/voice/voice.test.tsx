import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityProvider } from "@/app/accessibility.tsx";
import { speechChunks, speechText } from "./speech-text.ts";
import { dictationError, NOT_SUPPORTED, type Recognition, useDictation } from "./useDictation.ts";
import { speechPreferences, useSpeak } from "./useSpeak.ts";

type Scope = Record<string, unknown>;
const scope = globalThis as unknown as Scope;

class FakeRecognition implements Recognition {
  static last: FakeRecognition | undefined;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  onstart: Recognition["onstart"] = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  /** Delivers results: each is [words, isFinal]. */
  hear(results: [string, boolean][]) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex: 0, results: list });
  }
}

afterEach(() => {
  cleanup();
  delete scope.SpeechRecognition;
  delete scope.webkitSpeechRecognition;
  FakeRecognition.last = undefined;
});

describe("useDictation", () => {
  it("says plainly when the browser cannot listen", () => {
    const { result } = renderHook(() => useDictation());
    expect(result.current.supported).toBe(false);
    expect(result.current.error).toBe(NOT_SUPPORTED);
    act(() => result.current.start());
    expect(result.current.listening).toBe(false);
  });

  it("shows words as they are heard and hands each settled phrase on once", () => {
    scope.webkitSpeechRecognition = FakeRecognition;
    const onFinal = vi.fn();
    const { result } = renderHook(() => useDictation({ onFinal, lang: "en-GB" }));
    expect(result.current.supported).toBe(true);

    act(() => result.current.start());
    const recogniser = FakeRecognition.last!;
    expect(recogniser.started).toBe(true);
    expect(recogniser.continuous).toBe(true);
    expect(recogniser.interimResults).toBe(true);
    expect(recogniser.lang).toBe("en-GB");
    expect(result.current.listening).toBe(true);

    act(() => recogniser.hear([["what needs", false]]));
    expect(result.current.interim).toBe("what needs");
    act(() => recogniser.hear([[" what needs me today ", true]]));
    expect(onFinal).toHaveBeenCalledWith("what needs me today");
    expect(result.current.interim).toBe("");

    act(() => result.current.toggle());
    expect(result.current.listening).toBe(false);
  });

  it("turns recogniser errors into sentences, and ignores a quiet abort", () => {
    scope.SpeechRecognition = FakeRecognition;
    const { result } = renderHook(() => useDictation());
    act(() => result.current.start());
    act(() => FakeRecognition.last!.onerror?.({ error: "not-allowed" }));
    expect(result.current.error).toContain("can't use the microphone");
    expect(dictationError("aborted")).toBeUndefined();
    expect(dictationError("no-speech")).toContain("didn't hear anything");
  });

  it("stops the microphone when the composer goes away", () => {
    scope.SpeechRecognition = FakeRecognition;
    const { result, unmount } = renderHook(() => useDictation());
    act(() => result.current.start());
    const abort = vi.spyOn(FakeRecognition.last!, "abort");
    unmount();
    expect(abort).toHaveBeenCalled();
  });
});

describe("useSpeak", () => {
  class FakeUtterance {
    voice: unknown = null;
    lang = "";
    rate = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  let spoken: FakeUtterance[];
  let synth: {
    speak: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: () => unknown[];
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AccessibilityProvider savePlainLanguage={async () => {}}>{children}</AccessibilityProvider>
  );

  beforeEach(() => {
    spoken = [];
    synth = {
      speak: vi.fn((utterance: FakeUtterance) => spoken.push(utterance)),
      cancel: vi.fn(),
      getVoices: () => [{ voiceURI: "kate", name: "Kate", lang: "en-GB" }],
    };
    scope.speechSynthesis = synth;
    scope.SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete scope.speechSynthesis;
    delete scope.SpeechSynthesisUtterance;
  });

  it("reads markdown as words, stopping whatever was playing first", () => {
    const { result } = renderHook(() => useSpeak(), { wrapper });
    expect(result.current.supported).toBe(true);
    act(() => result.current.speak("**Done.** I saved [the report](https://example.com/r)."));
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken.map((u) => u.text)).toEqual(["Done. I saved the report."]);
    expect(result.current.speaking).toBe(true);

    act(() => spoken[0]!.onend?.());
    expect(result.current.speaking).toBe(false);
  });

  it("uses the chosen voice and rate, kept within sensible bounds", () => {
    const { result } = renderHook(() => useSpeak({ voice: "kate", rate: 5 }), { wrapper });
    act(() => result.current.speak("Hello."));
    expect(spoken[0]?.voice).toEqual({ voiceURI: "kate", name: "Kate", lang: "en-GB" });
    expect(spoken[0]?.lang).toBe("en-GB");
    expect(spoken[0]?.rate).toBe(2);
  });

  it("ignores the end of speech that was stopped", () => {
    const { result } = renderHook(() => useSpeak(), { wrapper });
    act(() => result.current.speak("First."));
    const first = spoken[0]!;
    act(() => result.current.speak("Second."));
    act(() => first.onend?.());
    expect(result.current.speaking).toBe(true);
    act(() => result.current.stop());
    expect(result.current.speaking).toBe(false);
  });

  it("reads speech preferences only when the settings carry them", () => {
    expect(speechPreferences({ readAloud: true })).toEqual({});
    expect(speechPreferences({ speechVoice: "kate", speechRate: 1.2 })).toEqual({ voice: "kate", rate: 1.2 });
  });
});

describe("speechText", () => {
  it("says links by their words, sites by their names, and mentions code", () => {
    expect(speechText("# Today\n\n- **Mail**: 2 need you\n- See https://www.example.com/x")).toBe(
      "Today. Mail: 2 need you. See example.com",
    );
    expect(speechText("Run this:\n\n```sh\nls -la\n```")).toContain("There's some code on screen.");
    expect(speechText("![A chart of sales](x.png)")).toBe("A chart of sales");
  });

  it("splits long text into sentences short enough to speak", () => {
    const text = "One sentence here. Another one follows. A third.";
    expect(speechChunks(text, 30)).toEqual(["One sentence here.", "Another one follows. A third."]);
    expect(speechChunks("x".repeat(50), 20)).toEqual(["x".repeat(20), "x".repeat(20), "x".repeat(10)]);
  });
});
