/**
 * Voice input with the browser's Web Speech API.
 *
 * While listening, `interim` holds the words heard so far that may still change; each settled phrase
 * goes to `onFinal` once. Where the browser has no speech recognition, `supported` is false and
 * `error` says so in plain words, so the composer can explain rather than show a dead button.
 *
 * Some browsers (Chrome among them) send the audio to their own speech service to recognise it. The
 * composer says so beside the microphone.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** The parts of `SpeechRecognition` used here. Not every TypeScript DOM library declares it. */
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  readonly error: string;
}
export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => Recognition;

export const NOT_SUPPORTED = "Voice input isn't available in this browser.";

/** The browser's recogniser, prefixed or not, or undefined where there is none. */
export function recognitionConstructor(): RecognitionConstructor | undefined {
  const scope = globalThis as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** A recogniser's error code in words a person can act on. Undefined for a quiet stop. */
export function dictationError(code: string): string | undefined {
  switch (code) {
    case "aborted":
      return undefined;
    case "no-speech":
      return "I didn't hear anything. Try again, a little closer to the microphone.";
    case "not-allowed":
    case "service-not-allowed":
      return "Steward can't use the microphone. Allow it in your browser's site settings, then try again.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected.";
    case "network":
      return "Voice input needs your browser's speech service, and it couldn't be reached.";
    case "language-not-supported":
      return "Voice input doesn't support this language in this browser.";
    default:
      return "Voice input stopped. Try again.";
  }
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  /** Words heard so far that may still change. Empty when not listening. */
  interim: string;
  /** Why it stopped or cannot start, in plain words. */
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export interface DictationOptions {
  /** Called once with each settled phrase. */
  onFinal?: (text: string) => void;
  /** BCP 47 language. Defaults to the page's, then the browser's. */
  lang?: string;
}

export function useDictation(options: DictationOptions = {}): Dictation {
  const Ctor = recognitionConstructor();
  const supported = Ctor !== undefined;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(supported ? null : NOT_SUPPORTED);
  const recognition = useRef<Recognition | null>(null);
  const onFinal = useRef(options.onFinal);
  onFinal.current = options.onFinal;
  const lang = options.lang;

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Recogniser = recognitionConstructor();
    if (!Recogniser) {
      setError(NOT_SUPPORTED);
      return;
    }
    if (recognition.current) return;
    const instance = new Recogniser();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = lang ?? (document.documentElement.lang || navigator.language || "en");
    instance.onstart = () => setListening(true);
    instance.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const words = result?.[0]?.transcript ?? "";
        if (!result || !words) continue;
        if (result.isFinal) {
          const settled = words.trim();
          if (settled) onFinal.current?.(settled);
        } else {
          pending += words;
        }
      }
      setInterim(pending.trim());
    };
    instance.onerror = (event) => {
      const message = dictationError(event.error);
      if (message) setError(message);
    };
    instance.onend = () => {
      if (recognition.current === instance) recognition.current = null;
      setListening(false);
      setInterim("");
    };
    recognition.current = instance;
    setError(null);
    setInterim("");
    try {
      instance.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setError("Voice input couldn't start. Try again.");
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (recognition.current) stop();
    else start();
  }, [start, stop]);

  // Stop listening when the composer goes away; a live microphone must never outlive its page.
  useEffect(
    () => () => {
      const instance = recognition.current;
      recognition.current = null;
      instance?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop, toggle };
}
