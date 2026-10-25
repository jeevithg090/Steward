import { ArrowLeft, CircleCheckBig, Clock, Coins, FastForward, FlaskConical, MessageSquareText, Play, Square } from "lucide-react";
import {
  ConsentCard,
  CourtVotes,
  GLOW_LINE,
  MissionTimeline,
  PassportPanel,
  ProofTrace,
  RightsPortfolio,
  SkillIcon,
  TraceLink,
  amountTone,
  amountWord,
  gbp,
  isLive,
  missionAmount,
  personWords,
  plainMessage,
  skillWords,
  stateTone,
} from "@/components/mission";
import { Badge, Button, Card, FOCUS } from "@/components/ui";
import type { Health, MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import type { LiveEvent } from "@/lib/live";
import { linkProps } from "@/router";
import { planWords } from "./MissionList";

export interface MissionDetailProps {
  mission: MissionView;
  /** The id of the person using the app: their missions say "you", never a name. */
  me?: string;
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

/** The state's light behind the sticky bar's left end. */
const HALO = {
  emerald: "bg-emerald-400/20",
  amber: "bg-amber-400/20",
  rose: "bg-rose-400/20",
  indigo: "bg-accent-500/25",
  purple: "bg-second-400/20",
  slate: "bg-white/5",
  gold: "bg-gold-400/20",
} as const;

/** A card's small section label: the theme's uppercase eyebrow, as a heading. */
const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400";

/**
 * One mission in full. A sticky glass bar keeps the state, the amount and STOP in reach; then the
 * ask, the outcome, the Rights Portfolio, the Proof Trace, the Court and the Agent Passport, with
 * the timeline beside them on wide screens (after them on narrow ones) and the trace link
 * (plan.md §12.3).
 */
export function MissionDetail({ mission, me, health, events, busy, signs = false, clockDays = 0, onAnswer, onStop, onTick, onAdvanceClock, onCreditArrives, onRevoke, onChanged }: MissionDetailProps) {
  const live = isLive(mission.state);
  const ofcom = (mission.skill_id ?? "").includes("ofcom");
  const demo = Boolean(health?.demo);
  const waiting = mission.state === "waiting";
  const mine = events.filter((e) => !e.mission_id || e.mission_id === mission.id);
  const tone = stateTone(mission.state);
  const state = STATE_LABELS[mission.state] ?? mission.state;
  const message = plainMessage(mission.message);
  const amount = missionAmount(mission);
  const plan = planWords(mission);
  // "Check the payment now" fires the Watchdog's due timers (POST /scheduler/tick), in any mode;
  // moving the clock and the credit arriving are demo-only routes.
  const showControls = live && (waiting || (demo && Boolean(mission.plan)));
  const paid = mission.outcome?.state === "verified";

  return (
    <div className="space-y-6">
      <div className="sticky top-3 z-20 motion-safe:animate-fade-up">
        <div className="glass-strong relative overflow-hidden rounded-3xl py-3 pl-3 pr-3 sm:py-3.5 sm:pr-4">
          <span aria-hidden className={`pointer-events-none absolute -left-12 top-1/2 h-28 w-56 -translate-y-1/2 rounded-full blur-3xl ${HALO[tone]}`} />
          <span aria-hidden className={`pointer-events-none absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent ${GLOW_LINE[tone]}`} />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <a
              {...linkProps("/missions")}
              aria-label="All missions"
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white motion-reduce:transition-none ${FOCUS}`}
            >
              <ArrowLeft size={18} aria-hidden />
            </a>
            <span className="hidden sm:block">
              <SkillIcon skillId={mission.skill_id} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="mission-state-heading" className="line-clamp-2 text-base font-semibold leading-snug tracking-[-0.01em] text-white sm:truncate sm:text-lg">
                {skillWords(mission.skill_id)} for {personWords(mission.user_id, me)}
              </h2>
              <p aria-live="polite" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge tone={tone} dot>
                  {state}
                </Badge>
                {plan && <Badge tone="indigo">{plan}</Badge>}
                {amount && <span className={`num text-sm font-semibold sm:hidden ${amountTone(mission.state)}`}>{gbp(amount)}</span>}
                <span className="hidden font-mono text-[11px] text-slate-500 md:inline">{mission.id}</span>
              </p>
            </div>
            {amount && (
              <div className="hidden shrink-0 text-right sm:block">
                <p className={`num text-[1.75rem] font-semibold leading-none tracking-[-0.02em] ${amountTone(mission.state)}`}>{gbp(amount)}</p>
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{amountWord(mission.state)}</p>
              </div>
            )}
            {live && (
              <Button variant="danger" busy={busy} icon={<Square size={13} fill="currentColor" aria-hidden />} onClick={onStop} className="shrink-0 font-bold uppercase tracking-[0.08em]">
                Stop
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="stagger min-w-0 space-y-5">
          {showControls && (
            <Card as="section" aria-labelledby="demo-controls-heading" tone="amber" padding="none" className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/25">
                    {demo ? <FlaskConical size={16} /> : <Clock size={16} />}
                  </span>
                  <h3 id="demo-controls-heading" className="text-[15px] font-semibold text-white">
                    {demo ? "Move the demo along" : "Check now"}
                  </h3>
                </div>
                {clockDays > 0 ? (
                  <Badge tone="amber" dot>
                    <Clock size={12} aria-hidden /> Demo clock +{clockDays} days
                  </Badge>
                ) : demo ? (
                  <Badge tone="amber" dot>
                    demo controls
                  </Badge>
                ) : undefined}
              </div>
              {!waiting && (
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  {mission.ask ? "Say yes or no to Tempo's question first. Then these controls can move the demo clock or play the company." : "Nothing to move along yet: Tempo is still working."}
                </p>
              )}
              {waiting && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="primary" busy={busy} icon={<Play size={14} aria-hidden />} onClick={onTick}>
                    Check the payment now
                  </Button>
                  {demo && mission.plan && (
                    <Button variant="quiet" busy={busy} icon={<FastForward size={14} aria-hidden />} onClick={() => onAdvanceClock(31)}>
                      Jump ahead 31 days
                    </Button>
                  )}
                  {demo && ofcom && (
                    <Button variant="quiet" busy={busy} icon={<Coins size={14} aria-hidden />} onClick={onCreditArrives}>
                      The credit arrives
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}
          {!showControls && clockDays > 0 && (
            <p>
              <Badge tone="amber" dot>
                <Clock size={12} aria-hidden /> Demo clock +{clockDays} days
              </Badge>
            </p>
          )}

          {mission.ask && (
            <ConsentCard
              ask={mission.ask}
              court={mission.court}
              busy={busy}
              onAnswer={(yes) => onAnswer(mission.ask!.request_id, yes)}
              why={false}
              signed={signs}
              waits={mission.plan ? mission.plan.action_today === "wait" : undefined}
            />
          )}

          {mission.outcome ? (
            <Card as="section" aria-labelledby="outcome-heading" tone={paid ? "emerald" : "default"} className="relative overflow-hidden">
              {paid && <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-400/10 blur-3xl" />}
              <div className="relative flex flex-wrap items-start gap-4 sm:flex-nowrap">
                <span
                  aria-hidden
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1 ring-inset ${paid ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25 shadow-[0_0_28px_-6px_rgb(52_211_153/0.6)]" : "bg-white/[0.06] text-slate-300 ring-white/10"}`}
                >
                  <CircleCheckBig size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 id="outcome-heading" className={EYEBROW}>
                    Outcome
                  </h3>
                  <p role="status" className="mt-1.5 text-[15px] leading-relaxed text-white">
                    {plainMessage(mission.outcome.message)}
                  </p>
                  {mission.outcome.reference && (
                    <p className="mt-2 text-xs text-slate-400">
                      reference <span className="font-mono text-slate-300">{mission.outcome.reference}</span>
                    </p>
                  )}
                </div>
                {mission.outcome.amount_gbp && (
                  <div className="w-full shrink-0 border-t border-white/[0.08] pt-3 sm:w-auto sm:border-0 sm:pt-0 sm:text-right">
                    <p className={`num text-[2rem] font-semibold leading-none tracking-[-0.02em] ${paid ? "text-gold" : "text-white"}`}>{gbp(mission.outcome.amount_gbp)}</p>
                    {paid && <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-200">paid</p>}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            message &&
            !mission.ask && (
              <Card as="section" aria-labelledby="message-heading" tone={tone === "rose" ? "rose" : "default"}>
                <div className="flex items-start gap-4">
                  <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-500/15 text-accent-200 ring-1 ring-inset ring-accent-300/25">
                    <MessageSquareText size={19} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 id="message-heading" className={EYEBROW}>
                      What Tempo says
                    </h3>
                    <p role="status" className="mt-1.5 text-[15px] leading-relaxed text-white">
                      {message}
                    </p>
                  </div>
                </div>
              </Card>
            )
          )}

          {mission.plan && <RightsPortfolio plan={mission.plan} mission={mission} />}

          {mission.ask?.proof_trace && <ProofTrace trace={mission.ask.proof_trace} />}
          <CourtVotes court={mission.court} />

          <PassportPanel mandate={mission.mandate} events={mine} busy={busy} onRevoke={onRevoke} mission={mission} onChanged={onChanged} />
        </div>

        <div className="min-w-0 space-y-3 xl:sticky xl:top-32">
          <MissionTimeline mission={mission} personName={personWords(mission.user_id, me)} />
          <div className="px-2">
            <TraceLink url={mission.trace_url} />
          </div>
        </div>
      </div>
    </div>
  );
}
