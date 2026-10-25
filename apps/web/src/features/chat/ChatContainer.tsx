// The chat door (plan.md §2, §4.1): free text goes to `gateway.chat()`, replies become messages,
// the one pending question keeps the conversation waiting, consent is answered inline, live
// Gateway events (from App's one socket) update the thread, the camera reads a letter.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { duration, plainError, shortDateTime } from "@/components/mission";
import type { Recording } from "@/hooks/useAudioRecorder";
import type { ChatReply, Intent, MissionState, MissionView } from "@/lib/api";
import { CatalogClient } from "@/lib/catalog-client";
import type { GatewayConfig } from "@/lib/config";
import { STATE_LABELS } from "@/lib/labels";
import type { LetterReading } from "@/lib/letters";
import type { LiveEvent } from "@/lib/live";
import { ShieldClient, type ShieldVerdict, ShowcaseShield } from "@/lib/shield";
import { ShowcaseCatalog } from "@/lib/showcase";
import type { PageProps } from "@/types/page";
import type { ChatMessage, ModelProvider } from "@/types/types";
import { ChatPage } from "./ChatPage";
import { type Conversation, chatStore, saveIntent, useChatStore } from "./store";

export interface ChatContainerProps extends PageProps {
  config: GatewayConfig;
  activeModels: ModelProvider[];
  selectedModel: ModelProvider;
  onSelectModel: (m: ModelProvider) => void;
  elevenLabsKey?: string;
}

const TERMINAL = new Set<MissionState>(["declined", "failed_safe", "verified", "completed"]);

function uid(): string {
  return crypto.randomUUID();
}

function title(text: string): string {
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(file);
  });
}

export default function ChatContainer({ gateway, user, showcase, health, connected, events, language, speak, config, activeModels, selectedModel, onSelectModel, elevenLabsKey }: ChatContainerProps) {
  const { conversations, activeId, speech } = useChatStore();
  const active = conversations.find((c) => c.id === activeId) ?? null;
  const [busy, setBusy] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);

  // Clients for the two doors the chat uses directly (plan.md §4.1: the camera posts to /letters/read).
  const catalog = useMemo(() => (showcase ? new ShowcaseCatalog() : new CatalogClient(config)), [showcase, config]);
  const shield = useMemo(() => (showcase ? new ShowcaseShield() : new ShieldClient(config)), [showcase, config]);

  useEffect(() => {
    let live = true;
    void gateway.ttsConfigured().then((ok) => live && setTtsAvailable(ok));
    return () => {
      live = false;
    };
  }, [gateway]);

  // Missions already on the Gateway appear in the sidebar's history (never auto-opened: the front door stays the welcome card).
  useEffect(() => {
    let live = true;
    gateway
      .missions()
      .then((missions) => live && chatStore.syncMissions(missions.filter((m) => !m.user_id || m.user_id === user.id)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [gateway, user.id]);

  const say = useCallback(
    (text: string | null | undefined) => {
      if (text && text.trim()) speak(text);
    },
    [speak],
  );

  /** Turn a chat reply into the agent's message and patch the conversation (plan.md §4.1). */
  const applyReply = useCallback(
    (convId: string, userText: string, reply: ChatReply) => {
      const conv = chatStore.find(convId);
      if (!conv) return;
      const question = reply.needs?.[0]?.question;
      let text = reply.reply?.trim() || question || STATE_LABELS[reply.mission?.state ?? "received"];
      if (question && !text.includes(question)) text = `${text} ${question}`;
      const firstAgent = !conv.simulatedShown && !conv.messages.some((m) => m.role === "agent");
      const message: ChatMessage = {
        id: uid(),
        role: "agent",
        text,
        intent: reply.intent,
        verdict: (reply.verdict as unknown as ShieldVerdict | null) ?? undefined,
        memories: (reply.memories as unknown as ChatMessage["memories"]) ?? undefined,
        ledger: reply.ledger ?? undefined,
        flags: reply.flags ?? undefined,
        actions: reply.actions ?? undefined,
        simulated: firstAgent && reply.simulated?.length ? reply.simulated : undefined,
        timestamp: Date.now(),
      };
      // The server merges what we echoed with what this turn said and sends the result back
      // (empty once a mission has started), so its slots replace ours.
      const patch: Partial<Omit<Conversation, "id" | "messages">> = {
        slots: reply.slots ?? {},
        need: reply.needs?.[0] ?? null,
        simulatedShown: conv.simulatedShown || firstAgent,
      };
      if (reply.mission) {
        patch.missionId = reply.mission.id;
        patch.missionState = reply.mission.state;
        patch.ask = reply.ask ?? reply.mission.ask ?? null;
        patch.court = reply.mission.court ?? null;
        patch.status = null;
        if (reply.intent === "rail_delay" || reply.intent === "missed_visit") saveIntent(reply.mission.id, userText);
      } else if (reply.ask) {
        patch.ask = reply.ask;
      }
      if (reply.intent === "stop") {
        patch.ask = null;
        patch.status = null;
        patch.missionState = conv.missionState && !TERMINAL.has(conv.missionState) ? "failed_safe" : conv.missionState;
      }
      if ((reply.intent === "approve" || reply.intent === "decline") && !reply.mission) patch.ask = null;
      chatStore.appendTo(convId, [message], patch);
      say(reply.say || reply.reply);
    },
    [say],
  );

  const send = useCallback(
    async (text: string) => {
      const convId = chatStore.ensureActive(title(text));
      const conv = chatStore.find(convId)!;
      chatStore.appendTo(convId, [{ id: uid(), role: "user", text, timestamp: Date.now() }]);
      setBusy(true);
      try {
        const reply = await gateway.chat({
          user_id: user.id,
          display_name: user.name,
          text,
          profile_id: user.profileId,
          language,
          slots: conv.slots,
        });
        applyReply(convId, text, reply);
      } catch (err) {
        throw new Error(plainError(err));
      } finally {
        setBusy(false);
      }
    },
    [applyReply, gateway, language, user.id, user.name, user.profileId],
  );

  const consent = useCallback(
    async (approved: boolean) => {
      const conv = chatStore.find(chatStore.get().activeId);
      if (!conv?.ask) return;
      const convId = conv.id;
      setBusy(true);
      try {
        if (approved) {
          const view: MissionView = await gateway.answer(conv.ask.request_id, true);
          const text = view.message ?? `${STATE_LABELS[view.state]}.`;
          chatStore.appendTo(convId, [{ id: uid(), role: "agent", text, intent: "approve", timestamp: Date.now() }], {
            ask: view.ask ?? null,
            missionId: view.id,
            missionState: view.state,
            status: view.state === "waiting" ? "Waiting for the money." : null,
          });
          say(text);
        } else {
          if (conv.missionId) await gateway.stop(conv.missionId);
          const text = "Stopped: you declined.";
          chatStore.appendTo(convId, [{ id: uid(), role: "agent", text, intent: "decline", timestamp: Date.now() }], { ask: null, missionState: "declined", status: null });
          say(text);
        }
      } catch (err) {
        const text = plainError(err);
        chatStore.appendTo(convId, [{ id: uid(), role: "agent", text, timestamp: Date.now() }], { ask: /404/.test(String(err)) ? null : conv.ask });
      } finally {
        setBusy(false);
      }
    },
    [gateway, say],
  );

  const stop = useCallback(async () => {
    const conv = chatStore.find(chatStore.get().activeId);
    if (!conv?.missionId) return;
    setBusy(true);
    try {
      const view = await gateway.stop(conv.missionId);
      const text = "Stopped: you asked me to stop. Nothing more will be sent.";
      chatStore.appendTo(conv.id, [{ id: uid(), role: "agent", text, intent: "stop", timestamp: Date.now() }], { ask: null, missionState: view.state, status: null });
      say(text);
    } catch (err) {
      throw new Error(plainError(err));
    } finally {
      setBusy(false);
    }
  }, [gateway, say]);

  const sendAudio = useCallback(
    (clip: Recording) => {
      const convId = chatStore.ensureActive("Voice message");
      const text = "Your browser can't turn speech into text; type what you said.";
      chatStore.appendTo(convId, [
        { id: uid(), role: "user", text: "Voice message", audio: { url: clip.url, durationMs: clip.durationMs }, timestamp: Date.now() },
        { id: uid(), role: "agent", text, timestamp: Date.now() },
      ]);
      say(text);
    },
    [say],
  );

  const readLetter = useCallback(
    async (file: File) => {
      const convId = chatStore.ensureActive("Read this letter");
      chatStore.appendTo(convId, [{ id: uid(), role: "user", text: `Photo of a letter: ${file.name}`, timestamp: Date.now() }]);
      setBusy(true);
      try {
        let reading: LetterReading;
        let lead: string;
        if (showcase) {
          // No Gateway to read a new photo: the recorded reading of a sample letter stands in, and says so.
          const samples = await catalog.sampleLetters();
          const sample = samples[0];
          if (!sample) throw new Error("There are no recorded letters in the showcase.");
          reading = sample.reading;
          lead = "There's no Gateway in the showcase, so I can't read your photo. Here is a recorded reading of a sample letter instead.";
        } else {
          reading = await catalog.readLetter({ image_b64: await fileToBase64(file), filename: file.name, user_id: user.id, display_name: user.name, language });
          lead = reading.says;
        }
        chatStore.appendTo(convId, [{ id: uid(), role: "agent", text: lead, intent: "letter", letter: reading, actions: [{ label: "Open Read It To Me", href: "#/read" }], timestamp: Date.now() }]);
        say(reading.reading_text);
      } catch (err) {
        throw new Error(plainError(err));
      } finally {
        setBusy(false);
      }
    },
    [catalog, language, say, showcase, user.id, user.name],
  );

  const feedback = useCallback((alertId: string, label: "scam" | "real") => shield.feedback(alertId, label), [shield]);

  // Live events from App's socket (newest first). Older events are primed as seen so a reload does not replay them.
  const seen = useRef(new WeakSet<LiveEvent>());
  const primed = useRef(false);
  useEffect(() => {
    if (!primed.current) {
      events.forEach((e) => seen.current.add(e));
      primed.current = true;
      return;
    }
    const fresh = events.filter((e) => !seen.current.has(e)).reverse();
    for (const e of fresh) {
      seen.current.add(e);
      const missionId = typeof e.mission_id === "string" ? e.mission_id : null;
      const conv = missionId ? chatStore.findByMission(missionId) : undefined;
      const isActive = conv && conv.id === chatStore.get().activeId;
      switch (e.type) {
        case "state_changed": {
          if (!conv) break;
          const to = String(e.to) as MissionState;
          const latency = typeof e.latency_ms === "number" && e.latency_ms > 0 ? ` · ${duration(e.latency_ms)}` : "";
          chatStore.update(conv.id, (c) => ({ ...c, missionState: to, status: `${STATE_LABELS[to] ?? to}${latency}` }));
          break;
        }
        case "outcome": {
          if (!conv) break;
          const text = typeof e.message === "string" && e.message ? e.message : STATE_LABELS.verified;
          chatStore.appendTo(conv.id, [{ id: uid(), role: "agent", text, intent: "ledger" as Intent, timestamp: Date.now() }], { ask: null, status: null, missionState: (String(e.state) as MissionState) || "verified" });
          if (isActive) say(text);
          break;
        }
        case "timer_set": {
          if (!conv) break;
          const at = typeof e.wake_at === "string" ? shortDateTime(e.wake_at) : "later";
          chatStore.update(conv.id, (c) => ({ ...c, status: `Waiting for the money; checking at ${at}.` }));
          break;
        }
        case "consent_requested": {
          if (!conv || conv.ask) break;
          void gateway
            .mission(missionId!)
            .then((view) => chatStore.update(conv.id, (c) => ({ ...c, ask: view.ask, court: view.court, missionState: view.state })))
            .catch(() => undefined);
          break;
        }
        case "scam_alert": {
          if (e.user_id && e.user_id !== user.id) break;
          const text = "I held a text that looks like a trick. Don't tap anything in it; I'll tell you what I found.";
          const convId = chatStore.ensureActive("A text Tempo held");
          chatStore.appendTo(convId, [{ id: uid(), role: "agent", text, intent: "scam_check", actions: [{ label: "Open Scam Shield", href: "#/shield" }], timestamp: Date.now() }]);
          say(text);
          break;
        }
        default:
          break; // ledger and the rest change nothing in the chat
      }
    }
  }, [events, gateway, say, user.id]);

  return (
    <ChatPage
      user={user}
      language={language}
      showcase={showcase}
      online={connected || health !== null}
      gateway={gateway}
      ttsAvailable={ttsAvailable}
      activeModels={activeModels}
      selectedModel={selectedModel}
      onSelectModel={onSelectModel}
      conversation={active}
      busy={busy}
      onSend={send}
      onSendAudio={sendAudio}
      onReadLetter={readLetter}
      onConsent={consent}
      onStop={stop}
      onFeedback={feedback}
      onSpeak={say}
      speech={speech}
      elevenLabsKey={elevenLabsKey}
    />
  );
}
