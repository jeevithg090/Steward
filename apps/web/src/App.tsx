import { useState, useEffect, useCallback } from "react";
import type { SetStateAction } from "react";
import { AppShell } from "./components/layout/AppShell";
import { ChatPage } from "./features/chat/ChatPage";
import { MemoryPage } from "./features/memory/MemoryPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import type { ApiKeyProvider, ApiKeys, ChatMessage, ConsentAsk, ModelProvider, View } from "./types/types";
import type { Recording } from "./hooks/useAudioRecorder";

const MODEL_LABELS: Record<ModelProvider, string> = {
  local: "Local Model (Primary • Ollama)",
  gemini: "Gemini Pro",
  claude: "Claude 3.5 Sonnet",
  openai: "GPT-4o",
};

interface BackendMission {
  id: string;
  state: string;
  user_id: string;
  intent?: string;
  ask?: ConsentAsk | null;
  message?: string | null;
  summary?: string | null;
  origin_crs?: string;
  destination_crs?: string;
  fare_gbp?: string;
}

// One sidebar entry = one conversation with its own thread, pending ask and mission.
interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  ask: ConsentAsk | null;
  missionId: string | null; // mission the consent UI currently talks to
  missionIds: string[]; // every backend mission this conversation contains (for de-duping on sync)
}

const EMPTY_MESSAGES: ChatMessage[] = [];

// The backend doesn't return what the user typed (no `intent`), so we remember it locally by mission id.
const INTENT_KEY = "tempo_mission_intents";

function loadIntents(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(INTENT_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveIntent(missionId: string, text: string) {
  try {
    const all = loadIntents();
    all[missionId] = text;
    localStorage.setItem(INTENT_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable, fall back to generic label */
  }
}

// Missions the user erased. The backend still lists them, so we hide them locally.
const DISMISSED_KEY = "tempo_dismissed_missions";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable */
  }
}

function missionToConversation(m: BackendMission, storedIntents: Record<string, string>): Conversation {
  const userText =
    m.intent ||
    storedIntents[m.id] ||
    (m.origin_crs && m.destination_crs
      ? `Claim Delay Repay for ${m.origin_crs} → ${m.destination_crs} (£${m.fare_gbp || "28.40"})`
      : `Mission ${m.id.slice(0, 8)}`);

  let agentText = `Mission status: ${m.state}`;
  if (m.ask) {
    agentText = m.ask.summary || agentText;
  } else if (m.message) {
    agentText = m.message;
  } else if (m.summary) {
    agentText = m.summary;
  }

  return {
    id: m.id,
    title: userText,
    messages: [
      { id: `${m.id}-user`, role: "user", text: userText },
      { id: `${m.id}-agent`, role: "agent", text: agentText },
    ],
    ask: m.ask ?? null,
    missionId: m.id,
    missionIds: [m.id],
  };
}

interface AppProps {
  apiBaseUrl?: string;
  apiToken?: string;
}

export default function App({ apiBaseUrl = "http://127.0.0.1:8000", apiToken = "devtoken" }: AppProps) {
  const [view, setView] = useState<View>("chat");

  const [activeModels, setActiveModels] = useState<ModelProvider[]>(["local"]);
  const [selectedModel, setSelectedModel] = useState<ModelProvider>("local");

  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    claude: "",
    openai: "",
  });

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); // null = fresh, empty chat

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConversation?.messages ?? EMPTY_MESSAGES;
  const activeAsk = activeConversation?.ask ?? null;
  const activeMissionId = activeConversation?.missionId ?? null;
  const history = conversations.map((c) => c.title); // same order as `conversations`

  const updateActive = (fn: (c: Conversation) => Conversation) => {
    setConversations((prev) => prev.map((c) => (c.id === activeId ? fn(c) : c)));
  };

  // Same call signature as a useState setter, so ChatPage can use it unchanged.
  const setActiveAsk = (value: SetStateAction<ConsentAsk | null>) => {
    updateActive((c) => ({ ...c, ask: typeof value === "function" ? value(c.ask) : value }));
  };

  const setActiveMissionId = (value: SetStateAction<string | null>) => {
    updateActive((c) => ({ ...c, missionId: typeof value === "function" ? value(c.missionId) : value }));
  };

  // Load missions from the Gateway into the sidebar (adds only ones we don't already have).
  const fetchBackendMissions = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/missions?user_id=u_margaret`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) return;

      const missions: BackendMission[] = await res.json();
      if (!missions || missions.length === 0) return;

      const storedIntents = loadIntents();
      const dismissed = loadDismissed();

      setConversations((prev) => {
        const known = new Set(prev.flatMap((c) => c.missionIds));
        const incoming = missions
          .filter((m) => !known.has(m.id) && !dismissed.has(m.id)).map((m) => missionToConversation(m, storedIntents));
        return incoming.length > 0 ? [...prev, ...incoming] : prev;
      });
    } catch (err) {
      console.error("Failed to sync missions with backend:", err);
    }
  }, [apiBaseUrl, apiToken]);

  useEffect(() => {
    void fetchBackendMissions();
  }, [fetchBackendMissions]);

  const handleToggleActiveModel = (model: ModelProvider, active: boolean) => {
    setActiveModels((prev) => {
      if (active) {
        if (!prev.includes(model)) return [...prev, model];
        return prev;
      } else {
        const next = prev.filter((m) => m !== model);
        const updated: ModelProvider[] = next.length > 0 ? next : ["local"];
        if (!updated.includes(selectedModel)) {
          setSelectedModel(updated[0]);
        }
        return updated;
      }
    });
  };

  const handleUpdateApiKey = (provider: ApiKeyProvider, key: string) => {
    setApiKeys((prev) => ({ ...prev, [provider]: key }));
  };

  // Append messages to the active conversation, or start a new one if the chat is fresh.
  const appendToChat = (
    title: string,
    newMessages: ChatMessage[],
    patch: Partial<Pick<Conversation, "ask" | "missionId">> = {},
    newMissionId?: string,
  ) => {
    const targetId = activeId ?? crypto.randomUUID();
    setActiveId(targetId);

    setConversations((prev) => {
      const exists = prev.some((c) => c.id === targetId);
      if (!exists) {
        const created: Conversation = {
          id: targetId,
          title,
          messages: newMessages,
          ask: patch.ask ?? null,
          missionId: patch.missionId ?? null,
          missionIds: newMissionId ? [newMissionId] : [],
        };
        return [created, ...prev]; // newest first
      }
      return prev.map((c) =>
        c.id === targetId
          ? {
              ...c,
              ...patch,
              messages: [...c.messages, ...newMessages],
              missionIds: newMissionId && !c.missionIds.includes(newMissionId) ? [...c.missionIds, newMissionId] : c.missionIds,
            }
          : c,
      );
    });
  };

  const handleSendMessage = (task: string, responseData?: unknown) => {
    const cleanTask = task.trim();

    // Parse reply text from Gateway response
    let replyText = `Processed on ${MODEL_LABELS[selectedModel]}`;
    const patch: Partial<Pick<Conversation, "ask" | "missionId">> = {};
    let missionId: string | undefined;

    if (responseData && typeof responseData === "object") {
      const mission = responseData as BackendMission;
      if (mission.id) {
        missionId = mission.id;
        patch.missionId = mission.id;
        if (cleanTask) saveIntent(mission.id, cleanTask);
      }
      if (mission.ask) {
        patch.ask = mission.ask;
        replyText = mission.ask.summary || replyText;
      } else {
        patch.ask = null;
        if (mission.message) replyText = mission.message;
      }
    }

    const newMessages: ChatMessage[] = [];
    if (cleanTask) {
      newMessages.push({ id: crypto.randomUUID(), role: "user", text: cleanTask });
    }
    newMessages.push({ id: crypto.randomUUID(), role: "agent", text: replyText });

    appendToChat(cleanTask || replyText.slice(0, 40), newMessages, patch, missionId);
  };

  const handleSendAudio = (clip: Recording) => {
    const audioTitle = "Voice message";

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: audioTitle,
      audio: { url: clip.url, durationMs: clip.durationMs },
      timestamp: Date.now(),
    };

    const agentMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "agent",
      text: `Voice message processed on ${MODEL_LABELS[selectedModel]}.`,
    };

    appendToChat(audioTitle, [userMessage, agentMessage]);
  };

  // New chat just deselects the current conversation. Nothing is deleted.
  const handleNewChat = () => {
    setActiveId(null);
    setView("chat");
  };

  // Called by the Memory page's "Erase all data": clears every chat from the sidebar.
  const handleEraseAllChats = async () => {
    const dismissed = loadDismissed();
    conversations.forEach((c) => c.missionIds.forEach((id) => dismissed.add(id)));

    // Also hide missions that exist on the backend but haven't been loaded into the sidebar yet.
    try {
      const res = await fetch(`${apiBaseUrl}/missions?user_id=u_margaret`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (res.ok) {
        const missions: BackendMission[] = await res.json();
        missions.forEach((m) => dismissed.add(m.id));
      }
    } catch {
      /* offline: only the already-loaded missions are hidden */
    }

    saveDismissed(dismissed);
    try {
      localStorage.removeItem(INTENT_KEY);
    } catch {
      /* ignore */
    }
    setConversations([]);
    setActiveId(null);
  };

  // `selected` is the sidebar item's index (or its title). AppShell must pass one of them.
  const handleSelectChat = (selected?: number | string) => {
    let target: Conversation | undefined;
    if (typeof selected === "number") target = conversations[selected];
    else if (typeof selected === "string") target = conversations.find((c) => c.title === selected);

    if (target) setActiveId(target.id);
    setView("chat");
    void fetchBackendMissions();
  };

  return (
    <AppShell
      view={view}
      onNavigate={setView}
      onNewChat={handleNewChat}
      onSelectChat={handleSelectChat}
      history={history}
    >
      {view === "chat" && (
        <ChatPage
          activeModels={activeModels}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          messages={messages}
          activeAsk={activeAsk}
          setActiveAsk={setActiveAsk}
          activeMissionId={activeMissionId}
          setActiveMissionId={setActiveMissionId}
          onSendMessage={handleSendMessage}
          onSendAudio={handleSendAudio}
          apiBaseUrl={apiBaseUrl}
          apiToken={apiToken}
        />
      )}
      {view === "memory" && (
        <MemoryPage apiBaseUrl={apiBaseUrl} apiToken={apiToken} onEraseAll={handleEraseAllChats} />
      )}
      {view === "settings" && (
        <SettingsPage
          activeModels={activeModels}
          onToggleActiveModel={handleToggleActiveModel}
          apiKeys={apiKeys}
          onUpdateApiKey={handleUpdateApiKey}
        />
      )}
    </AppShell>
  );
}