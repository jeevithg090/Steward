// The chat (plan.md §2): the avatar panel on the left, the thread on the right, the rounded input
// bar, the LIVE STREAM badge. State lives in ChatContainer and the store; this file only renders.
import { useState, type CSSProperties } from "react";
import { Radio } from "lucide-react";
import { ConsentCard } from "@/components/mission";
import { ResizeHandle } from "@/components/ui";
import type { Recording } from "@/hooks/useAudioRecorder";
import { useResizable } from "@/hooks/useResizable";
import type { Gateway, Persona } from "@/lib/api";
import { LANGUAGES, type Language } from "@/lib/shield";
import type { ModelProvider } from "@/types/types";
import type { PageUser } from "@/types/page";
import { AvatarPanel, type SpeechRequest } from "./AvatarPanel";
import { ChatInput } from "./ChatInput";
import type { Conversation } from "./store";
import { TaskMessages } from "./TaskMessages";
import { WelcomeCard } from "./WelcomeCard";

export interface ChatPageProps {
  user: PageUser;
  language: Language;
  showcase: boolean;
  /** The Gateway is reachable (its /health answered); the stream badge says so. */
  online: boolean;
  gateway: Pick<Gateway, "tts">;
  ttsAvailable: boolean;
  activeModels: ModelProvider[];
  selectedModel: ModelProvider;
  onSelectModel: (model: ModelProvider) => void;
  conversation: Conversation | null;
  busy: boolean;
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

export function ChatPage({
  user,
  language,
  showcase,
  online,
  gateway,
  ttsAvailable,
  activeModels,
  selectedModel,
  onSelectModel,
  conversation,
  busy,
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
  // A sample chip bypasses the input bar, so its error has its own alert line.
  const [chipError, setChipError] = useState<string | null>(null);
  const avatar = useResizable({ initial: 320, min: 96, max: 520 });
  const messages = conversation?.messages ?? [];
  const isMissionRunning = Boolean(conversation?.missionId && RUNNING.has(conversation.missionState ?? ""));
  const lang = LANGUAGES.find((l) => l.code === language)?.bcp47 ?? "en-GB";
  const tts = (text: string, persona: Persona) => gateway.tts(text, persona);

  const stream = showcase ? { label: "RECORDED REPLAY", tone: "text-amber-400" } : online ? { label: "LIVE STREAM", tone: "text-emerald-400" } : { label: "NO GATEWAY", tone: "text-rose-500" };

  return (
    <div style={{ "--avatar-w": `${avatar.width}px` } as CSSProperties} className="flex h-full min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[min(var(--avatar-w),50%)_auto_minmax(0,1fr)] lg:gap-0">
      <h1 className="sr-only">Chat</h1>
      <AvatarPanel
        className="shrink-0 [@media(max-height:640px)]:max-lg:hidden"
        volume={volume}
        onVolumeChange={setVolume}
        speech={speech}
        elevenLabsKey={elevenLabsKey}
        tts={tts}
        ttsAvailable={ttsAvailable}
        lang={lang}
      />
      <ResizeHandle label="Resize avatar panel" value={avatar.width} min={avatar.min} max={avatar.max} handleProps={avatar.handleProps} />
      <section aria-label="Conversation with Tempo" className="relative flex min-h-0 flex-1 flex-col pb-16">
        <div className="absolute right-4 top-3 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium text-slate-300 backdrop-blur-md" role="status">
          <Radio size={12} className={`${stream.tone} ${online && !showcase ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden />
          <span>{stream.label}</span>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto pt-9">
          {messages.length === 0 ? (
            <WelcomeCard
              name={user.name}
              onPick={(text) => {
                setChipError(null);
                void onSend(text).catch((err: unknown) => setChipError(err instanceof Error ? err.message : String(err)));
              }}
              disabled={busy}
            />
          ) : (
            <TaskMessages messages={messages} onSpeak={onSpeak} onFeedback={onFeedback} />
          )}
          {chipError && (
            <p role="alert" className="mx-4 my-2 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">
              {chipError}
            </p>
          )}

          {conversation?.ask && (
            <div className="mx-4 my-3">
              <ConsentCard ask={conversation.ask} court={conversation.court} busy={busy} onAnswer={(yes) => void onConsent(yes)} />
            </div>
          )}

          <div aria-live="polite" className="mx-4 my-2 min-h-5 text-xs text-slate-400">
            {conversation?.status && (
              <p className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${isMissionRunning ? "bg-amber-400 animate-pulse motion-reduce:animate-none" : "bg-slate-500"}`} aria-hidden />
                {conversation.status}
              </p>
            )}
          </div>
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
