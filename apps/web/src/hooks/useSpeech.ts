import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_VOICE_MAP: Record<string, string> = {
  negotiator: "21m00Tcm4TlvDq8ikWAM", // Rachel
  analyst: "AZnzlk1XvdvUeBnXmlld",    // Domi
  auditor: "EXAVITQu4vr4xnSDxMaL",    // Bella
  contractor: "ErXwobaYiN019PkySvjV", // Antoni
};

const MAX_SPOKEN_CHARS = 450;

export type VisemeShape = "A" | "B" | "C" | "D" | "E" | "F";

interface VisemeFrame {
  timeMs: number;
  shape: VisemeShape;
}

export function generateVisemeTimeline(text: string, durationMs: number): VisemeFrame[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
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
      else shape = "B";

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

interface UseSpeechOptions {
  apiBaseUrl?: string;
  apiToken?: string;
  elevenLabsKey?: string;
}

export function useSpeech({ elevenLabsKey }: UseSpeechOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentViseme, setCurrentViseme] = useState<VisemeShape>("A");

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

  // Tracking state to recover animation after tab blur/focus
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

  const startAnimationLoop = useCallback(
    (timeline: VisemeFrame[], startTimeMs: number) => {
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
          for (let i = 0; i < data.length; i++) sum += data[i];
          const level = Math.min(1, sum / data.length / 90);
          levelRef.current?.style.setProperty("--level", level.toFixed(3));
        }

        let currentShape: VisemeShape = "A";
        const currentTimeline = activeTimelineRef.current;

        for (let i = currentTimeline.length - 1; i >= 0; i--) {
          if (elapsed >= currentTimeline[i].timeMs) {
            currentShape = currentTimeline[i].shape;
            break;
          }
        }

        setViseme(currentShape);
        rafRef.current = requestAnimationFrame(tick);
      };

      tick();
    },
    []
  );

  // Resume animation instantly when returning to tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isSpeakingRef.current) {
        if (ctxRef.current && ctxRef.current.state === "suspended") {
          void ctxRef.current.resume();
        }
        startAnimationLoop(activeTimelineRef.current, startTimeMsRef.current);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [startAnimationLoop]);

  const getAudioContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        /* ignore */
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
      const currentTime = ctxRef.current.currentTime;
      masterGainRef.current.gain.cancelScheduledValues(currentTime);
      masterGainRef.current.gain.setTargetAtTime(normalized, currentTime, 0.01);
    }

    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      if (normalized === 0) {
        window.speechSynthesis.pause();
      } else if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }
  }, []);

  const speakNativeFallback = useCallback(
    (text: string, myId: number) => {
      if (!window.speechSynthesis) {
        setError("Speech synthesis not supported in this browser.");
        setIsLoading(false);
        setIsSpeaking(false);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = volumeRef.current;
      utterance.rate = 1.0;

      const estimatedDurationMs = (text.length / 15) * 1000;
      const timeline = generateVisemeTimeline(text, estimatedDurationMs);

      utterance.onstart = () => {
        if (myId !== requestIdRef.current) return;
        setIsLoading(false);
        setIsSpeaking(true);
        startAnimationLoop(timeline, performance.now());
      };

      utterance.onend = () => {
        if (myId === requestIdRef.current) {
          setIsSpeaking(false);
          stopLevelLoop();
        }
      };

      utterance.onerror = () => {
        if (myId === requestIdRef.current) {
          setIsSpeaking(false);
          setIsLoading(false);
          stopLevelLoop();
        }
      };

      window.speechSynthesis.speak(utterance);
    },
    [startAnimationLoop, stopLevelLoop]
  );

  const speak = useCallback(
    async (rawText: string, persona: string, volume: number) => {
      const text = prepareSpeechText(rawText);
      if (!text) return;

      const myId = ++requestIdRef.current;
      stopPlayback();
      setError(null);
      setPlaybackVolume(volume);

      if (!elevenLabsKey || elevenLabsKey.trim().length === 0) {
        speakNativeFallback(text, myId);
        return;
      }

      try {
        const key = `${persona}|${text}`;
        let arrayBuffer = cacheRef.current.get(key);

        if (!arrayBuffer) {
          setIsLoading(true);
          const controller = new AbortController();
          abortRef.current = controller;

          const voiceId = DEFAULT_VOICE_MAP[persona] || DEFAULT_VOICE_MAP.negotiator;

          const res = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
              method: "POST",
              signal: controller.signal,
              headers: {
                "Content-Type": "application/json",
                "xi-api-key": elevenLabsKey.trim(),
                Accept: "audio/mpeg",
              },
              body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                  stability: 0.5,
                  similarity_boost: 0.75,
                },
              }),
            }
          );

          if (!res.ok) {
            speakNativeFallback(text, myId);
            return;
          }

          arrayBuffer = await res.arrayBuffer();
          if (myId !== requestIdRef.current) return;
          cacheRef.current.set(key, arrayBuffer);
        }

        if (myId !== requestIdRef.current) return;

        const ctx = getAudioContext();
        if (!ctx) throw new Error("AudioContext not supported");

        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        if (myId !== requestIdRef.current) return;

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;

        if (masterGainRef.current) {
          masterGainRef.current.gain.setValueAtTime(volumeRef.current, ctx.currentTime);
          source.connect(masterGainRef.current);
        }

        const durationMs = audioBuffer.duration * 1000;
        const timeline = generateVisemeTimeline(text, durationMs);

        source.onended = () => {
          if (myId === requestIdRef.current) {
            setIsSpeaking(false);
            stopLevelLoop();
          }
        };

        activeSourceRef.current = source;
        const startTimeMs = performance.now();
        source.start(0);

        setIsLoading(false);
        setIsSpeaking(true);
        startAnimationLoop(timeline, startTimeMs);
      } catch {
        speakNativeFallback(text, myId);
      }
    },
    [
      elevenLabsKey,
      getAudioContext,
      setPlaybackVolume,
      speakNativeFallback,
      startAnimationLoop,
      stopPlayback,
    ]
  );

  useEffect(() => {
    return () => {
      requestIdRef.current++;
      abortRef.current?.abort();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      cancelAnimationFrame(rafRef.current);
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      cacheRef.current.clear();
      void ctxRef.current?.close();
    };
  }, []);

  return {
    speak,
    stop,
    setPlaybackVolume,
    isLoading,
    isSpeaking,
    error,
    levelRef,
    visemeRef,
    currentViseme,
  };
}