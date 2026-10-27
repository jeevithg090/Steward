/**
 * Read aloud with the browser's own speech synthesis. Nothing leaves the device for this.
 *
 * Starting new speech stops what was playing, so replies never talk over each other. Long text is
 * queued sentence by sentence (see `speechChunks`), and `stop()` silences everything at once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccessibility } from "@/app/accessibility.tsx";
import { speechChunks, speechText } from "./speech-text.ts";

export interface SpeakOptions {
  /** A `SpeechSynthesisVoice.voiceURI` or voice name. Defaults to the person's choice, then the browser's. */
  voice?: string;
  /** 0.5 to 2. Defaults to the person's choice, then 1. */
  rate?: number;
  /** BCP 47 language, when no voice is chosen. Defaults to the page's language. */
  lang?: string;
}

export interface Speaker {
  /** False when this browser cannot speak. */
  supported: boolean;
  speaking: boolean;
  /** Speaks markdown or plain text, stopping anything already playing. */
  speak: (text: string, options?: SpeakOptions) => void;
  stop: () => void;
}

/**
 * The person's voice and rate, when the accessibility settings carry them. Read defensively, since
 * the settings may not have these fields yet.
 */
export function speechPreferences(settings: object): { voice?: string; rate?: number } {
  const record = settings as Record<string, unknown>;
  const voice = [record.speechVoice, record.voiceURI, record.voice].find(
    (value): value is string => typeof value === "string" && value !== "",
  );
  const rate = [record.speechRate, record.rate].find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return { ...(voice ? { voice } : {}), ...(rate !== undefined ? { rate } : {}) };
}

function synth(): SpeechSynthesis | undefined {
  return typeof globalThis.speechSynthesis === "object" &&
    typeof globalThis.SpeechSynthesisUtterance === "function"
    ? globalThis.speechSynthesis
    : undefined;
}

function pickVoice(engine: SpeechSynthesis, wanted: string | undefined): SpeechSynthesisVoice | undefined {
  if (!wanted) return undefined;
  const voices = engine.getVoices();
  return voices.find((voice) => voice.voiceURI === wanted) ?? voices.find((voice) => voice.name === wanted);
}

export function useSpeak(defaults: SpeakOptions = {}): Speaker {
  const preferences = speechPreferences(useAccessibility());
  const [speaking, setSpeaking] = useState(false);
  /** Bumped on every speak and stop, so callbacks from cancelled speech are ignored. */
  const generation = useRef(0);
  const supported = synth() !== undefined;
  const settings = useRef({ ...preferences, ...defaults });
  settings.current = { ...preferences, ...defaults };

  const stop = useCallback(() => {
    generation.current++;
    synth()?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((input: string, options: SpeakOptions = {}) => {
    const engine = synth();
    if (!engine) return;
    const text = speechText(input);
    generation.current++;
    const mine = generation.current;
    engine.cancel();
    if (!text) {
      setSpeaking(false);
      return;
    }
    const chosen = { ...settings.current, ...options };
    const voice = pickVoice(engine, chosen.voice);
    const rate = Math.min(2, Math.max(0.5, chosen.rate ?? 1));
    const chunks = speechChunks(text);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? chosen.lang ?? (document.documentElement.lang || "en");
      utterance.rate = rate;
      if (index === 0) {
        utterance.onstart = () => {
          if (generation.current === mine) setSpeaking(true);
        };
      }
      if (index === chunks.length - 1) {
        const finish = () => {
          if (generation.current === mine) setSpeaking(false);
        };
        utterance.onend = finish;
        utterance.onerror = finish;
      }
      engine.speak(utterance);
    });
    setSpeaking(true);
  }, []);

  // Leaving the page that spoke stops the speech.
  useEffect(
    () => () => {
      generation.current++;
      synth()?.cancel();
    },
    [],
  );

  return { supported, speaking, speak, stop };
}
