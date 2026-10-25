import { ArrowLeft, Coins, FastForward, Play, Square } from "lucide-react";
import {
  ConsentCard,
  CourtVotes,
  MissionTimeline,
  PassportPanel,
  ProofTrace,
  RightsPortfolio,
  TERMINAL_STATES,
  TraceLink,
  gbp,
  personWords,
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
  onAnswer: (requestId: string, approved: boolean) => void;
  onStop: () => void;
  onTick: () => void;
  onAdvanceClock: (days: number) => void;
  onCreditArrives: () => void;
  onRevoke: (mandateId: string) => void;
}

/** One mission in full: the ask, the outcome, the plan, the proof, the court, the passport, the timeline. */
export function MissionDetail({ mission, health, events, busy, onAnswer, onStop, onTick, onAdvanceClock, onCreditArrives, onRevoke }: MissionDetailProps) {
  const terminal = TERMINAL_STATES.has(mission.state);
  const ofcom = (mission.skill_id ?? "").includes("ofcom");
  const demo = Boolean(health?.demo);
  const waiting = mission.state === "waiting";
  const mine = events.filter((e) => !e.mission_id || e.mission_id === mission.id);

  return (
    <div className="space-y-4">
      <a {...linkProps("/missions")} className={`inline-flex items-center gap-1 rounded text-sm text-indigo-300 hover:text-indigo-200 ${FOCUS}`}>
        <ArrowLeft size={14} aria-hidden /> All missions
      </a>

      <Card as="section" aria-labelledby="mission-state-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mission-state-heading" className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-100">
            <Badge tone={stateTone(mission.state)}>{STATE_LABELS[mission.state] ?? mission.state}</Badge>
            {skillWords(mission.skill_id)} for {personWords(mission.user_id)}
          </h2>
          <span className="font-mono text-xs text-slate-500">{mission.id}</span>
        </div>
        {mission.message && !mission.ask && !mission.outcome && <p className="mt-2 text-sm text-slate-200">{mission.message}</p>}
        {mission.outcome && (
          <div className={`mt-3 rounded-xl border p-3 ${mission.outcome.state === "verified" ? "border-emerald-500/30 bg-emerald-950/20" : "border-white/10 bg-white/5"}`} role="status">
            <SectionTitle as="p">Outcome</SectionTitle>
            <p className="text-sm text-slate-100">{mission.outcome.message}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-400">
              {mission.outcome.amount_gbp && <span className="text-emerald-200">{gbp(mission.outcome.amount_gbp)}</span>}
              {mission.outcome.reference && <span>reference {mission.outcome.reference}</span>}
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Controls">
          {demo && waiting && (
            <Button variant="primary" size="sm" busy={busy} icon={<Play size={14} aria-hidden />} onClick={onTick}>
              Check the payment now
            </Button>
          )}
          {demo && waiting && mission.plan && (
            <Button variant="quiet" size="sm" busy={busy} icon={<FastForward size={14} aria-hidden />} onClick={() => onAdvanceClock(31)}>
              Jump ahead 31 days
            </Button>
          )}
          {demo && waiting && ofcom && (
            <Button variant="quiet" size="sm" busy={busy} icon={<Coins size={14} aria-hidden />} onClick={onCreditArrives}>
              The credit arrives
            </Button>
          )}
          {!terminal && (
            <Button variant="danger" size="sm" busy={busy} icon={<Square size={14} aria-hidden />} onClick={onStop}>
              Stop
            </Button>
          )}
          {demo && (waiting || mission.plan) && <Badge tone="amber">demo controls</Badge>}
        </div>
      </Card>

      {mission.ask && <ConsentCard ask={mission.ask} court={mission.court} busy={busy} onAnswer={(yes) => onAnswer(mission.ask!.request_id, yes)} why={false} />}

      {mission.plan && <RightsPortfolio plan={mission.plan} />}

      {mission.ask?.proof_trace && <ProofTrace trace={mission.ask.proof_trace} />}
      <CourtVotes court={mission.court} />

      <PassportPanel mandate={mission.mandate} events={mine} busy={busy} onRevoke={onRevoke} />

      <MissionTimeline mission={mission} personName={personWords(mission.user_id)} />

      <TraceLink url={mission.trace_url} />
    </div>
  );
}
