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
  /** Paid, else asked; kept after the yes so a waiting claim still shows its amount. */
  amount_gbp?: string | null;
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
  deploy: string; // local | cloud-standard | cloud-private | cloud-confidential
  region: string;
  third_parties: string[];
  clock_offset_days?: number; // the demo clock, moved forward (demo mode only)
  chat?: { llm: string }; // plan.md §4.3: what phrases small talk ("off", "replay", or a model kind)
  /** The real model behind the jurors, small talk and (cloud-gpu) photos, or null (plan.md §13). */
  model?: { kind: string; name: string; processor: string; answering?: boolean | null } | null;
}

export interface LedgerTotals {
  minutes_returned: string;
  hours_returned: string;
  gbp_recovered: string;
}

export { gatewayConfig, type GatewayConfig } from "./config";
import type { GatewayConfig } from "./config";

// --- Tonight's additions (plan.md §4.1, §4.2): the chat door and server-side speech ---------------

export type Intent =
  | "rail_delay" | "missed_visit" | "scam_check" | "letter" | "memory_recall" | "memory_forget"
  | "ledger" | "entitlement" | "approve" | "decline" | "stop" | "profiles" | "help" | "smalltalk"
  | "sweep";

export interface ChatTurn {
  user_id: string;
  display_name?: string;
  text: string;
  profile_id?: string | null;
  language?: string;
  /** What the client already knows from earlier turns; the server merges and echoes it back. */
  slots?: Record<string, string | null>;
  /** The conversation so far, so the Gateway's brain answers in context (plan.md §16). */
  history?: { role: "user" | "tempo"; text: string }[];
}

export interface ChatNeed {
  field: string;
  question: string;
}

export interface ChatAction {
  label: string;
  href: string;
}

/** What the chat door returns for "what do you remember": tempo_memory's `Recalled`. */
export interface RecalledMemory {
  id: string;
  text: string;
  kind?: "memory" | "fact";
  /** In plain words: "you said, by voice", "Tempo's records". */
  source?: string;
  when?: string;
  /** A full `MemoryItem` from `/memories` fits too (the showcase recalls from the Memory Card). */
  category?: string;
  observed_at?: string;
  trust?: string;
}

export interface ChatReply {
  intent: Intent;
  reply: string;
  say: string;
  slots: Record<string, string | null>;
  needs: ChatNeed[] | null;
  mission: MissionView | null;
  ask: ConsentAsk | null;
  verdict: Record<string, unknown> | null;
  memories: RecalledMemory[] | null;
  ledger: LedgerTotals | null;
  flags: EntitlementFlag[] | null;
  actions: ChatAction[] | null;
  /** Up to four things the person could say next; the chat shows them as chips that send the text (plan.md §12.2). */
  suggestions?: string[] | null;
  /** What a sweep of the connected places found (plan.md §14.2), for the `sweep` intent. */
  findings?: Finding[] | null;
  /** Where a looked-up answer came from (plan.md §17): shown as links under the reply. */
  sources?: ChatSource[] | null;
  /** What the brain did this turn, with timings (plan.md §17): the reply's steps row. */
  steps?: ChatStep[] | null;
  simulated: string[];
}

export interface ChatSource {
  title: string;
  url: string;
}

export interface ChatStep {
  kind: "think" | "look_up" | "act";
  label: string;
  ms: number;
}

// --- Connectors and MCP (plan.md §14.2) ---------------------------------------------------------

/** The places a person's life already is; each is a small read-only MCP server Tempo talks to. */
export type ConnectorKind = "mail" | "calendar" | "bank" | "rail";

export interface Connector {
  id: string;
  name: string;
  kind: ConnectorKind;
  connected: boolean;
  /** What Tempo may read, in plain words. */
  scopes: string[];
  /** The read-only tools Tempo may call on it (an allowlist). */
  tools: string[];
  last_read_at: string | null;
  items_read: number;
}

/** `GET /connectors?user_id=`. */
export interface ConnectorList {
  connectors: Connector[];
  /** The data behind the connectors is fixtures, not the person's real accounts. */
  simulated: boolean;
}

export type FindingKind = "late_train" | "engineer_visit" | "scam" | "money_arrived" | "letter";

/** One thing a sweep found, worked out by code (tempo_core.findings). Nothing is started by it. */
export interface Finding {
  id: string;
  kind: FindingKind;
  title: string;
  why: string;
  amount_gbp?: string | null;
  /** Where it was found: the connector's id and the item, in plain words. */
  source: { connector: string; item: string };
  /** The sentence the person could say next (the chat's suggestion chip). */
  say: string;
  action: ChatAction;
}

/** `POST /connectors/sweep`: the findings, and how many items Tempo read from each connector (never kept). */
export interface SweepResult {
  findings: Finding[];
  read: Record<string, number>;
  took_ms: number;
}

export interface McpTool {
  name: string;
  description: string;
  read_only: boolean;
}

/** An MCP resource or prompt as `/mcp/info` lists it: a name, a URI or a short string. */
export type McpEntry = string | { name?: string; uri?: string; uri_template?: string; description?: string };

/** `GET /mcp/info`: how an MCP client reaches Tempo, and what it may ask. */
export interface McpInfo {
  url: string;
  transport: "streamable-http";
  tools: McpTool[];
  resources: McpEntry[];
  prompts: McpEntry[];
}

export type Persona = "tempo" | "negotiator" | "analyst" | "auditor" | "contractor";

/** Entitlement Check (POST /entitlement/screen): ten answers in, what is worth claiming out. */
export interface EntitlementAnswers {
  age: number;
  couple: boolean;
  weekly_income_gbp: string;
  savings_gbp: string;
  benefits: string[];
  needs_care_day: boolean;
  needs_care_night: boolean;
  care_months: number;
  terminally_ill: boolean;
  has_broadband_or_phone: boolean;
}

export interface EntitlementFlag {
  benefit: string;
  likelihood: string;
  why: string;
  weekly_gbp: string | null;
  signpost: string;
}

export interface EntitlementResult {
  flags: EntitlementFlag[];
  disclaimer: string;
  pack?: Record<string, unknown> | null;
  [k: string]: unknown;
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

  chat = (turn: ChatTurn) => this.call<ChatReply>("/chat", { method: "POST", body: JSON.stringify(turn) });
  screen = (answers: EntitlementAnswers) =>
    this.call<EntitlementResult>("/entitlement/screen", { method: "POST", body: JSON.stringify(answers) });
  ttsConfigured = async (): Promise<boolean> => {
    try {
      return (await this.call<{ configured: boolean }>("/voice/tts")).configured;
    } catch {
      return false;
    }
  };
  /** Speech from the Gateway's own ElevenLabs key; rejects when it has none (the caller falls back). */
  tts = async (text: string, persona: Persona = "tempo", voice: "default" | "low" = "default"): Promise<ArrayBuffer> => {
    const response = await this.fetchImpl(`${this.config.url}/voice/tts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, persona, voice }),
    });
    if (!response.ok) throw new Error(`POST /voice/tts: HTTP ${response.status}`);
    return response.arrayBuffer();
  };

  connectors = (userId: string) => this.call<ConnectorList>(`/connectors?user_id=${encodeURIComponent(userId)}`);
  connect = (id: string, userId: string) =>
    this.call<Connector>(`/connectors/${encodeURIComponent(id)}/connect`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
  disconnect = (id: string, userId: string) =>
    this.call<Connector>(`/connectors/${encodeURIComponent(id)}/disconnect`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
  sweep = (userId: string) => this.call<SweepResult>("/connectors/sweep", { method: "POST", body: JSON.stringify({ user_id: userId }) });
  mcpInfo = () => this.call<McpInfo>("/mcp/info");

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
