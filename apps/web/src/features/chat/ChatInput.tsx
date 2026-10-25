import { useState, useRef, type FormEvent } from "react";
import { ChevronDown, Mic, SendHorizontal, Square, Trash2 } from "lucide-react";
import { useAudioRecorder, type Recording } from "../../hooks/useAudioRecorder";
import { useElementWidth } from "../../hooks/useElementWidth";
import { formatDuration } from "../../lib/formatDuration";
import type { ModelProvider } from "../../types/types";

// Local Model is the primary default choice
const MODEL_LABELS: Record<ModelProvider, string> = {
  local: "Local Model (Primary • Ollama)",
  gemini: "Gemini Pro",
  claude: "Claude 3.5 Sonnet",
  openai: "GPT-4o",
};

interface ChatInputProps {
  activeModels: ModelProvider[];
  selectedModel: ModelProvider;
  onSelectModel: (model: ModelProvider) => void;
  onSubmit: (text: string, responseData?: unknown) => void;
  onSendAudio: (clip: Recording) => void;
  onMicPress?: () => void;
  apiBaseUrl?: string;
  apiToken?: string;
  userId?: string;
  onSubmittingChange?: (submitting: boolean) => void;
  // True while a mission is still running after the POST returned (kill switch stays visible).
  isMissionRunning?: boolean;
  onAbort?: () => void;
}

const SHOW_MODEL_FROM = 300;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const roundBtn = `shrink-0 rounded-full p-2 ${focus}`;

export function ChatInput({
  activeModels,
  selectedModel,
  onSelectModel,
  onSubmit,
  onSendAudio,
  onMicPress,
  apiBaseUrl = "http://127.0.0.1:8000",
  apiToken = "devtoken",
  userId = "u_margaret",
  onSubmittingChange,
  isMissionRunning = false,
  onAbort,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formRef, width] = useElementWidth<HTMLFormElement>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeMissionIdRef = useRef<string | null>(null);

  const recorder = useAudioRecorder();
  const { status, elapsedMs, clip, error: recorderError } = recorder;
  const hasText = text.trim().length > 0;

  // Kill switch is available while the request is in flight AND while the mission keeps running.
  const canAbort = isSubmitting || isMissionRunning;

  // Ensure "local" is prioritized first when sorting activeModels in the selector
  const sortedActiveModels = [...activeModels].sort((a, b) => {
    if (a === "local") return -1;
    if (b === "local") return 1;
    return 0;
  });

  const sendAudio = () => {
    const released = recorder.release();
    if (released) onSendAudio(released);
  };

  const handleAbort = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (activeMissionIdRef.current) {
      const missionId = activeMissionIdRef.current;
      activeMissionIdRef.current = null;
      try {
        await fetch(`${apiBaseUrl}/missions/${missionId}/stop`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}` },
        });
      } catch (e) {
        console.error("Failed to stop mission:", e);
      }
    }

    setIsSubmitting(false);
    onSubmittingChange?.(false);
    onAbort?.(); // parent stops a mission that is already running
  };

  const sendTextToBackend = async (messageText: string) => {
    setIsSubmitting(true);
    onSubmittingChange?.(true);
    setApiError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${apiBaseUrl}/missions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          user_id: userId,
          display_name: userId.replace(/^u_/, ""),
          origin_crs: "OXF",
          destination_crs: "PAD",
          travel_date: "2026-10-23",
          departure: "08:12",
          fare_gbp: "28.40",
          time_value_gbp_h: "18",
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.detail || `HTTP ${response.status}: Failed to submit mission`);
      }

      const data = await response.json();
      if (data?.id) activeMissionIdRef.current = data.id;

      onSubmit(messageText, data);
      setText("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Failed to connect to backend";
      setApiError(message);
    } finally {
      abortControllerRef.current = null;
      activeMissionIdRef.current = null;
      setIsSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status === "ready") return sendAudio();
    if (isSubmitting) return handleAbort();
    if (isMissionRunning) return; // Enter shouldn't start a second mission or kill this one
    if (!hasText) return;

    void sendTextToBackend(text.trim());
  };

  const handleMic = () => {
    onMicPress?.();
    void recorder.start();
  };

  const displayError = recorderError || apiError;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-full border border-white/10 bg-nexus-card px-3 py-2 shadow-2xl"
    >
      {displayError && (
        <p role="alert" className="absolute bottom-full left-4 mb-2 rounded bg-slate-900/90 px-2 py-1 text-xs text-red-400">
          {displayError}
        </p>
      )}

      {status === "idle" && (
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (apiError) setApiError(null);
          }}
          disabled={isSubmitting}
          placeholder={canAbort ? "Processing mission..." : "What task do you want to complete?"}
          aria-label="Task"
          className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white placeholder:text-nexus-silver focus:outline-none disabled:opacity-50"
        />
      )}

      {status === "recording" && (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm text-white" role="status">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" />
          <span className="truncate">Recording</span>
          <span className="tabular-nums text-nexus-silver">{formatDuration(elapsedMs)}</span>
        </div>
      )}

      {status === "ready" && clip && <audio src={clip.url} controls className="h-8 min-w-0 flex-1" aria-label="Recorded message" />}

      {status === "idle" && width >= SHOW_MODEL_FROM && (
        <div className="relative shrink-0">
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value as ModelProvider)}
            disabled={canAbort}
            aria-label="Select Model"
            className="cursor-pointer appearance-none rounded-full bg-nexus-badge py-1.5 pl-3 pr-7 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          >
            {sortedActiveModels.map((m) => (
              <option key={m} value={m} className="bg-slate-900 text-white">
                {MODEL_LABELS[m]}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white" />
        </div>
      )}

      {status === "idle" && (
        <>
          {!canAbort && (
            <button
              type="button"
              onClick={handleMic}
              aria-label="Record voice message"
              className={`${roundBtn} bg-white text-black hover:bg-white/90 ${hasText ? "lg:hidden" : ""}`}
            >
              <Mic size={18} />
            </button>
          )}

          {canAbort ? (
            <button
              type="button"
              onClick={handleAbort}
              aria-label="Abort mission"
              title="Abort mission"
              className={`${roundBtn} bg-red-500 text-white transition-colors hover:bg-red-600`}
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            hasText && (
              <button type="submit" aria-label="Send" className={`${roundBtn} bg-white text-black hover:bg-white/90`}>
                <SendHorizontal size={18} />
              </button>
            )
          )}
        </>
      )}

      {status === "recording" && (
        <button type="button" onClick={recorder.stop} aria-label="Stop recording" className={`${roundBtn} bg-red-500 text-white hover:bg-red-400`}>
          <Square size={18} fill="currentColor" />
        </button>
      )}

      {status === "ready" && (
        <>
          <button type="button" onClick={recorder.discard} aria-label="Discard recording" className={`${roundBtn} text-white hover:bg-white/10`}>
            <Trash2 size={18} />
          </button>
          <button type="submit" aria-label="Send recording" className={`${roundBtn} bg-white text-black hover:bg-white/90`}>
            <SendHorizontal size={18} />
          </button>
        </>
      )}
    </form>
  );
}