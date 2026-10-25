import { CalendarClock, CheckCircle2, ChevronRight, CircleSlash, Hourglass, Zap } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type { MissionView, PlanRight, PlanView, RightStatus } from "@/lib/api";
import { PanelHeading } from "./look";
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
  chosen: "bg-gradient-to-r from-violet-500 to-violet-300 shadow-[0_0_14px_rgb(139_92_246/0.6)]",
  open: "bg-gradient-to-r from-emerald-500/80 to-emerald-300/90",
  opens_later: "bg-slate-500/80",
  locked: "bg-[repeating-linear-gradient(45deg,rgba(148,163,184,0.5)_0_6px,rgba(148,163,184,0.15)_6px_12px)]",
  expired: "bg-rose-500/45",
};

const STATUS_TONE: Record<RightStatus, "indigo" | "emerald" | "slate" | "rose"> = {
  chosen: "indigo",
  open: "emerald",
  opens_later: "slate",
  locked: "slate",
  expired: "rose",
};

/** The open/close look of a <details> summary: a chevron that turns, no browser marker. */
const SUMMARY =
  "flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full py-1 pr-2 text-[13px] font-semibold text-slate-200 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none [&::-webkit-details-marker]:hidden";

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
    <div className="mt-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <ul className="space-y-4">
        {plan.rights.map((right) => {
          const { left, width } = span(plan, right);
          return (
            <li key={right.id}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-slate-100">{right.label}</span>
                  <Badge tone={STATUS_TONE[right.status]}>{STATUS_WORDS[right.status]}</Badge>
                </span>
                <span className="num text-xs text-slate-400">
                  {right.opens_on && right.status === "opens_later" && <>from {dayWords(right.opens_on)} · </>}
                  {right.expires_on && <>runs out {dayWords(right.expires_on)} · </>}worth <span className="font-semibold text-slate-200">{gbp(right.ev_gbp)}</span>
                </span>
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-white/[0.06]" role="img" aria-label={describe(right)}>
                <div className={`absolute h-2 rounded-full ${BAR[right.status]}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex justify-between border-t border-white/[0.06] pt-2 text-[11px] text-slate-400">
        <span>today, {dayWords(plan.today)}</span>
        <span>{dayWords(plan.horizon)}</span>
      </p>
    </div>
  );
}

/** The reasons and the numbers behind the plan. */
function Why({ plan }: { plan: PlanView }) {
  const a = plan.assumptions;
  return (
    <>
      <ul className="mt-3 space-y-1.5 text-slate-300">
        {plan.why.map((line) => (
          <li key={line} className="flex gap-2.5 leading-relaxed">
            <span aria-hidden className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-violet-300" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-2xl bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-slate-400">
        Curve <span className="font-mono text-slate-300">{a.hazard_id}</span>
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

const demoBadge = (plan: PlanView) =>
  plan.assumptions.hazard_demo_values ? (
    <Badge tone="amber" dot>
      demo values
    </Badge>
  ) : undefined;

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
        <PanelHeading id="rights-heading" icon={<CalendarClock size={16} />} title="Rights Portfolio" right={demoBadge(plan)} />
        <div className={`flex items-center gap-3.5 rounded-2xl border px-4 py-3.5 ${settled ? "border-emerald-400/20 bg-emerald-500/[0.07]" : "border-white/[0.08] bg-white/[0.03]"}`}>
          {settled ? <CheckCircle2 size={22} aria-hidden className="shrink-0 text-emerald-300" /> : <CircleSlash size={22} aria-hidden className="shrink-0 text-slate-400" />}
          <div className="min-w-0">
            <p className={`text-lg font-semibold leading-tight ${settled ? "text-emerald-100" : "text-slate-200"}`}>{settled ? "Settled" : "Stopped"}</p>
            <p className="mt-0.5 text-sm text-slate-300">{line}</p>
          </div>
        </div>
        <details className="group mt-4 text-sm">
          <summary className={SUMMARY}>
            <ChevronRight size={15} aria-hidden className="text-slate-400 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" />
            What Tempo weighed
          </summary>
          <p className="mt-3 leading-relaxed text-slate-300">{plan.explanation}</p>
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
      <PanelHeading id="rights-heading" icon={<CalendarClock size={16} />} title="Rights Portfolio" right={demoBadge(plan)} />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className={`flex items-center gap-2.5 text-xl font-semibold tracking-[-0.01em] ${waiting ? "text-amber-100" : "text-emerald-100"}`}>
          {waiting ? <Hourglass size={20} aria-hidden className="text-amber-300" /> : <Zap size={20} aria-hidden className="text-emerald-300" />}
          {verdict(plan)}
        </p>
        {plan.next_decision_on && waiting && (
          <p className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-300">
            Next decision: <strong className="font-semibold text-white">{dayWords(plan.next_decision_on)}</strong>
          </p>
        )}
        {!waiting && plan.way && <p className="text-sm text-slate-300">by {plan.way.replaceAll("_", " ")}</p>}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{plan.explanation}</p>
      {today && (
        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.08] p-4">
            <dt className="text-xs leading-snug text-amber-100/90">At stake if you do nothing</dt>
            <dd className="num mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-amber-100">{gbp(today.value_at_risk_gbp)}</dd>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <dt className="text-xs leading-snug text-slate-300">Cost of one more day of waiting</dt>
            <dd className="num mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-white">{gbp(today.cost_of_delay_gbp)}</dd>
          </div>
        </dl>
      )}
      <RightsBars plan={plan} />
      <details className="group mt-4 text-sm">
        <summary className={SUMMARY}>
          <ChevronRight size={15} aria-hidden className="text-slate-400 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" />
          Why
        </summary>
        <Why plan={plan} />
      </details>
    </Card>
  );
}
