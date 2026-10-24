// A typed client for the Gateway (apps/gateway). Shapes mirror its pydantic models.

export type MissionState =
  | "received" | "understood" | "planned" | "appraised" | "declined" | "awaiting_consent"
  | "running" | "checkpoint" | "waiting" | "completed" | "failed_safe" | "verified";

export interface ProofStep {
  fact_keys: string[];
  rule_id: string;
  rule_version: string;
  citation_url: string;
  explanation: string;
}

export interface ProofTraceData {
  id: string;
  steps: ProofStep[];
  amount_gbp: string;
}

export interface CourtDecision {
  outcome: "proceed" | "proceed_flagged" | "human_checkpoint";
  eligible: boolean | null;
  agreement_rate: number;
  verdicts: { juror: string; verdict: { eligible: boolean; rule_id: string; confidence: number } }[];
  absent: string[];
  flags: string[];
}

export interface ConsentAsk {
  request_id: string;
  summary: string;
  amount_gbp: string;
  proof_trace: ProofTraceData | null;
}

export interface TimelineEntry {
  to: MissionState;
  at: string;
  latency_ms: number;
}

// Rights Decay (R6): when to act on each right, and why. Mirrors tempo_core.rights_decay.Plan.
export type RightStatus = "chosen" | "open" | "opens_later" | "locked" | "expired";

export interface PlanRight {
  id: string;
  label: string;
  status: RightStatus;
  opens_on: string | null;
  expires_on: string | null;
  unlocked_by: string[];
  ev_gbp: string;
  best_way: string;
}

export interface PlanDay {
  day: string;
  best: string;
  value_gbp: string;
  value_at_risk_gbp: string;
  cost_of_delay_gbp: string;
}

export interface PlanView {
  today: string;
  horizon: string;
  action_today: string; // "wait", "drop" or a right id
  way: string | null;
  next_decision_on: string | null;
  days: PlanDay[];
  rights: PlanRight[];
  explanation: string;
  why: string[];
  assumptions: {
    time_value_gbp_h: string;
    attention_minutes_per_week: string;
    hazard_id: string;
    hazard_demo_values: boolean;
    pays_share: string;
    pays_share_source: string;
  };
}

// Agent Passport (P7): the newest mandate for a mission, as the Gateway summarises it.
export interface MandateView {
  id: string;
  status: "active" | "revoked" | "expired" | "unknown";
  counterparty: string;
  may: string[];
  may_not: string[];
  max_gbp: string;
  expires_at: string;
  account_ref: string | null;
  assurance: "device-biometric" | "gateway-attested";
  digest: string;
}

// R8: what vision read off the card, and the one read-back question if a fact is unsure.
export interface CardReading {
  facts: { key: string; value: string; source: string; confidence: number }[];
  question: string | null;
  fact_key?: string;
  visit: Record<string, string | null> | null;
  mission?: MissionView;
}

export interface MissionView {
  id: string;
  user_id?: string | null;
  state: MissionState;
  message: string | null;
  ask: ConsentAsk | null;
  outcome: { state: string; message: string; amount_gbp: string | null; reference: string | null } | null;
  timeline: TimelineEntry[];
  trace_url: string | null;
  court: CourtDecision | null;
  skill_id?: string | null;
  plan?: PlanView | null;
  mandate?: MandateView | null;
}

export interface MemoryItem {
  id: string;
  text: string;
  category: string;
  source: string;
  trust: "trusted" | "untrusted";
  observed_at: string;
  confidence: number;
  expires_at: string | null;
  superseded_by: string | null;
}

export interface TemporalFact {
  id: string;
  kind: string;
  subject: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to: string | null;
  superseded_by: string | null;
  episode_id: string;
}

export interface MemoryCardData {
  memories: Record<string, { item: MemoryItem; earlier: MemoryItem[] }[]>;
  timeline: TemporalFact[];
}

/** How Tempo's voice agent will speak with one caller (GET /voice/profile, the Patience Profile). */
export interface VoiceProfileData {
  language: string; // "en", "hi", "pa", "pl", "ur", "cy"
  speed: string; // "1.0", "0.9", "0.85"
  voice: "default" | "low";
  patience: "normal" | "high";
  stammer: boolean;
  hearing: boolean;
  prefers_text: boolean;
  other_language: string | null;
  keywords: string[];
  reasons: string[]; // the memories that set it, in the person's words
}

export interface VoiceProfileView {
  user_id: string;
  display_name: string | null;
  profile: VoiceProfileData;
  adjusted: boolean;
  how_to_speak: string;
  initiation: {
    type: string;
    dynamic_variables: Record<string, string>;
    conversation_config_override?: {
      agent?: { language?: string; first_message?: string };
      tts?: { voice_id?: string; speed?: number; stability?: number };
      asr?: { keywords?: string[] };
    };
  };
  low_voice_configured: boolean;
}

export interface PrivacyProofData {
  mode: string;
  region: string;
  third_parties: string[];
  image_digest: string | null;
  allowlist: "missing" | "signed";
  image_allowlisted: boolean;
  key_held_on: string[];
  operator_view: { table: string; bytes: string } | null;
  canary_test: string;
  attestation: string;
}

export interface Health {
  status: string;
  mode: "live" | "replay";
  demo: boolean;
  simulated: string[];
  clock_offset_days?: number; // the demo clock, moved forward (demo mode only)
}

export interface LedgerTotals {
  minutes_returned: string;
  hours_returned: string;
  gbp_recovered: string;
}

export interface GatewayConfig {
  url: string;
  token: string;
}

export function gatewayConfig(): GatewayConfig {
  return {
    url: process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8000",
    token: process.env.NEXT_PUBLIC_TEMPO_TOKEN ?? "",
  };
}

export class Gateway {
  constructor(
    private readonly config: GatewayConfig,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.config.url}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  health = () => this.call<Health>("/health");
  missions = () => this.call<MissionView[]>("/missions");
  mission = (id: string) => this.call<MissionView>(`/missions/${id}`);
  ledger = () => this.call<LedgerTotals>("/ledger");
  start = (body: Record<string, string>) =>
    this.call<MissionView>("/missions", { method: "POST", body: JSON.stringify(body) });
  answer = (requestId: string, approved: boolean) =>
    this.call<MissionView>(`/approvals/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ approved, limits: approved ? { auto_accept_max_gbp: "50" } : {} }),
    });
  stop = (id: string) => this.call<MissionView>(`/missions/${id}/stop`, { method: "POST" });
  startOfcom = (body: Record<string, string>) =>
    this.call<MissionView>("/missions/ofcom", { method: "POST", body: JSON.stringify(body) });
  readCard = (body: Record<string, string>) =>
    this.call<CardReading>("/missions/ofcom/read", { method: "POST", body: JSON.stringify(body) });
  advanceClock = (days: number) =>
    this.call<{ now: string; offset_days: number; fired: string[] }>("/demo/clock", {
      method: "POST",
      body: JSON.stringify({ advance_days: days }),
    });
  revokeMandate = (id: string) => this.call<{ status: string }>(`/mandates/${id}/revoke`, { method: "POST" });
  creditArrives = (id: string) => this.call<{ credited: boolean }>(`/demo/credit/${id}`, { method: "POST" });
  tick = () => this.call<{ fired: string[] }>("/scheduler/tick", { method: "POST" });
  privacy = (userId: string) => this.call<PrivacyProofData>(`/privacy?user_id=${encodeURIComponent(userId)}`);
  memories = (userId: string) => this.call<MemoryCardData>(`/memories?user_id=${encodeURIComponent(userId)}`);
  voiceProfile = (userId: string) => this.call<VoiceProfileView>(`/voice/profile?user_id=${encodeURIComponent(userId)}`);
  forgetMemory = (userId: string, id: string) =>
    this.call<{ forgotten: boolean }>(`/memories/${id}?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
  forgetEpisode = (userId: string, episodeId: string) =>
    this.call<{ forgotten: boolean }>(`/timeline/${episodeId}?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
  correctMemory = (userId: string, id: string, text: string) =>
    this.call<MemoryItem>(`/memories/${id}/correct`, { method: "POST", body: JSON.stringify({ user_id: userId, text }) });

  eventsUrl(): string {
    return `${this.config.url.replace(/^http/, "ws")}/events?token=${encodeURIComponent(this.config.token)}`;
  }
}

// Margaret's 08:12 Oxford -> Paddington, 38 minutes late (the replay demo journey).
export const DEMO_MISSION = {
  user_id: "u_margaret",
  display_name: "Margaret",
  origin_crs: "OXF",
  destination_crs: "PAD",
  travel_date: "2026-10-23",
  departure: "08:12",
  fare_gbp: "28.40",
  time_value_gbp_h: "18",
};

// Margaret's broadband: the engineer due on 19 Oct never came (Rights Decay's demo case).
export const DEMO_BROADBAND = {
  user_id: "u_margaret",
  display_name: "Margaret",
  operator: "Broadbandly",
  event_date: "2026-10-19",
  account_ref: "BB-4417",
  time_value_gbp_h: "18",
};
