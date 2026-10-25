// The chat (plan.md §2): the avatar panel on the left, the thread on the right, the rounded input
// bar, the stream badge. Below `lg` the panel becomes a strip at most 72px tall at the top, so the
// conversation gets the screen (plan.md §12.1 finding 5). State lives in ChatContainer and the
// store; this file only renders. Above the input bar, the chat's tools (plan.md §19): upload a
// letter or PDF, Am I owed anything?, and Is this a scam?.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Paperclip, PoundSterling, Radio, ShieldAlert, type LucideIcon } from "lucide-react";
import { ConsentCard } from "@/components/mission";
import { FOCUS, ResizeHandle } from "@/components/ui";
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
import { type ActionRoute, type ChatTool, routeAction } from "./tools";
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
  /** The Gateway's real small-talk model, shown in place of the picker (ChatInput). */
  gatewayModel?: string | null;
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
  /** L was pressed: reply buttons go to their pages again (plan.md §19). */
  revealed?: boolean;
  /** Open a tool as a card in the conversation. */
  onOpenTool?: (tool: ChatTool) => void;
  /** The card for a tool message. */
  renderTool?: (tool: ChatTool) => ReactNode;
}

const TOOLS: { label: string; Icon: LucideIcon; run: "attach" | ChatTool }[] = [
  { label: "Upload a letter or PDF", Icon: Paperclip, run: "attach" },
  { label: "Am I owed anything?", Icon: PoundSterling, run: "owed" },
  { label: "Is this a scam?", Icon: ShieldAlert, run: "shield" },
];

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
    <div role="status" title={s.title} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold tracking-[0.06em] text-slate-300 ring-1 ring-inset ring-white/10">
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
  gatewayModel = null,
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
  revealed = false,
  onOpenTool,
  renderTool,
}: ChatPageProps) {
  const attachRef = useRef<(() => void) | null>(null);
  const runAction = (route: ActionRoute) => {
    if (route.kind === "attach") attachRef.current?.();
    else if (route.kind === "tool") onOpenTool?.(route.tool);
  };
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
            <TaskMessages
              messages={messages}
              pendingSummary={conversation?.ask?.summary ?? null}
              onSpeak={onSpeak}
              onFeedback={onFeedback}
              onSuggest={pick}
              thinking={thinking}
              busy={busy}
              routeAction={(href) => routeAction(href, revealed)}
              onAction={runAction}
              renderTool={renderTool}
            />
          )}
          {chipError && (
            <p role="alert" className="my-2 rounded-2xl border border-rose-400/30 bg-rose-500/[0.08] px-3.5 py-2.5 text-sm text-rose-200">
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

        {onOpenTool && (
          <ul aria-label="Chat tools" className="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {TOOLS.map(({ label, Icon, run }) => (
              <li key={label} className="shrink-0">
                <button
                  type="button"
                  disabled={busy && run === "attach"}
                  onClick={() => (run === "attach" ? attachRef.current?.() : onOpenTool(run))}
                  className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 text-[13px] font-medium text-slate-200 transition-colors hover:border-accent-300/35 hover:bg-accent-500/[0.1] hover:text-white disabled:opacity-50 motion-reduce:transition-none ${FOCUS}`}
                >
                  <Icon size={15} aria-hidden className="text-accent-300" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <ChatInput
          activeModels={activeModels}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          gatewayModel={gatewayModel}
          onSend={onSend}
          onSendAudio={onSendAudio}
          onReadLetter={onReadLetter}
          attachRef={attachRef}
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
