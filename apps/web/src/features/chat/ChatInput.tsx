import { useRef, useState, type FormEvent } from "react";
import { Camera, ChevronDown, Loader2, Mic, SendHorizontal, Square, Trash2 } from "lucide-react";
import { FOCUS } from "@/components/ui";
import { useAudioRecorder, type Recording } from "@/hooks/useAudioRecorder";
import { useElementWidth } from "@/hooks/useElementWidth";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { formatDuration } from "@/lib/formatDuration";
import type { Language } from "@/lib/shield";
import type { ModelProvider } from "@/types/types";

// Local Model is the primary default choice
const MODEL_LABELS: Record<ModelProvider, string> = {
  local: "Local model (Ollama)",
  gemini: "Gemini",
  claude: "Claude",
  openai: "GPT",
};

export interface ChatInputProps {
  activeModels: ModelProvider[];
  selectedModel: ModelProvider;
  onSelectModel: (model: ModelProvider) => void;
  /** Sends one message through the chat door; rejects with a plain-words error. */
  onSend: (text: string) => Promise<void>;
  /** A recorded clip, when the browser cannot turn speech into text. */
  onSendAudio: (clip: Recording) => void;
  /** A photo of a letter for Read It To Me; rejects with a plain-words error. */
  onReadLetter: (file: File) => Promise<void>;
  /** The kill switch while a mission is running. */
  onStop?: () => Promise<void>;
  isMissionRunning?: boolean;
  onMicPress?: () => void;
  language: Language;
  /** The one question Tempo is waiting on, shown as the placeholder. */
  placeholder?: string | null;
  disabled?: boolean;
}

const SHOW_MODEL_FROM = 360;
const roundBtn = `shrink-0 rounded-full p-2 ${FOCUS}`;

export function ChatInput({
  activeModels,
  selectedModel,
  onSelectModel,
  onSend,
  onSendAudio,
  onReadLetter,
  onStop,
  isMissionRunning = false,
  onMicPress,
  language,
  placeholder,
  disabled = false,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formRef, width] = useElementWidth<HTMLFormElement>();
  const fileRef = useRef<HTMLInputElement>(null);

  const recorder = useAudioRecorder();
  const { status, elapsedMs, clip, error: recorderError } = recorder;

  const send = async (message: string) => {
    const clean = message.trim();
    if (!clean || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSend(clean);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const speech = useSpeechRecognition({
    language,
    onInterim: (heard) => setText(heard),
    onFinal: (heard) => {
      setText(heard);
      void send(heard);
    },
  });

  const hasText = text.trim().length > 0;
  const busy = isSubmitting || isReading;
  const sortedActiveModels = [...activeModels].sort((a, b) => (a === "local" ? -1 : b === "local" ? 1 : 0));

  const sendAudio = () => {
    const released = recorder.release();
    if (released) onSendAudio(released);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status === "ready") return sendAudio();
    if (speech.listening) return speech.stop();
    if (busy || !hasText) return;
    void send(text);
  };

  const handleMic = () => {
    onMicPress?.();
    setError(null);
    if (speech.supported) speech.start();
    else void recorder.start();
  };

  const handleStop = async () => {
    if (!onStop) return;
    setError(null);
    try {
      await onStop();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setIsReading(true);
    setError(null);
    try {
      await onReadLetter(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const displayError = recorderError || speech.error || error;
  const hint = speech.listening ? "Listening…" : isReading ? "Reading the letter…" : isSubmitting ? "Thinking…" : placeholder || "Tell me what happened, or ask a question";

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-label="Message Tempo" className="absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-full border border-white/10 bg-nexus-card px-3 py-2 shadow-2xl">
      {displayError && (
        <p role="alert" className="absolute bottom-full left-4 mb-2 max-w-[90%] rounded-lg bg-slate-900/95 px-3 py-1.5 text-xs text-rose-300">
          {displayError}
        </p>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => void handleFile(e.target.files?.[0])} />

      {status === "idle" && (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || disabled}
            aria-label="Photograph or pick a letter to read"
            title="Read a letter: photograph it or pick a photo"
            className={`${roundBtn} text-white hover:bg-white/10 disabled:opacity-50`}
          >
            {isReading ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Camera size={18} aria-hidden />}
          </button>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            disabled={disabled || (busy && !speech.listening)}
            placeholder={hint}
            aria-label="Your message"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white placeholder:text-nexus-silver focus:outline-none disabled:opacity-50"
          />
        </>
      )}

      {status === "recording" && (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm text-white" role="status">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500 motion-reduce:animate-none" />
          <span className="truncate">Recording a clip</span>
          <span className="tabular-nums text-nexus-silver">{formatDuration(elapsedMs)}</span>
        </div>
      )}

      {status === "ready" && clip && <audio src={clip.url} controls className="h-8 min-w-0 flex-1" aria-label="Recorded message" />}

      {status === "idle" && !speech.listening && width >= SHOW_MODEL_FROM && (
        <div className="relative shrink-0 plain-hide">
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value as ModelProvider)}
            disabled={busy}
            aria-label="Model that phrases small talk"
            className={`cursor-pointer appearance-none rounded-full bg-nexus-badge py-1.5 pl-3 pr-7 text-xs font-medium text-white disabled:opacity-50 ${FOCUS}`}
          >
            {sortedActiveModels.map((m) => (
              <option key={m} value={m} className="bg-slate-900 text-white">
                {MODEL_LABELS[m]}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white" aria-hidden />
        </div>
      )}

      {status === "idle" && (
        <>
          {speech.listening ? (
            <button type="button" onClick={speech.stop} aria-label="Stop listening" className={`${roundBtn} bg-rose-500 text-white hover:bg-rose-400`}>
              <Square size={18} fill="currentColor" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleMic}
              disabled={busy || disabled}
              aria-label={speech.supported ? "Speak your message" : "Record a voice clip"}
              title={speech.supported ? "Speak; I'll type what you say" : "This browser can't turn speech into text; it records a clip"}
              className={`${roundBtn} bg-white text-black hover:bg-white/90 disabled:opacity-50 ${hasText ? "lg:hidden" : ""}`}
            >
              <Mic size={18} aria-hidden />
            </button>
          )}

          {isMissionRunning && onStop && !speech.listening && (
            <button type="button" onClick={() => void handleStop()} aria-label="Stop the mission" title="Stop: nothing more will be sent" className={`${roundBtn} bg-rose-600 text-white hover:bg-rose-500`}>
              <Square size={18} fill="currentColor" aria-hidden />
            </button>
          )}

          {isSubmitting ? (
            <span role="status" aria-label="Sending" className={`${roundBtn} text-white`}>
              <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
            </span>
          ) : (
            hasText &&
            !speech.listening && (
              <button type="submit" disabled={disabled} aria-label="Send" className={`${roundBtn} bg-white text-black hover:bg-white/90 disabled:opacity-50`}>
                <SendHorizontal size={18} aria-hidden />
              </button>
            )
          )}
        </>
      )}

      {status === "recording" && (
        <button type="button" onClick={recorder.stop} aria-label="Stop recording" className={`${roundBtn} bg-rose-500 text-white hover:bg-rose-400`}>
          <Square size={18} fill="currentColor" aria-hidden />
        </button>
      )}

      {status === "ready" && (
        <>
          <button type="button" onClick={recorder.discard} aria-label="Discard recording" className={`${roundBtn} text-white hover:bg-white/10`}>
            <Trash2 size={18} aria-hidden />
          </button>
          <button type="submit" aria-label="Send recording" className={`${roundBtn} bg-white text-black hover:bg-white/90`}>
            <SendHorizontal size={18} aria-hidden />
          </button>
        </>
      )}
    </form>
  );
}
