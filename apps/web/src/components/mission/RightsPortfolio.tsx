import { CheckCircle2, CircleSlash } from "lucide-react";
import { Badge, Card, SectionTitle } from "@/components/ui";
import type { MissionView, PlanRight, PlanView, RightStatus } from "@/lib/api";
import { dayWords, gbp, reachedAt } from "./words";

const DAY_MS = 86_400_000;

export const STATUS_WORDS: Record<RightStatus, string> = {
  chosen: "using it now",
  open: "open",
  opens_later: "opens later",
  locked: "locked",
  expired: "ran out",
};

const BAR: Record<RightStatus, string> = {
  chosen: "bg-indigo-400",
  open: "bg-emerald-400/80",
  opens_later: "bg-slate-500",
  locked: "bg-[repeating-linear-gradient(45deg,rgba(148,163,184,0.5)_0_6px,rgba(148,163,184,0.15)_6px_12px)]",
  expired: "bg-rose-500/40",
};

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** "Waiting, on purpose", "Acting now", or "Not worth chasing". */
export function verdict(plan: PlanView): string {
  if (plan.action_today === "wait") return "Waiting, on purpose";
  if (plan.action_today === "drop") return "Not worth chasing";
  return "Acting now";
}

/** Where a right's bar starts and ends on the plan's axis, as percentages. */
export function span(plan: PlanView, right: PlanRight): { left: number; width: number } {
  const total = Math.max(days(plan.today, plan.horizon), 1);
  const start = right.opens_on ? Math.max(0, days(plan.today, right.opens_on)) : 0;
  const end = right.expires_on ? Math.min(total, days(plan.today, right.expires_on)) : total;
  const left = (Math.min(start, total) / total) * 100;
  return { left, width: Math.max(((end - Math.min(start, end)) / total) * 100, 1) };
}

function describe(right: PlanRight): string {
  if (right.status === "locked") {
    const after = right.unlocked_by.map((e) => e.replaceAll("_", " ")).join(" and ");
    return `${right.label}: locked until ${after || "something happens"}`;
  }
  const opens = right.opens_on ? `, opens on ${dayWords(right.opens_on)}` : "";
  const ends = right.expires_on ? `, runs out on ${dayWords(right.expires_on)}` : "";
  return `${right.label}: ${STATUS_WORDS[right.status]}${opens}${ends}`;
}

/** Each right as a bar in time, between today and the plan's horizon. */
function RightsBars({ plan }: { plan: PlanView }) {
  return (
    <>
      <ul className="mt-4 space-y-3">
        {plan.rights.map((right) => {
          const { left, width } = span(plan, right);
          return (
            <li key={right.id}>
              <div className="flex flex-wrap justify-between gap-x-2 text-sm">
                <span className="font-medium text-slate-100">{right.label}</span>
                <span className="text-xs text-slate-400">
                  {STATUS_WORDS[right.status]}
                  {right.opens_on && right.status === "opens_later" && <> from {dayWords(right.opens_on)}</>}
                  {right.expires_on && <> · runs out {dayWords(right.expires_on)}</>} · worth {gbp(right.ev_gbp)}
                </span>
              </div>
              <div className="relative mt-1 h-2.5 rounded-full bg-white/5" role="img" aria-label={describe(right)}>
                <div className={`absolute h-2.5 rounded-full ${BAR[right.status]}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>today, {dayWords(plan.today)}</span>
        <span>{dayWords(plan.horizon)}</span>
      </p>
    </>
  );
}

/** The reasons and the numbers behind the plan. */
function Why({ plan }: { plan: PlanView }) {
  const a = plan.assumptions;
  return (
    <>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
        {plan.why.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">
        Curve <span className="font-mono">{a.hazard_id}</span>
        {a.hazard_demo_values ? " (a stand-in, not this company's own data)" : ""}. Time valued at £{a.time_value_gbp_h} an hour; an open problem costs{" "}
        {a.attention_minutes_per_week} minutes a week. Share that pays: {Math.round(Number(a.pays_share) * 100)}% ({a.pays_share_source}).
      </p>
    </>
  );
}

/** The day a mission reached a state, in words ("24 October"), or "" when the timeline does not say. */
function dayOf(mission: Pick<MissionView, "timeline">, ...states: MissionView["state"][]): string {
  for (const state of states) {
    const at = reachedAt(mission, state);
    if (at) return dayWords(at.slice(0, 10));
  }
  return "";
}

/**
 * Rights Decay: today's verdict, each right as a bar in time, and the numbers behind it. Only a
 * live mission waits or acts; a paid one is Settled and a stopped one Stopped, with what Tempo
 * weighed folded away underneath.
 */
export function RightsPortfolio({ plan, mission }: { plan: PlanView; mission?: Pick<MissionView, "state" | "outcome" | "timeline"> | null }) {
  const state = mission?.state;
  if (mission && (state === "verified" || state === "completed" || state === "declined" || state === "failed_safe")) {
    const settled = state === "verified" || state === "completed";
    const amount = mission.outcome?.amount_gbp;
    const day = settled ? dayOf(mission, "verified", "completed") : dayOf(mission, state);
    const on = day ? ` on ${day}` : "";
    const line = settled
      ? amount
        ? `Paid ${gbp(amount)}${on}. Nothing more to do.`
        : `Resolved${on}. Nothing more to do.`
      : `Stopped${on}. Nothing more will be sent.`;
    return (
      <Card as="section" aria-labelledby="rights-heading">
        <SectionTitle id="rights-heading" as="h3" right={plan.assumptions.hazard_demo_values ? <Badge tone="amber">demo values</Badge> : undefined}>
          Rights Portfolio
        </SectionTitle>
        <p className={`flex items-center gap-2 text-lg font-semibold ${settled ? "text-emerald-200" : "text-slate-300"}`}>
          {settled ? <CheckCircle2 size={18} aria-hidden className="text-emerald-300" /> : <CircleSlash size={18} aria-hidden className="text-slate-400" />}
          {settled ? "Settled" : "Stopped"}
        </p>
        <p className="mt-1 text-sm text-slate-200">{line}</p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-slate-200">What Tempo weighed</summary>
          <p className="mt-2 text-slate-300">{plan.explanation}</p>
          <RightsBars plan={plan} />
          <Why plan={plan} />
        </details>
      </Card>
    );
  }

  const today = plan.days[0];
  const waiting = plan.action_today === "wait";
  return (
    <Card as="section" aria-labelledby="rights-heading">
      <SectionTitle id="rights-heading" as="h3" right={plan.assumptions.hazard_demo_values ? <Badge tone="amber">demo values</Badge> : undefined}>
        Rights Portfolio
      </SectionTitle>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={`text-lg font-semibold ${waiting ? "text-amber-100" : "text-emerald-100"}`}>{verdict(plan)}</p>
        {plan.next_decision_on && waiting && (
          <p className="text-sm text-slate-300">
            Next decision: <strong className="text-slate-100">{dayWords(plan.next_decision_on)}</strong>
          </p>
        )}
        {!waiting && plan.way && <p className="text-sm text-slate-300">by {plan.way.replaceAll("_", " ")}</p>}
      </div>
      <p className="mt-2 text-sm text-slate-200">{plan.explanation}</p>
      {today && (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-amber-500/10 p-3">
            <dt className="text-xs text-slate-300">At stake if you do nothing</dt>
            <dd className="text-xl font-semibold tabular-nums text-amber-100">{gbp(today.value_at_risk_gbp)}</dd>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <dt className="text-xs text-slate-300">Cost of one more day of waiting</dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-100">{gbp(today.cost_of_delay_gbp)}</dd>
          </div>
        </dl>
      )}
      <RightsBars plan={plan} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-200">Why</summary>
        <Why plan={plan} />
      </details>
    </Card>
  );
}
