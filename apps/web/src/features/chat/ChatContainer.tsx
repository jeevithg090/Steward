// The chat door (plan.md §2, §4.1, §12.2): free text goes to `gateway.chat()`, replies become
// messages (with suggestion chips), the one pending question keeps the conversation waiting,
// consent is answered inline through `answerAsk` (a passkey when this device has one), live
// Gateway events (from App's one socket) update the thread, the camera reads a letter, and
// `#/chat?say=<text>` sends a sentence once, as if typed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { afterYes, duration, isUnreachable, plainError, rememberAmount, rememberAsks, shortDateTime, toastError } from "@/components/mission";
import { toast } from "@/components/ui";
import type { Recording } from "@/hooks/useAudioRecorder";
import type { ChatReply, Health, Intent, MissionState } from "@/lib/api";
import { answerAsk } from "@/lib/approve";
import { CatalogClient } from "@/lib/catalog-client";
import type { GatewayConfig } from "@/lib/config";
import { STATE_LABELS } from "@/lib/labels";
import type { LetterReading } from "@/lib/letters";
import type { LiveEvent } from "@/lib/live";
import { useMesh } from "@/lib/mesh-context";
import { ShieldClient, type ShieldVerdict, ShowcaseShield } from "@/lib/shield";
import { ShowcaseCatalog } from "@/lib/showcase";
import { SUGGESTIONS } from "@/lib/showcase-chat";
import { useRoute } from "@/router";
import type { PageProps } from "@/types/page";
import type { ModelProvider } from "@/types/types";
import { ChatPage, type Link } from "./ChatPage";
import { type Conversation, type ThreadMessage, chatStore, onQueuedPrompt, saveIntent, takeQueuedPrompt, useChatStore } from "./store";

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

/** The `say` of `#/chat?say=…` in the address bar right now (read live, so StrictMode's second run finds it gone). */
function sayInHash(): string | null {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const at = hash.indexOf("?");
  return at < 0 ? null : new URLSearchParams(hash.slice(at + 1)).get("say");
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(file);
  });
}

/** What the chat names as its model: the Gateway's own, in short words (null in the showcase, or
 * from a Gateway too old to say, where the picker stays). */
export function gatewayModelWords(health: Health | null): string | null {
  const model = health?.model;
  if (!model) return null;
  if (model.kind === "runpod-vllm") return "our model, RunPod GPU";
  return model.processor || model.name || null;
}

/** How many earlier lines go with each turn: enough for the brain to follow (plan.md §16). */
const HISTORY_LINES = 16;

export default function ChatContainer({ gateway, user, showcase, health, connected, events, language, speak, config, activeModels, selectedModel, onSelectModel, elevenLabsKey }: ChatContainerProps) {
  const { conversations, activeId, speech } = useChatStore();
  const active = conversations.find((c) => c.id === activeId) ?? null;
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const { mesh, signs } = useMesh();
  const route = useRoute();
  const link: Link = showcase ? "showcase" : connected ? "live" : health ? "gateway" : "offline";

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
      .then((missions) => {
        if (!live) return;
        rememberAsks(missions);
        chatStore.syncMissions(missions.filter((m) => !m.user_id || m.user_id === user.id));
      })
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
      const message: ThreadMessage = {
        id: uid(),
        role: "agent",
        text,
        intent: reply.intent,
        verdict: (reply.verdict as unknown as ShieldVerdict | null) ?? undefined,
        memories: (reply.memories as unknown as ThreadMessage["memories"]) ?? undefined,
        ledger: reply.ledger ?? undefined,
        flags: reply.flags ?? undefined,
        findings: reply.findings?.length ? reply.findings : undefined,
        sources: reply.sources?.length ? reply.sources : undefined,
        steps: reply.steps?.length ? reply.steps : undefined,
        actions: reply.actions ?? undefined,
        simulated: firstAgent && reply.simulated?.length ? reply.simulated : undefined,
        suggestions: reply.suggestions?.length ? reply.suggestions.slice(0, 4) : undefined,
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
        rememberAmount(reply.mission.id, (reply.ask ?? reply.mission.ask)?.amount_gbp);
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
      // A typed yes/no that the Gateway answered clears the ask; one it sends back (this person
      // confirms with a passkey, plan.md §12.2) stays on screen for the signed Yes.
      if ((reply.intent === "approve" || reply.intent === "decline") && !reply.mission && !reply.ask) patch.ask = null;
      chatStore.appendTo(convId, [message], patch);
      say(reply.say || reply.reply);
      if (reply.mission && (reply.intent === "approve" || reply.intent === "decline")) {
        if (reply.ask) toast.info(signs ? "Press Yes below to confirm with Face ID." : "Confirm on the device that has your Face ID or fingerprint.");
        else if (reply.intent === "approve") {
          const words = afterYes(reply.mission);
          toast[words.tone](words.text);
        } else toast.info("You said no. Nothing was sent.");
      }
      if (reply.intent === "stop" && reply.mission) toast.info("Stopped. Nothing more will be sent.");
    },
    [say, signs],
  );

  const send = useCallback(
    async (text: string) => {
      const convId = chatStore.ensureActive(title(text));
      const conv = chatStore.find(convId)!;
      // The last lines of this conversation, for the brain's context (before this one is added).
      const history = conv.messages
        .filter((m) => (m.role === "user" || m.role === "agent") && m.text.trim())
        .slice(-HISTORY_LINES)
        .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("tempo" as const), text: m.text.slice(0, 1500) }));
      chatStore.appendTo(convId, [{ id: uid(), role: "user", text, timestamp: Date.now() }]);
      setBusy(true);
      setThinking(true);
      try {
        const reply = await gateway.chat({
          user_id: user.id,
          display_name: user.name,
          text,
          profile_id: user.profileId,
          language,
          slots: conv.slots,
          history,
        });
        applyReply(convId, text, reply);
      } catch (err) {
        // The line by the input says it; a Gateway that does not answer also gets a way to Settings.
        if (isUnreachable(err)) toastError(err);
        throw new Error(plainError(err));
      } finally {
        setBusy(false);
        setThinking(false);
      }
    },
    [applyReply, gateway, language, user.id, user.name, user.profileId],
  );

  // A prompt from the ⌘K palette: a fresh conversation, then the words as if typed.
  useEffect(() => {
    const take = () => {
      const text = takeQueuedPrompt();
      if (!text) return;
      chatStore.newChat();
      void send(text).catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
    };
    take();
    return onQueuedPrompt(take);
  }, [send]);

  /** The consent card's Yes or No: the one way the web answers (answerAsk: a passkey here when this device signs). */
  const consent = useCallback(
    async (approved: boolean) => {
      const conv = chatStore.find(chatStore.get().activeId);
      if (!conv?.ask) return;
      const convId = conv.id;
      setBusy(true);
      try {
        const view = await answerAsk({ gateway, mesh, signs }, conv.ask.request_id, approved);
        const text = view.message ?? (approved ? `${STATE_LABELS[view.state]}.` : "Stopped: you said no. Nothing was sent.");
        const paid = view.state === "verified";
        chatStore.appendTo(
          convId,
          [{ id: uid(), role: "agent", text, intent: approved ? "approve" : "decline", timestamp: Date.now(), ...(paid ? { suggestions: [...SUGGESTIONS.paid] } : {}) }],
          {
            ask: view.ask ?? null,
            missionId: view.id,
            missionState: view.state,
            status: view.state === "waiting" ? "Waiting for the money." : null,
          },
        );
        say(text);
        if (approved) {
          const words = afterYes(view);
          toast[words.tone](words.text);
        } else toast.info("You said no. Nothing was sent.");
      } catch (err) {
        const text = toastError(err);
        chatStore.appendTo(convId, [{ id: uid(), role: "agent", text, timestamp: Date.now() }], { ask: /404/.test(String(err)) ? null : conv.ask });
      } finally {
        setBusy(false);
      }
    },
    [gateway, mesh, say, signs],
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
      toast.info("Stopped. Nothing more will be sent.");
    } catch (err) {
      if (isUnreachable(err)) toastError(err);
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
        toast.success(showcase ? "Here is a recorded reading of a sample letter." : "Letter read. Tempo will read it to you.");
      } catch (err) {
        if (isUnreachable(err)) toastError(err);
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
          const state = (String(e.state) as MissionState) || "verified";
          const paid = state === "verified";
          chatStore.appendTo(conv.id, [{ id: uid(), role: "agent", text, intent: "ledger" as Intent, timestamp: Date.now(), ...(paid ? { suggestions: [...SUGGESTIONS.paid] } : {}) }], { ask: null, status: null, missionState: state });
          if (isActive) say(text);
          if (paid) toast.success(typeof e.amount_gbp === "string" ? `Money arrived: £${e.amount_gbp}.` : "Money arrived.");
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
            .then((view) => {
              rememberAsks([view]);
              chatStore.update(conv.id, (c) => ({ ...c, ask: view.ask, court: view.court, missionState: view.state }));
            })
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

  // `#/chat?say=<text>` (plan.md §12.2): a fresh conversation, the text sent once, then the address
  // goes back to `#/chat` without a history entry, so Back does not send it again. The live hash is
  // the guard: React StrictMode's second effect run finds it already cleared.
  // Every hash change makes a new `route`, so the same sentence twice in a row is sent twice.
  useEffect(() => {
    const text = sayInHash()?.trim();
    if (!route.query.get("say") || !text) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/chat`);
    chatStore.newChat();
    void send(text).catch(() => undefined); // the conversation shows the error line; nothing else to do here
  }, [route, send]);

  return (
    <ChatPage
      user={user}
      language={language}
      showcase={showcase}
      link={link}
      gateway={gateway}
      ttsAvailable={ttsAvailable}
      activeModels={activeModels}
      selectedModel={selectedModel}
      onSelectModel={onSelectModel}
      gatewayModel={gatewayModelWords(showcase ? null : health)}
      conversation={active}
      busy={busy}
      thinking={thinking}
      signs={signs}
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
