import { useCallback, useEffect, useRef, useState } from "react";

export interface Recording {
  blob: Blob;
  /** Object URL for playback. Valid until the page unloads or the clip is discarded. */
  url: string;
  mimeType: string;
  durationMs: number;
}

export type RecorderStatus = "idle" | "recording" | "ready";

// Chromium and Firefox record webm; Safari and WKWebView (Tauri on macOS) record mp4.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clip, setClip] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (status !== "recording") return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 200);
    return () => clearInterval(timer);
  }, [status]);

  // Release the microphone if the component unmounts mid-recording.
  useEffect(() => () => recorderRef.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = useCallback(async () => {
    if (status !== "idle") return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported in this window.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        const durationMs = Date.now() - startedAt.current;
        setClip({ blob, url: URL.createObjectURL(blob), mimeType: type, durationMs });
        setElapsedMs(durationMs);
        setStatus("ready");
      };

      startedAt.current = Date.now();
      setElapsedMs(0);
      recorder.start();
      recorderRef.current = recorder;
      setStatus("recording");
    } catch {
      setError("Microphone access is blocked. Allow it in your system or browser settings.");
    }
  }, [status]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  /** Throws the clip away. */
  const discard = useCallback(() => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setElapsedMs(0);
    setStatus("idle");
  }, [clip]);

  /** Hands the clip to the caller (who now owns its URL) and returns to idle. */
  const release = useCallback(() => {
    const released = clip;
    setClip(null);
    setElapsedMs(0);
    setStatus("idle");
    return released;
  }, [clip]);

  return { status, elapsedMs, clip, error, start, stop, discard, release };
}