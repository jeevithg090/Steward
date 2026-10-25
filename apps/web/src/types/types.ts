// The teammate's UI types that the Gateway client does not cover: the model picker, the pasted
// keys, and the chat's own message shape. Everything the Gateway returns is typed once, in
// src/lib/api.ts; the few names re-exported here keep older imports working.
import type { ChatAction, ConsentAsk, EntitlementFlag, Intent, LedgerTotals } from "@/lib/api";

import type { LetterReading } from "@/lib/letters";
import type { ShieldVerdict } from "@/lib/shield";

export type { ConsentAsk, MissionState, MemoryItem, RecalledMemory } from "@/lib/api";
import type { RecalledMemory } from "@/lib/api";

export type ModelProvider = "gemini" | "claude" | "openai" | "local";
export type ApiKeyProvider = "claude" | "openai" | "elevenlabs";

export interface ModelOption {
  id: ModelProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
}

export type ApiKeys = Partial<Record<ApiKeyProvider, string>>;

/** A route section (`/chat`, `/missions`, …); see src/router.ts. */
export type View = string;

/** One bubble in the chat. Agent messages may carry what the chat door returned (plan.md §4.1). */
export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "assistant" | "system";
  text: string;
  audio?: {
    url: string;
    durationMs?: number;
    duration?: number;
    waveform?: number[];
    mimeType?: string;
  };
  timestamp?: number | string;
  /** The chat door's intent for this reply, shown as a small badge. */
  intent?: Intent;
  /** Scam Shield's verdict, when the person asked about a message. */
  verdict?: ShieldVerdict;
  /** What Tempo remembers, in the person's words. */
  memories?: RecalledMemory[];
  /** The Time Ledger's counters. */
  ledger?: LedgerTotals;
  /** Entitlement Check's flags. */
  flags?: EntitlementFlag[];
  /** Link chips to the page behind the answer. */
  actions?: ChatAction[];
  /** The honesty line: what was simulated in this run (shown once per conversation). */
  simulated?: string[];
  /** A letter read by Read It To Me, rendered as a card. */
  letter?: LetterReading;
  /** A consent question that was answered (kept for the record; the live one is on the conversation). */
  ask?: ConsentAsk | null;
  /** A quiet status line (state change, timer) rather than a spoken reply. */
  kind?: "status";
}
