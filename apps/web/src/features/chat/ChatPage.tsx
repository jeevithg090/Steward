import { useEffect, useState, useRef, type CSSProperties } from "react";
import { Check, Loader2, Radio, ShieldAlert, X } from "lucide-react";
import { ResizeHandle } from "../../components/ui/ResizeHandle";
import type { Recording } from "../../hooks/useAudioRecorder";
import { useResizable } from "../../hooks/useResizable";
import type { ChatMessage, ConsentAsk, LiveEvent, ModelProvider } from "../../types/types";
import { AvatarPanel, type SpeechRequest } from "./AvatarPanel";
import { ChatInput } from "./ChatInput";
import { TaskMessages } from "./TaskMessages";

interface MissionResponse {
  id?: string;
  ask?: ConsentAsk | null;
  message?: string | null;
  state?: string;
}

// States after which a mission is no longer running (the kill switch hides).
const TERMINAL_STATES = new Set(["done", "completed", "complete", "stopped", "failed", "cancelled", "paid", "refused"]);

interface ChatPageProps {
  activeModels: ModelProvider[];
  selectedModel: ModelProvider;
  onSelectModel: (model: ModelProvider) => void;
  messages: ChatMessage[];
  activeAsk: ConsentAsk | null;
  setActiveAsk: (ask: ConsentAsk | null) => void;
  activeMissionId: string | null;
  setActiveMissionId: (id: string | null) => void;
  onSendMessage: (task: string, responseData?: unknown) => void;
  onSendAudio: (clip: Recording) => void;
  speech?: SpeechRequest | null;
  elevenLabsKey?: string;
  apiBaseUrl?: string;
  apiToken?: string;
}

export function ChatPage({
  activeModels,
  selectedModel,
  onSelectModel,
  messages,
  activeAsk,
  setActiveAsk,
  activeMissionId,
  onSendMessage,
  onSendAudio,
  speech,
  elevenLabsKey,
  apiBaseUrl = "http://127.0.0.1:8000",
  apiToken = "devtoken",
}: ChatPageProps) {
  const [volume, setVolume] = useState(80);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Live status text per mission, so one chat's progress never shows up in another chat.
  const [statusByMission, setStatusByMission] = useState<Record<string, string>>({});
  const setMissionStatus = (missionId: string | null | undefined, text: string | null) => {
    if (!missionId) return;
    setStatusByMission((prev) => {
      const next = { ...prev };
      if (text === null) delete next[missionId];
      else next[missionId] = text;
      return next;
    });
  };

  const [isRespondingConsent, setIsRespondingConsent] = useState(false);
  const [runningMissionId, setRunningMissionId] = useState<string | null>(null);

  const avatar = useResizable({ initial: 320, min: 96, max: 520 });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSendMessageRef = useRef(onSendMessage);
  const setActiveAskRef = useRef(setActiveAsk);
  const runningMissionIdRef = useRef(runningMissionId);
  const activeMissionIdRef = useRef(activeMissionId);

  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
    setActiveAskRef.current = setActiveAsk;
    runningMissionIdRef.current = runningMissionId;
    activeMissionIdRef.current = activeMissionId;
  });

  const wsUrl = `${apiBaseUrl.replace(/^http/, "ws")}/events?token=${encodeURIComponent(apiToken)}`;

  useEffect(() => {
    let backoffMs = 1000;
    let isUnmounted = false;
    let ws: WebSocket | null = null;

    const connectWebSocket = () => {
      if (isUnmounted) return;

      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isUnmounted) {
            ws?.close();
            return;
          }
          setIsConnected(true);
          backoffMs = 1000;
        };

        ws.onmessage = (event) => {
          if (isUnmounted) return;
          try {
            const liveEvent: LiveEvent = JSON.parse(event.data);
            const eventMissionId =
              ("mission_id" in liveEvent ? liveEvent.mission_id : undefined) ?? runningMissionIdRef.current;
            switch (liveEvent.type) {
              case "state_changed":
                if (TERMINAL_STATES.has(String(liveEvent.to))) {
                  setMissionStatus(liveEvent.mission_id, null);
                  setRunningMissionId((prev) => (prev === liveEvent.mission_id ? null : prev));
                } else {
                  setMissionStatus(liveEvent.mission_id, `Mission ${liveEvent.mission_id.slice(0, 8)} → ${liveEvent.to}`);
                }
                break;
              case "consent_requested":
                setMissionStatus(eventMissionId, "Action required: Consent requested");
                break;
              case "timer_set":
                setMissionStatus(eventMissionId, "Payment check scheduled");
                break;
              case "outcome":
                setRunningMissionId((prev) => (!eventMissionId || prev === eventMissionId ? null : prev));
                setIsProcessing(false);
                setMissionStatus(eventMissionId, null);
                if (liveEvent.message) {
                  onSendMessageRef.current("", { id: eventMissionId ?? undefined, message: liveEvent.message, state: liveEvent.state });
                } else if (!eventMissionId || eventMissionId === activeMissionIdRef.current) {
                  setActiveAskRef.current(null);
                }
                break;
              default:
                break;
            }
          } catch (e) {
            console.error("Failed to parse WebSocket event:", e);
          }
        };

        ws.onclose = (event) => {
          if (isUnmounted) return;
          setIsConnected(false);
          if (event.code !== 4401) {
            reconnectTimeoutRef.current = setTimeout(() => {
              backoffMs = Math.min(backoffMs * 2, 16000);
              connectWebSocket();
            }, backoffMs);
          }
        };

        ws.onerror = (err) => {
          if (isUnmounted) return;
          console.error("WebSocket connection error:", err);
        };
      } catch (e) {
        console.error("Error initializing WebSocket:", e);
      }
    };

    connectWebSocket();

    return () => {
      isUnmounted = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (ws) {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws?.close();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        wsRef.current = null;
      }
    };
  }, [wsUrl]);

  // Handle consent answer (Approve or Reject)
  const handleConsentDecision = async (approved: boolean) => {
    if (!activeAsk) return;
    setIsRespondingConsent(true);

    try {
      if (approved) {
        const res = await fetch(`${apiBaseUrl}/approvals/${activeAsk.request_id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({ approved: true }),
        });

        if (!res.ok) throw new Error("Failed to submit approval");
        const updatedMission: MissionResponse = await res.json();

        setActiveAsk(null);
        setRunningMissionId(updatedMission.id ?? activeMissionId);
        setMissionStatus(updatedMission.id ?? activeMissionId, "Claim submitted. Waiting for payment verification...");
        onSendMessage("", updatedMission);
      } else {
        if (activeMissionId) {
          await fetch(`${apiBaseUrl}/missions/${activeMissionId}/stop`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}` },
          });
        }
        setActiveAsk(null);
        setRunningMissionId(null);
        setMissionStatus(activeMissionId, null);
        setIsProcessing(false);
        onSendMessage("", { message: "Stopped: You declined the claim." });
      }
    } catch (err) {
      console.error("Consent response error:", err);
    } finally {
      setIsRespondingConsent(false);
    }
  };

  const handleTaskSubmit = (text: string, responseData?: unknown) => {
    setIsProcessing(false);
    onSendMessage(text, responseData);

    if (responseData && typeof responseData === "object") {
      const res = responseData as MissionResponse;
      if (res.id && !TERMINAL_STATES.has(String(res.state))) setRunningMissionId(res.id);
    }
  };

  const handleStopMission = async () => {
    const id = runningMissionId;
    if (!id) return;
    setRunningMissionId(null);
    setActiveAsk(null);
    setMissionStatus(id, null);
    setIsProcessing(false);
    try {
      await fetch(`${apiBaseUrl}/missions/${id}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
      });
    } catch (e) {
      console.error("Failed to stop mission:", e);
    }
    onSendMessage("", { message: "Stopped: you aborted the mission." });
  };

  const isMissionRunning = runningMissionId !== null && runningMissionId === activeMissionId;
  const latestEventStatus = activeMissionId ? (statusByMission[activeMissionId] ?? null) : null;

  return (
    <div
      style={{ "--avatar-w": `${avatar.width}px` } as CSSProperties}
      className="flex h-full min-h-0 flex-col gap-3 lg:grid lg:grid-cols-[min(var(--avatar-w),50%)_auto_minmax(0,1fr)] lg:gap-0"
    >
      <AvatarPanel
        className="shrink-0 [@media(max-height:640px)]:max-lg:hidden"
        volume={volume}
        onVolumeChange={setVolume}
        speech={speech}
        elevenLabsKey={elevenLabsKey}
        apiBaseUrl={apiBaseUrl}
        apiToken={apiToken}
      />
      <ResizeHandle
        label="Resize avatar panel"
        value={avatar.width}
        min={avatar.min}
        max={avatar.max}
        handleProps={avatar.handleProps}
      />
      <section className="relative flex min-h-0 flex-1 flex-col pb-16">
        {/* Live WebSocket Connection Status Badge */}
        <div className="absolute right-4 top-3 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium text-slate-300 backdrop-blur-md">
          <Radio size={12} className={isConnected ? "text-emerald-400 animate-pulse" : "text-rose-500"} />
          <span>{isConnected ? "LIVE STREAM" : "DISCONNECTED"}</span>
        </div>

        <div className="relative flex-1 min-h-0 overflow-y-auto">
          <TaskMessages messages={messages} />

          {/* Interactive Consent Ask Card */}
          {activeAsk && (
            <div className="mx-4 my-3 rounded-2xl border border-indigo-500/30 bg-slate-900/90 p-4 text-white shadow-xl backdrop-blur-md animate-in fade-in duration-200">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-indigo-500/20 p-2 text-indigo-400 shrink-0 mt-0.5">
                  <ShieldAlert size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                    Consent Required • Amount: £{activeAsk.amount_gbp}
                  </span>
                  <p className="mt-1 text-xs text-slate-200 leading-relaxed">
                    {activeAsk.summary}
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => void handleConsentDecision(true)}
                      disabled={isRespondingConsent}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition disabled:opacity-50"
                    >
                      {isRespondingConsent ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Approve & Claim (£{activeAsk.amount_gbp})
                    </button>
                    <button
                      onClick={() => void handleConsentDecision(false)}
                      disabled={isRespondingConsent}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
                    >
                      <X size={14} />
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Real-time Status Progress Indicator */}
          {(isProcessing || (latestEventStatus && !activeAsk)) && (
            <div className="mx-4 my-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-white backdrop-blur-md animate-in fade-in duration-200">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600/30">
                <span className="absolute h-full w-full animate-ping rounded-full bg-indigo-500/40 opacity-75" />
                <Loader2 size={18} className="animate-spin text-indigo-400" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold tracking-wider text-indigo-300 uppercase">
                  Processing Mission
                </span>
                <p className="text-xs text-nexus-silver animate-pulse">
                  {latestEventStatus || "Evaluating rules & consulting AI jurors..."}
                </p>
              </div>
            </div>
          )}
        </div>

        <ChatInput
          activeModels={activeModels}
          selectedModel={selectedModel}
          onSelectModel={onSelectModel}
          onSubmit={handleTaskSubmit}
          onSendAudio={onSendAudio}
          onMicPress={() => setVolume(0)}
          apiBaseUrl={apiBaseUrl}
          apiToken={apiToken}
          onSubmittingChange={setIsProcessing}
          isMissionRunning={isMissionRunning}
          onAbort={() => void handleStopMission()}
        />
      </section>
    </div>
  );
}