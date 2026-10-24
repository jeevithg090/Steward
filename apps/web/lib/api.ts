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

export interface MissionView {
  id: string;
  state: MissionState;
  message: string | null;
  ask: ConsentAsk | null;
  outcome: { state: string; message: string; amount_gbp: string | null; reference: string | null } | null;
  timeline: TimelineEntry[];
  trace_url: string | null;
  court: CourtDecision | null;
}

export interface Health {
  status: string;
  mode: "live" | "replay";
  demo: boolean;
  simulated: string[];
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
  tick = () => this.call<{ fired: string[] }>("/scheduler/tick", { method: "POST" });

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
