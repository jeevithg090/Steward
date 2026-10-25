// Speech in (plan.md §1.6): the browser's own recogniser (Chrome, Safari). Where it is missing,
// the chat records a clip and says so; nothing here pretends to transcribe.
import { useCallback, useEffect, useRef, useState } from "react";
import { LANGUAGES, type Language } from "@/lib/shield";

// lib.dom does not ship these (Chrome keeps the webkit prefix), so the shape is declared here.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

/** en → en-GB, hi → hi-IN, … (the Settings language). */
export function recognitionLang(language: Language): string {
  return LANGUAGES.find((l) => l.code === language)?.bcp47 ?? "en-GB";
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser settings.",
  "service-not-allowed": "Speech recognition is switched off in this browser.",
  "no-speech": "I didn't hear anything. Try again, or type what you said.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs the internet in this browser.",
  aborted: "",
};

export function useSpeechRecognition({ language, onFinal, onInterim }: { language: Language; onFinal: (text: string) => void; onInterim?: (text: string) => void }) {
  const [supported] = useState(speechRecognitionSupported);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onFinalRef.current = onFinal;
    onInterimRef.current = onInterim;
  });

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Your browser can't turn speech into text.");
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = recognitionLang(language);
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onstart = () => {
      setError(null);
      setInterim("");
      setListening(true);
    };
    rec.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i]!;
        heard += result[0]?.transcript ?? "";
        if (result.isFinal) finalText = heard.trim();
      }
      setInterim(heard.trim());
      onInterimRef.current?.(heard.trim());
    };
    rec.onerror = (e) => {
      const message = ERRORS[e.error] ?? `Speech recognition failed (${e.error}).`;
      if (message) setError(message);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalText || "";
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setError("The microphone could not start. Try again.");
      setListening(false);
    }
  }, [language]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
