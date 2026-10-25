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
  /** The model the Gateway really phrases small talk with (from /health). When known, it is shown
   * instead of the picker: the Gateway's deployment decides, so a picker would choose nothing. */
  gatewayModel?: string | null;
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
const roundBtn = `flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${FOCUS}`;

export function ChatInput({
  activeModels,
  selectedModel,
  onSelectModel,
  gatewayModel = null,
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
  const hint = speech.listening ? "Listening…" : isReading ? "Reading the letter…" : isSubmitting ? "Thinking…" : placeholder || (width > 0 && width < 640 ? "Tell me what happened" : "Tell me what happened, or ask a question");

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-label="Message Tempo" className="glass-strong relative flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 transition-[box-shadow,border-color] duration-200 focus-within:border-accent-300/40 focus-within:shadow-[0_0_0_4px_rgb(var(--accent-500)/0.12),0_30px_80px_-30px_rgb(0_0_0/0.95)] sm:gap-2 sm:px-2.5 sm:py-2 motion-reduce:transition-none">
      {displayError && (
        <p role="alert" className="glass-strong absolute bottom-full left-4 mb-2 max-w-[90%] rounded-xl px-3 py-1.5 text-xs text-rose-200">
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
            className="min-w-0 flex-1 bg-transparent px-2 text-[15px] text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
          />
        </>
      )}

      {status === "recording" && (
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm text-white" role="status">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500 motion-reduce:animate-none" />
          <span className="truncate">Recording a clip</span>
          <span className="num text-slate-400">{formatDuration(elapsedMs)}</span>
        </div>
      )}

      {status === "ready" && clip && <audio src={clip.url} controls className="h-8 min-w-0 flex-1" aria-label="Recorded message" />}

      {status === "idle" && !speech.listening && width >= SHOW_MODEL_FROM && gatewayModel && (
        <span
          title={`Tempo's Gateway phrases small talk with ${gatewayModel}. No model ever sets an amount.`}
          className="plain-hide max-w-[11rem] shrink-0 truncate rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10"
        >
          <span className="sr-only">Small talk is phrased by </span>AI: {gatewayModel}
        </span>
      )}

      {status === "idle" && !speech.listening && width >= SHOW_MODEL_FROM && !gatewayModel && (
        <div className="relative shrink-0 plain-hide">
          <select
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value as ModelProvider)}
            disabled={busy}
            aria-label="Model that phrases small talk"
            className={`cursor-pointer appearance-none rounded-full bg-white/[0.06] py-1.5 pl-3 pr-7 text-xs font-medium text-slate-200 ring-1 ring-inset ring-white/10 hover:bg-white/[0.1] disabled:opacity-50 ${FOCUS}`}
          >
            {sortedActiveModels.map((m) => (
              <option key={m} value={m} className="bg-ink-800 text-white">
                {MODEL_LABELS[m]}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
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
              className={`${roundBtn} bg-gradient-to-b from-accent-500 to-accent-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_8px_22px_-8px_rgb(var(--accent-600)/0.9)] hover:from-accent-400 disabled:opacity-50 ${hasText ? "lg:hidden" : ""}`}
            >
              <Mic size={18} aria-hidden />
            </button>
          )}

          {isMissionRunning && onStop && !speech.listening && (
            <button
              type="button"
              onClick={() => void handleStop()}
              aria-label="Stop the mission"
              title="Stop: nothing more will be sent"
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-rose-600 px-3 text-xs font-bold uppercase tracking-wide text-white hover:bg-rose-500 ${FOCUS}`}
            >
              <Square size={14} fill="currentColor" aria-hidden />
              Stop
            </button>
          )}

          {isSubmitting ? (
            <span role="status" aria-label="Sending" className={`${roundBtn} text-white`}>
              <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
            </span>
          ) : (
            hasText &&
            !speech.listening && (
              <button type="submit" disabled={disabled} aria-label="Send" className={`${roundBtn} bg-gradient-to-b from-accent-500 to-accent-700 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_8px_22px_-8px_rgb(var(--accent-600)/0.9)] hover:from-accent-400 disabled:opacity-50`}>
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
          <button type="submit" aria-label="Send recording" className={`${roundBtn} bg-gradient-to-b from-accent-500 to-accent-700 text-white hover:from-accent-400`}>
            <SendHorizontal size={18} aria-hidden />
          </button>
        </>
      )}
    </form>
  );
}
