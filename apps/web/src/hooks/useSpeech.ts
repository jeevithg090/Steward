import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SPOKEN_CHARS = 450;

const DEFAULT_VOICE_MAP: Record<string, string> = {
  negotiator: "21m00Tcm4TlvDq8ikWAM", // Rachel
  analyst: "AZnzlk1XvdvUeBnXmlld",    // Domi
  auditor: "EXAVITQu4vr4xnSDxMaL",    // Bella
  contractor: "ErXwobaYiN019PkySvjV", // Antoni
};

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

  const ctxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const rafRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map<string, ArrayBuffer>());
  const levelRef = useRef<HTMLDivElement | null>(null);
  const volumeRef = useRef<number>(1);

  const stopLevelLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (levelRef.current) {
      levelRef.current.style.setProperty("--level", "0");
    }
  }, []);

  const startLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const level = Math.min(1, sum / data.length / 90);
      if (levelRef.current) {
        levelRef.current.style.setProperty("--level", level.toFixed(3));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // Simulated visualizer pulsing when using Web Speech API fallback
  const startFallbackVisualizer = useCallback(() => {
    let phase = 0;
    const tick = () => {
      phase += 0.15;
      const simulatedLevel = (Math.sin(phase) + 1) * 0.35 + Math.random() * 0.2;
      if (levelRef.current) {
        levelRef.current.style.setProperty("--level", simulatedLevel.toFixed(3));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const getAudioContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;

      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      const gainNode = ctx.createGain();
      gainNode.gain.value = volumeRef.current;

      gainNode.connect(analyser);
      analyser.connect(ctx.destination);

      ctxRef.current = ctx;
      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;
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
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = normalized;
    }
  }, []);

  // Browser Native Web Speech API Fallback
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

      utterance.onstart = () => {
        if (myId !== requestIdRef.current) return;
        setIsLoading(false);
        setIsSpeaking(true);
        startFallbackVisualizer();
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
    [startFallbackVisualizer, stopLevelLoop]
  );

  const speak = useCallback(
    async (rawText: string, persona: string, volume: number) => {
      const text = prepareSpeechText(rawText);
      if (!text) return;

      const myId = ++requestIdRef.current;
      stopPlayback();
      setError(null);
      setPlaybackVolume(volume);

      // If no ElevenLabs key, use native Web Speech API directly
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
            console.warn(`ElevenLabs API returned ${res.status}. Falling back to browser SpeechSynthesis.`);
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

        if (gainNodeRef.current) {
          source.connect(gainNodeRef.current);
        }

        source.onended = () => {
          if (myId === requestIdRef.current) {
            setIsSpeaking(false);
            stopLevelLoop();
          }
        };

        activeSourceRef.current = source;
        source.start(0);

        setIsLoading(false);
        setIsSpeaking(true);
        startLevelLoop();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Fall back to Web Speech API on network error / rate limiting
        speakNativeFallback(text, myId);
      }
    },
    [
      elevenLabsKey,
      getAudioContext,
      setPlaybackVolume,
      speakNativeFallback,
      startLevelLoop,
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

  return { speak, stop, setPlaybackVolume, isLoading, isSpeaking, error, levelRef };
}