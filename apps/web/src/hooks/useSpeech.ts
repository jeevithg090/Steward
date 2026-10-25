// Speech out (plan.md §1.5, §9): the Gateway's own voice first (POST /voice/tts, the server's
// ElevenLabs key), then a key pasted in Settings, then the browser's speechSynthesis. The face
// moves in every case: the viseme timeline is built from the text and the clip's length.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Persona } from "@/lib/api";

// ElevenLabs voice ids for the pasted-key path. Tempo (the agent itself) speaks with the negotiator's voice.
// ElevenLabs premade voices (the same as the Gateway's tempo_gateway/tts.py): they work on every
// plan, where the older library voices are refused on a free plan with 402.
const DEFAULT_VOICE_MAP: Record<string, string> = {
  tempo: "EXAVITQu4vr4xnSDxMaL", // Sarah
  negotiator: "IKne3meq5aSn9XLyUdCD", // Charlie
  analyst: "Xb7hH8MSUJpSbSDYk0k2", // Alice
  auditor: "XrExE9yKIg1WjnnlVkGX", // Matilda
  contractor: "bIHbv24MWmeRgasZH58o", // Will
};

const MAX_SPOKEN_CHARS = 450;

export type VisemeShape = "A" | "B" | "C" | "D" | "E" | "F";

interface VisemeFrame {
  timeMs: number;
  shape: VisemeShape;
}

export function generateVisemeTimeline(text: string, durationMs: number): VisemeFrame[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [{ timeMs: 0, shape: "A" }];

  const frames: VisemeFrame[] = [{ timeMs: 0, shape: "A" }];
  const totalChars = words.reduce((acc, w) => acc + w.length, 0);
  let currentTime = 0;

  for (const word of words) {
    const wordDuration = (word.length / totalChars) * durationMs;
    const charTime = wordDuration / word.length;

    for (const char of word) {
      let shape: VisemeShape = "B";
      if ("aaeEiI".includes(char)) shape = "C";
      else if ("oOuUwW".includes(char)) shape = "E";
      else if ("mMBbP".includes(char)) shape = "A";
      else if ("fFvV".includes(char)) shape = "F";
      else if ("ySszZtTdDnN".includes(char)) shape = "D";
      frames.push({ timeMs: Math.round(currentTime), shape });
      currentTime += charTime;
    }
    frames.push({ timeMs: Math.round(currentTime), shape: "A" });
  }

  frames.push({ timeMs: durationMs, shape: "A" });
  return frames;
}

export function prepareSpeechText(raw: string): string {
  const text = raw.replace(/→/g, "to").replace(/\s+/g, " ").trim();
  if (text.length <= MAX_SPOKEN_CHARS) return text;
  const cut = text.slice(0, MAX_SPOKEN_CHARS);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return lastStop > 120 ? cut.slice(0, lastStop + 1) : cut;
}

export type SpeechSource = "gateway" | "elevenlabs" | "browser" | null;

export interface UseSpeechOptions {
  /** A key pasted in Settings (the desktop path); used when the Gateway has no voice. */
  elevenLabsKey?: string;
  /** The Gateway's voice: `gateway.tts(text, persona)`; tried first when `ttsAvailable`. */
  tts?: (text: string, persona: Persona) => Promise<ArrayBuffer>;
  ttsAvailable?: boolean;
  /** BCP 47 tag for the browser's voice (en-GB, hi-IN, …). */
  lang?: string;
}

export function useSpeech({ elevenLabsKey, tts, ttsAvailable = false, lang = "en-GB" }: UseSpeechOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentViseme, setCurrentViseme] = useState<VisemeShape>("A");
  const [source, setSource] = useState<SpeechSource>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const rafRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, ArrayBuffer>());
  const levelRef = useRef<HTMLDivElement | null>(null);
  const visemeRef = useRef<VisemeShape>("A");
  const volumeRef = useRef<number>(1);

  const activeTimelineRef = useRef<VisemeFrame[]>([]);
  const startTimeMsRef = useRef<number>(0);
  const isSpeakingRef = useRef<boolean>(false);

  const setViseme = (shape: VisemeShape) => {
    visemeRef.current = shape;
    setCurrentViseme(shape);
    levelRef.current?.setAttribute("data-viseme", shape);
  };

  const stopLevelLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (levelRef.current) {
      levelRef.current.style.setProperty("--level", "0");
      levelRef.current.setAttribute("data-viseme", "A");
    }
    visemeRef.current = "A";
    setCurrentViseme("A");
    isSpeakingRef.current = false;
  }, []);

  const startAnimationLoop = useCallback((timeline: VisemeFrame[], startTimeMs: number) => {
    cancelAnimationFrame(rafRef.current);
    activeTimelineRef.current = timeline;
    startTimeMsRef.current = startTimeMs;
    isSpeakingRef.current = true;

    const analyser = analyserRef.current;
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const tick = () => {
      if (!isSpeakingRef.current) return;
      const elapsed = performance.now() - startTimeMsRef.current;

      if (analyser && data) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i]!;
        const level = Math.min(1, sum / data.length / 90);
        levelRef.current?.style.setProperty("--level", level.toFixed(3));
      } else {
        // No analyser (browser voice): a soft pulse from the viseme so the glow still breathes.
        levelRef.current?.style.setProperty("--level", visemeRef.current === "A" ? "0.1" : "0.5");
      }

      let currentShape: VisemeShape = "A";
      const currentTimeline = activeTimelineRef.current;
      for (let i = currentTimeline.length - 1; i >= 0; i--) {
        if (elapsed >= currentTimeline[i]!.timeMs) {
          currentShape = currentTimeline[i]!.shape;
          break;
        }
      }
      setViseme(currentShape);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // Resume the animation when the tab comes back.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && isSpeakingRef.current) {
        if (ctxRef.current && ctxRef.current.state === "suspended") void ctxRef.current.resume();
        startAnimationLoop(activeTimelineRef.current, startTimeMsRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [startAnimationLoop]);

  const getAudioContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const masterGain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      masterGain.gain.setValueAtTime(volumeRef.current, ctx.currentTime);
      masterGain.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      masterGainRef.current = masterGain;
    }
    return ctxRef.current;
  }, []);

  const stopPlayback = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        /* already stopped */
      }
      activeSourceRef.current = null;
    }
    stopLevelLoop();
    setIsSpeaking(false);
    setIsLoading(false);
  }, [stopLevelLoop]);

  const stop = useCallback(() => {
    requestIdRef.current++;
    stopPlayback();
  }, [stopPlayback]);

  const setPlaybackVolume = useCallback((volume: number) => {
    const normalized = Math.min(1, Math.max(0, volume / 100));
    volumeRef.current = normalized;
    if (masterGainRef.current && ctxRef.current) {
      const t = ctxRef.current.currentTime;
      masterGainRef.current.gain.cancelScheduledValues(t);
      masterGainRef.current.gain.setTargetAtTime(normalized, t, 0.01);
    }
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (synth && synth.speaking) {
      if (normalized === 0) synth.pause();
      else if (synth.paused) synth.resume();
    }
  }, []);

  /** The browser's own voice: no key, no network. The face follows an estimated timeline. */
  const speakBrowser = useCallback(
    (text: string, myId: number) => {
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        setError("This browser has no voice. The reply is in the text.");
        setIsLoading(false);
        setIsSpeaking(false);
        setSource(null);
        return;
      }
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = volumeRef.current;
      utterance.rate = 0.95;
      utterance.lang = lang;
      const voice = synth.getVoices?.().find((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
      if (voice) utterance.voice = voice;

      const estimatedDurationMs = (text.length / 14) * 1000;
      const timeline = generateVisemeTimeline(text, estimatedDurationMs);

      utterance.onstart = () => {
        if (myId !== requestIdRef.current) return;
        setIsLoading(false);
        setIsSpeaking(true);
        setSource("browser");
        startAnimationLoop(timeline, performance.now());
      };
      const finish = () => {
        if (myId !== requestIdRef.current) return;
        setIsSpeaking(false);
        setIsLoading(false);
        stopLevelLoop();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      setSource("browser");
      synth.speak(utterance);
    },
    [lang, startAnimationLoop, stopLevelLoop],
  );

  /** Plays an mp3 the Gateway or ElevenLabs returned, with the face in step. */
  const playBuffer = useCallback(
    async (arrayBuffer: ArrayBuffer, text: string, myId: number, from: SpeechSource) => {
      const ctx = getAudioContext();
      if (!ctx) throw new Error("AudioContext not supported");
      if (ctx.state === "suspended") await ctx.resume();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (myId !== requestIdRef.current) return;

      const node = ctx.createBufferSource();
      node.buffer = audioBuffer;
      if (masterGainRef.current) {
        masterGainRef.current.gain.setValueAtTime(volumeRef.current, ctx.currentTime);
        node.connect(masterGainRef.current);
      }
      const timeline = generateVisemeTimeline(text, audioBuffer.duration * 1000);
      node.onended = () => {
        if (myId === requestIdRef.current) {
          setIsSpeaking(false);
          stopLevelLoop();
        }
      };
      activeSourceRef.current = node;
      const startTimeMs = performance.now();
      node.start(0);
      setIsLoading(false);
      setIsSpeaking(true);
      setSource(from);
      startAnimationLoop(timeline, startTimeMs);
    },
    [getAudioContext, startAnimationLoop, stopLevelLoop],
  );

  const fetchElevenLabs = useCallback(
    async (text: string, persona: string, signal: AbortSignal): Promise<ArrayBuffer | null> => {
      const key = elevenLabsKey?.trim();
      if (!key) return null;
      const voiceId = DEFAULT_VOICE_MAP[persona] || DEFAULT_VOICE_MAP.negotiator!;
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", "xi-api-key": key, Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!res.ok) return null;
      return res.arrayBuffer();
    },
    [elevenLabsKey],
  );

  const speak = useCallback(
    async (rawText: string, persona: string, volume: number) => {
      const text = prepareSpeechText(rawText);
      if (!text) return;

      const myId = ++requestIdRef.current;
      stopPlayback();
      setError(null);
      setPlaybackVolume(volume);

      const canDecode = typeof window !== "undefined" && Boolean(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
      const tryGateway = Boolean(tts && ttsAvailable && canDecode);
      const tryKey = Boolean(elevenLabsKey?.trim() && canDecode);

      if (!tryGateway && !tryKey) {
        speakBrowser(text, myId);
        return;
      }

      setIsLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        let buffer: ArrayBuffer | undefined;
        let from: SpeechSource = null;
        if (tryGateway) {
          const key = `gateway|${persona}|${text}`;
          buffer = cacheRef.current.get(key);
          if (!buffer) {
            try {
              buffer = await tts!(text, persona as Persona);
              cacheRef.current.set(key, buffer);
            } catch {
              buffer = undefined;
            }
          }
          if (buffer) from = "gateway";
        }
        if (!buffer && tryKey) {
          const key = `elevenlabs|${persona}|${text}`;
          buffer = cacheRef.current.get(key);
          if (!buffer) {
            const fetched = await fetchElevenLabs(text, persona, controller.signal);
            if (fetched) {
              buffer = fetched;
              cacheRef.current.set(key, buffer);
            }
          }
          if (buffer) from = "elevenlabs";
        }
        if (myId !== requestIdRef.current) return;
        if (!buffer) {
          speakBrowser(text, myId);
          return;
        }
        await playBuffer(buffer, text, myId, from);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (myId === requestIdRef.current) speakBrowser(text, myId);
      }
    },
    [elevenLabsKey, fetchElevenLabs, playBuffer, setPlaybackVolume, speakBrowser, stopPlayback, tts, ttsAvailable],
  );

  useEffect(() => {
    return () => {
      requestIdRef.current++;
      abortRef.current?.abort();
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      cancelAnimationFrame(rafRef.current);
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
        } catch {
          /* already stopped */
        }
      }
      cacheRef.current.clear();
      void ctxRef.current?.close();
    };
  }, []);

  return { speak, stop, setPlaybackVolume, isLoading, isSpeaking, error, source, levelRef, visemeRef, currentViseme };
}
