import type { PlanRight, PlanView, RightStatus } from "@/lib/api";

const DAY_MS = 86_400_000;

const STATUS_WORDS: Record<RightStatus, string> = {
  chosen: "using it now",
  open: "open",
  opens_later: "opens later",
  locked: "locked",
  expired: "ran out",
};

const BAR: Record<RightStatus, string> = {
  chosen: "bg-teal-700",
  open: "bg-teal-300",
  opens_later: "bg-slate-300",
  locked: "bg-[repeating-linear-gradient(45deg,#cbd5e1_0_6px,#f1f5f9_6px_12px)]",
  expired: "bg-slate-200",
};

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function day(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

function gbp(value: string): string {
  return `£${Number(value).toFixed(2)}`;
}

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
  const opens = right.opens_on ? `, opens on ${day(right.opens_on)}` : "";
  const ends = right.expires_on ? `, runs out on ${day(right.expires_on)}` : "";
  return `${right.label}: ${STATUS_WORDS[right.status]}${opens}${ends}`;
}

/** Rights Decay: each right as a bar in time, today's verdict, and the numbers behind it. */
export function RightsPortfolio({ plan }: { plan: PlanView }) {
  const today = plan.days[0];
  const a = plan.assumptions;
  return (
    <section aria-labelledby="rights-heading" className="rounded-xl border-2 border-slate-300 bg-white p-4">
      <h2 id="rights-heading" className="text-lg font-semibold">Rights Portfolio</h2>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
        <p className="text-2xl font-bold text-teal-900">{verdict(plan)}</p>
        {plan.next_decision_on && plan.action_today === "wait" && (
          <p className="text-slate-700">Next decision: <strong>{day(plan.next_decision_on)}</strong></p>
        )}
      </div>
      <p className="mt-2 text-lg">{plan.explanation}</p>
      {today && (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-amber-50 p-3">
            <dt className="text-sm text-slate-700">At stake if you do nothing</dt>
            <dd className="text-2xl font-bold tabular-nums">{gbp(today.value_at_risk_gbp)}</dd>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <dt className="text-sm text-slate-700">Cost of one more day of waiting</dt>
            <dd className="text-2xl font-bold tabular-nums">{gbp(today.cost_of_delay_gbp)}</dd>
          </div>
        </dl>
      )}
      <ul className="mt-4 space-y-3">
        {plan.rights.map((right) => {
          const { left, width } = span(plan, right);
          return (
            <li key={right.id}>
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{right.label}</span>
                <span className="text-slate-600">
                  {STATUS_WORDS[right.status]} · worth {gbp(right.ev_gbp)}
                </span>
              </div>
              <div className="relative mt-1 h-3 rounded bg-slate-100" role="img" aria-label={describe(right)}>
                <div className={`absolute h-3 rounded ${BAR[right.status]}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 flex justify-between text-xs text-slate-500">
        <span>today, {day(plan.today)}</span>
        <span>{day(plan.horizon)}</span>
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">Why</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {plan.why.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-600">
          Curve {a.hazard_id}{a.hazard_demo_values ? " (a stand-in, not this company's own data)" : ""}.
          Time valued at £{a.time_value_gbp_h} an hour; an open problem costs {a.attention_minutes_per_week} minutes a week.
        </p>
      </details>
    </section>
  );
}
