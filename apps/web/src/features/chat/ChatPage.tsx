// The chat (plan.md §2): the avatar panel on the left, the thread on the right, the rounded input
// bar, the stream badge. Below `lg` the panel becomes a strip at most 72px tall at the top, so the
// conversation gets the screen (plan.md §12.1 finding 5). State lives in ChatContainer and the
// store; this file only renders.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Radio } from "lucide-react";
import { ConsentCard } from "@/components/mission";
import { ResizeHandle } from "@/components/ui";
import type { Recording } from "@/hooks/useAudioRecorder";
import { useMediaQuery, WIDE } from "@/hooks/useMediaQuery";
import { useResizable } from "@/hooks/useResizable";
import type { Gateway, Persona } from "@/lib/api";
import { LANGUAGES, type Language } from "@/lib/shield";
import type { ModelProvider } from "@/types/types";
import type { PageUser } from "@/types/page";
import { AvatarPanel, type SpeechRequest } from "./AvatarPanel";
import { ChatInput } from "./ChatInput";
import type { Conversation } from "./store";
import { TaskMessages, TypingIndicator } from "./TaskMessages";
import { WelcomeCard } from "./WelcomeCard";

/** How the page reaches Tempo right now: the recordings, the live stream, the Gateway without its stream, or nothing. */
export type Link = "showcase" | "live" | "gateway" | "offline";

export interface ChatPageProps {
  user: PageUser;
  language: Language;
  showcase: boolean;
  /** The live event stream is open, or only /health answers, or neither (the stream badge says which). */
  link: Link;
  gateway: Pick<Gateway, "tts">;
  ttsAvailable: boolean;
  activeModels: ModelProvider[];
  selectedModel: ModelProvider;
  onSelectModel: (model: ModelProvider) => void;
  conversation: Conversation | null;
  /** Something is in flight (a turn, an answer, a stop): buttons wait. */
  busy: boolean;
  /** A /chat turn is in flight: the typing dots show. */
  thinking?: boolean;
  /** This device signs answers with a passkey (useMesh().signs). */
  signs?: boolean;
  onSend: (text: string) => Promise<void>;
  onSendAudio: (clip: Recording) => void;
  onReadLetter: (file: File) => Promise<void>;
  onConsent: (approved: boolean) => Promise<void>;
  onStop: () => Promise<void>;
  onFeedback?: (alertId: string, label: "scam" | "real") => Promise<void>;
  onSpeak: (text: string) => void;
  speech: SpeechRequest | null;
  elevenLabsKey?: string;
}

const RUNNING = new Set(["running", "waiting", "checkpoint"]);

const LINKS: Record<Link, { label: string; short: string; tone: string; title: string }> = {
  showcase: { label: "RECORDED REPLAY", short: "REPLAY", tone: "text-amber-400", title: "No Gateway: recorded replies" },
  live: { label: "LIVE STREAM", short: "LIVE", tone: "text-emerald-400", title: "Live updates from the Gateway are on" },
  gateway: { label: "NO LIVE STREAM", short: "NO STREAM", tone: "text-slate-400", title: "The Gateway answers, but live updates are not connected yet" },
  offline: { label: "NO GATEWAY", short: "OFFLINE", tone: "text-rose-500", title: "The web app cannot reach the Gateway" },
};

function StreamBadge({ link, short }: { link: Link; short: boolean }) {
  const s = LINKS[link];
  return (
    <div role="status" title={s.title} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium text-slate-300 backdrop-blur-md">
      <Radio size={12} className={`${s.tone} ${link === "live" ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden />
      {short ? (
        <>
          <span aria-hidden>{s.short}</span>
          <span className="sr-only">{s.label}</span>
        </>
      ) : (
        <span>{s.label}</span>
      )}
    </div>
  );
}

export function ChatPage({
  user,
  language,
  link,
  gateway,
  ttsAvailable,
  activeModels,
  selectedModel,
  onSelectModel,
  conversation,
  busy,
  thinking = false,
  signs = false,
  onSend,
  onSendAudio,
  onReadLetter,
  onConsent,
  onStop,
  onFeedback,
  onSpeak,
  speech,
  elevenLabsKey,
}: ChatPageProps) {
  const [volume, setVolume] = useState(80);
  // A sample or suggestion chip bypasses the input bar, so its error has its own alert line.
  const [chipError, setChipError] = useState<string | null>(null);
  const avatar = useResizable({ initial: 320, min: 96, max: 520 });
  const wide = useMediaQuery(WIDE);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = conversation?.messages ?? [];
  const isMissionRunning = Boolean(conversation?.missionId && RUNNING.has(conversation.missionState ?? ""));
  const lang = LANGUAGES.find((l) => l.code === language)?.bcp47 ?? "en-GB";
  const tts = (text: string, persona: Persona) => gateway.tts(text, persona);
  const askId = conversation?.ask?.request_id ?? null;

  // Keep the newest message, the typing dots and the ask in view (jsdom has no scrollIntoView).
  // The welcome card is read from the top, so an empty chat does not scroll.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (hasMessages) endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [hasMessages, messages.length, thinking, askId]);

  const pick = (text: string) => {
    setChipError(null);
    void onSend(text).catch((err: unknown) => setChipError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div style={{ "--avatar-w": `${avatar.width}px` } as CSSProperties} className="flex h-full min-h-0 flex-col gap-2 lg:grid lg:grid-cols-[min(var(--avatar-w),50%)_auto_minmax(0,1fr)] lg:gap-0">
      <h1 className="sr-only">Chat</h1>
      <AvatarPanel
        className="shrink-0"
        compact={!wide}
        extra={!wide ? <StreamBadge link={link} short /> : undefined}
        volume={volume}
        onVolumeChange={setVolume}
        speech={speech}
        elevenLabsKey={elevenLabsKey}
        tts={tts}
        ttsAvailable={ttsAvailable}
        lang={lang}
      />
      {wide && <ResizeHandle label="Resize avatar panel" value={avatar.width} min={avatar.min} max={avatar.max} handleProps={avatar.handleProps} />}
      <section aria-label="Conversation with Tempo" className="relative flex min-h-0 flex-1 flex-col gap-2">
        {wide && (
          // In the flow, above the thread, so it can never cover a bubble or a button.
          <div className="flex shrink-0 items-center justify-between gap-3 px-2">
            <p className="min-w-0 truncate text-xs text-slate-400">{conversation?.title ?? "New conversation"}</p>
            <StreamBadge link={link} short={false} />
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 lg:px-2">
          {messages.length === 0 ? (
            <>
              <WelcomeCard name={user.name} onPick={pick} disabled={busy} />
              {thinking && <TypingIndicator />}
            </>
          ) : (
            <TaskMessages messages={messages} pendingSummary={conversation?.ask?.summary ?? null} onSpeak={onSpeak} onFeedback={onFeedback} onSuggest={pick} thinking={thinking} busy={busy} />
          )}
          {chipError && (
            <p role="alert" className="my-2 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
              {chipError}
            </p>
          )}

          {conversation?.ask && (
            <div className="my-3">
              <ConsentCard ask={conversation.ask} court={conversation.court} busy={busy} onAnswer={(yes) => void onConsent(yes)} signed={signs} />
            </div>
          )}

          <div aria-live="polite" className="my-2 min-h-5 text-xs text-slate-400">
            {conversation?.status && (
              <p className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${isMissionRunning ? "bg-amber-400 animate-pulse motion-reduce:animate-none" : "bg-slate-500"}`} aria-hidden />
                {conversation.status}
              </p>
            )}
          </div>
          <div ref={endRef} />
        </div>

        <ChatInput
          activeModels={activeModels}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onSend={onSend}
          onSendAudio={onSendAudio}
          onReadLetter={onReadLetter}
          onStop={onStop}
          isMissionRunning={isMissionRunning}
          onMicPress={() => setVolume(0)}
          language={language}
          placeholder={conversation?.need?.question ?? null}
          disabled={busy}
        />
      </section>
    </div>
  );
}
