// The chat's conversations (shared by the sidebar and the chat page). One sidebar entry = one
// conversation with its own thread, pending ask, mission and the slots the chat door has
// understood so far (plan.md §4.1: the client echoes them back each turn). Track C2 owns this file.
// Conversations survive a reload (plan.md §12.3): they are kept in localStorage under
// `tempo.chat.v1`, at most 30 conversations of 100 messages each, without audio clips.
import { useSyncExternalStore } from "react";
import type { ChatNeed, ConsentAsk, CourtDecision, Finding, MissionState, MissionView, ChatSource, ChatStep } from "@/lib/api";
import type { ChatMessage } from "@/types/types";

/** One bubble, plus the things the person could say next (ChatReply.suggestions, plan.md §12.2). */
export interface ThreadMessage extends ChatMessage {
  suggestions?: string[];
  /** What a sweep of the connectors found (ChatReply.findings, plan.md §14.2). */
  findings?: Finding[];
  /** Where a looked-up answer came from, and what the brain did (plan.md §17). */
  sources?: ChatSource[];
  steps?: ChatStep[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: ThreadMessage[];
  /** The consent question waiting for this person's answer, if any. */
  ask: ConsentAsk | null;
  /** The Court's votes behind the ask (the Gateway puts them on the mission). */
  court: CourtDecision | null;
  /** The mission the consent UI and the kill switch talk to. */
  missionId: string | null;
  /** Every Gateway mission this conversation contains (for de-duping on sync). */
  missionIds: string[];
  /** Slots the chat door has understood so far; echoed back each turn. */
  slots: Record<string, string | null>;
  /** The one question the chat door is waiting on. */
  need: ChatNeed | null;
  /** The newest known state of `missionId`, for the kill switch. */
  missionState: MissionState | null;
  /** A quiet live line under the thread (state change, timer). */
  status: string | null;
  /** The honesty line ("simulated: company, rail data…") has been shown once. */
  simulatedShown: boolean;
}

export interface SpeechRequest {
  id: string;
  text: string;
}

interface State {
  conversations: Conversation[];
  activeId: string | null; // null = fresh, empty chat
  speech: SpeechRequest | null;
}

// The backend doesn't return what the user typed, so we remember it locally by mission id.
const INTENT_KEY = "tempo_mission_intents";
// Missions the user erased. The backend still lists them, so we hide them locally.
const DISMISSED_KEY = "tempo_dismissed_missions";
/** Where the conversations are kept between reloads. */
export const STORE_KEY = "tempo.chat.v1";
export const MAX_CONVERSATIONS = 30;
export const MAX_MESSAGES = 100;
const TERMINAL = new Set<MissionState>(["declined", "failed_safe", "verified", "completed"]);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function saveIntent(missionId: string, text: string): void {
  const all = loadJson<Record<string, string>>(INTENT_KEY, {});
  all[missionId] = text;
  saveJson(INTENT_KEY, all);
}

function blank(id: string, title: string): Conversation {
  return { id, title, messages: [], ask: null, court: null, missionId: null, missionIds: [], slots: {}, need: null, missionState: null, status: null, simulatedShown: false };
}

export function missionToConversation(m: MissionView, storedIntents: Record<string, string>): Conversation {
  const skill = m.skill_id ?? "";
  const userText =
    storedIntents[m.id] ||
    (skill.includes("rail") ? "My train was late. Can you claim for me?" : skill.includes("ofcom") ? "The engineer never came. What am I owed?" : `Mission ${m.id.slice(0, 8)}`);
  let agentText = `Mission status: ${m.state}`;
  if (m.ask) agentText = m.ask.summary || agentText;
  else if (m.message) agentText = m.message;
  return {
    ...blank(m.id, userText),
    messages: [
      { id: `${m.id}-user`, role: "user", text: userText },
      { id: `${m.id}-agent`, role: "agent", text: agentText, intent: skill.includes("ofcom") ? "missed_visit" : "rail_delay" },
    ],
    ask: m.ask ?? null,
    court: m.court ?? null,
    missionId: m.id,
    missionIds: [m.id],
    missionState: m.state,
    simulatedShown: true,
  };
}

/** What is written to storage: no audio (its blob URL dies with the page), no speech request. */
function storable(c: Conversation): Conversation {
  return {
    ...c,
    messages: c.messages.slice(-MAX_MESSAGES).map((m) => (m.audio ? { ...m, audio: undefined, text: m.text || "Voice message" } : m)),
  };
}

function persist(conversations: Conversation[], activeId: string | null): void {
  const kept = conversations.slice(0, MAX_CONVERSATIONS).map(storable);
  saveJson(STORE_KEY, { conversations: kept, activeId: kept.some((c) => c.id === activeId) ? activeId : null });
}

/** The conversations kept by an earlier page load, checked loosely (a bad entry is dropped, not fatal). */
function restore(): Pick<State, "conversations" | "activeId"> {
  const saved = loadJson<{ conversations?: unknown; activeId?: unknown }>(STORE_KEY, {});
  const list = Array.isArray(saved.conversations) ? saved.conversations : [];
  const conversations = list
    .filter((c): c is Conversation => Boolean(c) && typeof (c as Conversation).id === "string" && Array.isArray((c as Conversation).messages))
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({ ...blank(c.id, String(c.title ?? "")), ...c, missionIds: Array.isArray(c.missionIds) ? c.missionIds : [], messages: c.messages.slice(-MAX_MESSAGES) }));
  const activeId = typeof saved.activeId === "string" && conversations.some((c) => c.id === saved.activeId) ? saved.activeId : null;
  return { conversations, activeId };
}

let state: State = { ...restore(), speech: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  const before = state;
  state = { ...state, ...next };
  if (state.conversations !== before.conversations || state.activeId !== before.activeId) persist(state.conversations, state.activeId);
  for (const l of listeners) l();
}

// A prompt sent from elsewhere (the ⌘K palette): the chat takes it once it is on screen.
let queuedPrompt: string | null = null;
const promptListeners = new Set<() => void>();

/** Ask Tempo something from outside the chat: it starts a new conversation and sends `text`. */
export function queuePrompt(text: string): void {
  queuedPrompt = text;
  for (const l of promptListeners) l();
}

/** The chat takes the queued prompt (once), and hears about later ones. */
export function takeQueuedPrompt(): string | null {
  const text = queuedPrompt;
  queuedPrompt = null;
  return text;
}

export function onQueuedPrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

export const chatStore = {
  get: () => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setActive(id: string | null): void {
    set({ activeId: id });
  },
  setSpeech(speech: SpeechRequest | null): void {
    set({ speech });
  },
  newChat(): void {
    set({ activeId: null, speech: null });
  },
  find(id: string | null): Conversation | undefined {
    return id ? state.conversations.find((c) => c.id === id) : undefined;
  },
  findByMission(missionId: string): Conversation | undefined {
    return state.conversations.find((c) => c.missionIds.includes(missionId) || c.missionId === missionId);
  },
  /** The active conversation's id, starting a new one (newest first) when the chat is fresh. */
  ensureActive(title: string): string {
    if (state.activeId && state.conversations.some((c) => c.id === state.activeId)) return state.activeId;
    const id = crypto.randomUUID();
    set({ conversations: [blank(id, title), ...state.conversations], activeId: id });
    return id;
  },
  update(id: string, fn: (c: Conversation) => Conversation): void {
    set({ conversations: state.conversations.map((c) => (c.id === id ? fn(c) : c)) });
  },
  updateActive(fn: (c: Conversation) => Conversation): void {
    if (state.activeId) this.update(state.activeId, fn);
  },
  /** Append messages to one conversation and patch its fields. */
  appendTo(id: string, newMessages: ThreadMessage[], patch: Partial<Omit<Conversation, "id" | "messages">> = {}): void {
    this.update(id, (c) => ({
      ...c,
      ...patch,
      messages: [...c.messages, ...newMessages],
      missionIds: patch.missionId && !c.missionIds.includes(patch.missionId) ? [...c.missionIds, patch.missionId] : (patch.missionIds ?? c.missionIds),
    }));
  },
  /**
   * Add missions from the Gateway that the sidebar does not have yet (newest first), and bring
   * the conversations that already hold a mission up to date (a reload may have missed a change).
   */
  syncMissions(missions: MissionView[]): Conversation[] {
    const storedIntents = loadJson<Record<string, string>>(INTENT_KEY, {});
    const dismissed = new Set(loadJson<string[]>(DISMISSED_KEY, []));
    const known = new Set(state.conversations.flatMap((c) => c.missionIds));
    const byId = new Map(missions.map((m) => [m.id, m]));
    let changed = false;
    const refreshed = state.conversations.map((c) => {
      if (!c.missionId) return c;
      const m = byId.get(c.missionId);
      if (!m) {
        // Kept from an earlier load, but this Gateway has no such mission (a fresh demo, the
        // showcase's new recordings): nothing is waiting and nothing can be stopped.
        if (!c.ask && !c.status && (!c.missionState || TERMINAL.has(c.missionState))) return c;
        changed = true;
        return { ...c, ask: null, status: null, missionState: c.missionState && TERMINAL.has(c.missionState) ? c.missionState : null };
      }
      if (m.state === c.missionState && (m.ask?.request_id ?? null) === (c.ask?.request_id ?? null)) return c;
      changed = true;
      return { ...c, missionState: m.state, ask: m.ask ?? null, court: m.court ?? c.court };
    });
    const incoming = missions.filter((m) => !known.has(m.id) && !dismissed.has(m.id)).map((m) => missionToConversation(m, storedIntents));
    if (incoming.length > 0 || changed) set({ conversations: [...refreshed, ...incoming] });
    return incoming;
  },
  /** Append messages to the active conversation, or start a new one if the chat is fresh (the older API). */
  append(title: string, newMessages: ChatMessage[], patch: Partial<Pick<Conversation, "ask" | "missionId" | "slots">> = {}, newMissionId?: string, ownerId?: string): string {
    const targetId = ownerId ?? this.ensureActive(title);
    this.appendTo(targetId, newMessages, { ...patch, ...(newMissionId ? { missionId: patch.missionId ?? newMissionId } : {}) });
    if (!ownerId) set({ activeId: targetId });
    return targetId;
  },
  selectIndex(index: number): Conversation | undefined {
    const target = state.conversations[index];
    if (target) set({ activeId: target.id });
    return target;
  },
  /** "Erase all": hide every mission locally (the Gateway still lists them) and clear the sidebar. */
  eraseAll(extraMissionIds: string[] = []): void {
    const dismissed = new Set(loadJson<string[]>(DISMISSED_KEY, []));
    state.conversations.forEach((c) => c.missionIds.forEach((id) => dismissed.add(id)));
    extraMissionIds.forEach((id) => dismissed.add(id));
    saveJson(DISMISSED_KEY, [...dismissed]);
    try {
      localStorage.removeItem(INTENT_KEY);
    } catch {
      /* ignore */
    }
    set({ conversations: [], activeId: null, speech: null });
  },
  /** For tests and the showcase switch. */
  reset(): void {
    set({ conversations: [], activeId: null, speech: null });
  },
  /** Read the kept conversations again, as a fresh page load does (for tests). */
  reload(): void {
    state = { ...restore(), speech: null };
    for (const l of listeners) l();
  },
};

export function useChatStore(): State {
  return useSyncExternalStore(chatStore.subscribe, chatStore.get, chatStore.get);
}
