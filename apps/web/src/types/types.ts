export type ModelProvider = "gemini" | "claude" | "openai" | "local";
export type ApiKeyProvider = "claude" | "openai";

export interface ModelOption {
  id: ModelProvider;
  name: string;
  description: string;
  requiresApiKey: boolean;
}

export type ApiKeys = Record<ApiKeyProvider, string>;

export type View = "chat" | "memory" | "settings";

export type MemoryCategory =
  | "preference"
  | "contact"
  | "journey"
  | "household"
  | "mission_fact"
  | "health"
  | "immigration"
  | "finance";

export interface MemoryItem {
  id: string;
  user_id: string;
  key: string;
  text: string;
  category: MemoryCategory;
  source: string;
  trust: "trusted" | "untrusted";
  observed_at: string;
  confidence: number;
  consent_scope: string | null;
  expires_at: string | null;
  superseded_by: string | null;
}

export interface TemporalFact {
  id: string;
  user_id: string;
  kind: "appointment" | "promise" | "deadline" | "reference" | "outcome";
  subject: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  episode_id: string;
}
export type MissionState =
  | "received"
  | "understood"
  | "planned"
  | "appraised"
  | "declined"
  | "awaiting_consent"
  | "running"
  | "checkpoint"
  | "waiting"
  | "completed"
  | "failed_safe"
  | "verified";

export type LiveEvent =
  | { type: "mission_created"; mission_id: string }
  | {
      type: "state_changed";
      mission_id: string;
      from: MissionState;
      to: MissionState;
      at: string;
      latency_ms: number;
      actor: "agent" | "user" | "system";
    }
  | { type: "consent_requested"; mission_id: string; request_id: string }
  | { type: "timer_set"; mission_id: string; wake_at: string }
  | { type: "ledger"; mission_id: string }
  | {
      type: "outcome";
      mission_id: string;
      state: string;
      message: string;
      amount_gbp: string | null;
      reference: string | null;
    }
  | { type: "signal"; signal_id: string; from: string; [field: string]: string }
  | { type: "call_ended"; conversation_id: string }
  | {
      type: "log_stall";
      category: string;
      counter: string;
      quote?: string;
      mission_id?: string;
      [k: string]: string | undefined;
    }
  | { type: "record_reference" | "request_human"; [k: string]: string };


export interface ProofStep {
  fact_keys: string[];
  rule_id: string;
  rule_version: string;
  citation_url: string;
  explanation: string;
}

export interface ProofTrace {
  id: string;
  steps: ProofStep[];
  amount_gbp: string;
}

export interface JurorVerdict {
  eligible: boolean;
  rule_id: string;
  band: string | null;
  amount_gbp: string | null;
  citations: string[];
  confidence: number;
  reasoning: string;
}

export interface CourtDecision {
  outcome: "proceed" | "proceed_flagged" | "human_checkpoint";
  eligible: boolean | null;
  agreement_rate: number;
  verdicts: { juror: string; verdict: JurorVerdict }[];
  absent: string[];
  flags: string[];
}

export interface ConsentAsk {
  request_id: string;
  summary: string;
  amount_gbp: string;
  proof_trace?: ProofTrace | null;
  court?: CourtDecision | null;
}

export interface MemoryCard {
  memories?: Partial<Record<MemoryCategory, { item: MemoryItem; earlier: MemoryItem[] }[]>>;
  timeline?: TemporalFact[];
}

export interface MemoryNode {
  id: string;
  name: string;
  kind: string;
  summary: string;
  rawType?: "memory" | "timeline";
  episodeId?: string;
}



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
}