import { ArrowLeft, Clock, Coins, FastForward, Play, Square } from "lucide-react";
import {
  ConsentCard,
  CourtVotes,
  MissionTimeline,
  PassportPanel,
  ProofTrace,
  RightsPortfolio,
  TraceLink,
  gbp,
  isLive,
  missionAmount,
  personWords,
  plainMessage,
  skillWords,
  stateTone,
} from "@/components/mission";
import { Badge, Button, Card, FOCUS, SectionTitle } from "@/components/ui";
import type { Health, MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import type { LiveEvent } from "@/lib/live";
import { linkProps } from "@/router";

export interface MissionDetailProps {
  mission: MissionView;
  health: Health | null;
  events: LiveEvent[];
  busy: boolean;
  /** This device answers with its passkey (useMesh().signs). */
  signs?: boolean;
  /** How far the demo clock has been moved, in days (0 when it has not). */
  clockDays?: number;
  onAnswer: (requestId: string, approved: boolean) => void;
  onStop: () => void;
  onTick: () => void;
  onAdvanceClock: (days: number) => void;
  onCreditArrives: () => void;
  onRevoke: (mandateId: string) => void;
  /** Fetch the mission again (after a mandate is signed on this page). */
  onChanged?: () => void;
}

const STATE_BAR = {
  emerald: "border-emerald-500/40",
  amber: "border-amber-500/40",
  rose: "border-rose-500/40",
  indigo: "border-indigo-500/40",
  purple: "border-purple-500/40",
  slate: "border-white/10",
} as const;

/**
 * One mission in full. A sticky header keeps the state and STOP in reach; then, in order: the ask,
 * the outcome, the Rights Portfolio, the Proof Trace, the Court, the Agent Passport, the
 * timeline and the trace link (plan.md §12.3).
 */
export function MissionDetail({ mission, health, events, busy, signs = false, clockDays = 0, onAnswer, onStop, onTick, onAdvanceClock, onCreditArrives, onRevoke, onChanged }: MissionDetailProps) {
  const live = isLive(mission.state);
  const ofcom = (mission.skill_id ?? "").includes("ofcom");
  const demo = Boolean(health?.demo);
  const waiting = mission.state === "waiting";
  const mine = events.filter((e) => !e.mission_id || e.mission_id === mission.id);
  const tone = stateTone(mission.state);
  const state = STATE_LABELS[mission.state] ?? mission.state;
  const message = plainMessage(mission.message);
  const amount = missionAmount(mission);
  // "Check the payment now" fires the Watchdog's due timers (POST /scheduler/tick), in any mode;
  // moving the clock and the credit arriving are demo-only routes.
  const showControls = live && (waiting || (demo && Boolean(mission.plan)));

  return (
    <div className="space-y-4">
      <div className={`sticky -top-3 z-20 -mx-4 border-b bg-nexus-canvas/95 px-4 py-2.5 backdrop-blur-md lg:-mx-6 lg:px-6 ${STATE_BAR[tone]}`}>
        <div className="flex items-center gap-3">
          <a {...linkProps("/missions")} aria-label="All missions" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-indigo-200 hover:bg-white/10 ${FOCUS}`}>
            <ArrowLeft size={18} aria-hidden />
          </a>
          <div className="min-w-0 flex-1">
            <h2 id="mission-state-heading" className="truncate text-base font-semibold text-slate-100">
              {skillWords(mission.skill_id)} for {personWords(mission.user_id)}
            </h2>
            <p aria-live="polite" className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <Badge tone={tone}>{state}</Badge>
              {amount && <span className={`text-sm font-semibold tabular-nums ${mission.state === "verified" ? "text-emerald-200" : "text-slate-100"}`}>{gbp(amount)}</span>}
              <span className="font-mono">{mission.id}</span>
            </p>
          </div>
          {live && (
            <Button variant="danger" busy={busy} icon={<Square size={14} fill="currentColor" aria-hidden />} onClick={onStop} className="shrink-0 font-bold uppercase tracking-wide">
              Stop
            </Button>
          )}
        </div>
      </div>

      {showControls && (
        <Card as="section" aria-labelledby="demo-controls-heading" tone="amber" padding="tight">
          <SectionTitle id="demo-controls-heading" as="h3" right={clockDays > 0 ? <Badge tone="amber"><Clock size={12} aria-hidden /> Demo clock +{clockDays} days</Badge> : demo ? <Badge tone="amber">demo controls</Badge> : undefined}>
            {demo ? "Move the demo along" : "Check now"}
          </SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            {waiting && (
              <Button variant="primary" busy={busy} icon={<Play size={14} aria-hidden />} onClick={onTick}>
                Check the payment now
              </Button>
            )}
            {demo && waiting && mission.plan && (
              <Button variant="quiet" busy={busy} icon={<FastForward size={14} aria-hidden />} onClick={() => onAdvanceClock(31)}>
                Jump ahead 31 days
              </Button>
            )}
            {demo && waiting && ofcom && (
              <Button variant="quiet" busy={busy} icon={<Coins size={14} aria-hidden />} onClick={onCreditArrives}>
                The credit arrives
              </Button>
            )}
          </div>
        </Card>
      )}
      {!showControls && clockDays > 0 && (
        <p>
          <Badge tone="amber">
            <Clock size={12} aria-hidden /> Demo clock +{clockDays} days
          </Badge>
        </p>
      )}

      {mission.ask && <ConsentCard ask={mission.ask} court={mission.court} busy={busy} onAnswer={(yes) => onAnswer(mission.ask!.request_id, yes)} why={false} signed={signs} />}

      {mission.outcome ? (
        <Card as="section" aria-labelledby="outcome-heading" tone={mission.outcome.state === "verified" ? "emerald" : "default"}>
          <SectionTitle id="outcome-heading" as="h3" right={mission.outcome.amount_gbp ? <span className="text-lg font-semibold tabular-nums text-emerald-200">{gbp(mission.outcome.amount_gbp)}</span> : undefined}>
            Outcome
          </SectionTitle>
          <p role="status" className="text-sm text-slate-100">
            {plainMessage(mission.outcome.message)}
          </p>
          {mission.outcome.reference && <p className="mt-1 text-xs text-slate-400">reference {mission.outcome.reference}</p>}
        </Card>
      ) : (
        message &&
        !mission.ask && (
          <Card as="section" aria-labelledby="message-heading" tone={tone === "rose" ? "rose" : "default"}>
            <SectionTitle id="message-heading" as="h3">
              What Tempo says
            </SectionTitle>
            <p role="status" className="text-sm text-slate-100">
              {message}
            </p>
          </Card>
        )
      )}

      {mission.plan && <RightsPortfolio plan={mission.plan} mission={mission} />}

      {mission.ask?.proof_trace && <ProofTrace trace={mission.ask.proof_trace} />}
      <CourtVotes court={mission.court} />

      <PassportPanel mandate={mission.mandate} events={mine} busy={busy} onRevoke={onRevoke} mission={mission} onChanged={onChanged} />

      <MissionTimeline mission={mission} personName={personWords(mission.user_id)} />

      <TraceLink url={mission.trace_url} />
    </div>
  );
}
