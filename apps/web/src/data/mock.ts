import type { ChatMessage, MemoryNode } from "../types/types";

export const INITIAL_HISTORY = [
  "Plan weekly schedule",
  "Summarize research notes",
  "Draft outreach emails",
];

export const MEMORY_NODES: MemoryNode[] = [
  {
    id: "prefs",
    name: "Preferences",
    kind: "profile",
    summary: "Dark UI, concise replies, prefer Gemini for reasoning tasks.",
  },
  {
    id: "projects",
    name: "Active projects",
    kind: "work",
    summary: "Personal agent frontend, memory graph, local model toggle.",
  },
  {
    id: "contacts",
    name: "People",
    kind: "graph",
    summary: "Close collaborators and recurring meeting context.",
  },
  {
    id: "tools",
    name: "Tools",
    kind: "system",
    summary: "Tauri desktop shell, Vite, Tailwind, lucide icons.",
  },
];

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "agent",
    text: "Ready when you are. Give me a task and I’ll break it down.",
  },
];