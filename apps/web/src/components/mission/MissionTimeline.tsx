import { Card, SectionTitle } from "@/components/ui";
import type { MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import { duration, shortDateTime, stateTone } from "./words";

const DOT: Record<string, string> = {
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  indigo: "bg-indigo-400",
  purple: "bg-purple-400",
  slate: "bg-slate-400",
};

/** Each state the mission reached, when, and how long the step before it took; the person's decision stands out. */
export function MissionTimeline({ mission, personName = "Margaret" }: { mission: MissionView; personName?: string }) {
  const stages = mission.timeline;
  return (
    <Card as="section" aria-labelledby="timeline-heading">
      <SectionTitle id="timeline-heading" as="h3">
        Timeline
      </SectionTitle>
      {stages.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing has happened yet.</p>
      ) : (
        <ol className="relative ml-2 space-y-3 border-l border-white/10 pl-5">
          {stages.map((entry, i) => {
            // The step into "running" after "awaiting_consent" is how long the person took to decide.
            const decided = entry.to === "running" && stages[i - 1]?.to === "awaiting_consent";
            const tone = stateTone(entry.to);
            return (
              <li key={`${entry.to}-${i}`} className="relative">
                <span aria-hidden className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[tone]}`} />
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className={`text-sm ${decided ? "font-semibold text-amber-100" : "text-slate-200"}`}>{STATE_LABELS[entry.to] ?? entry.to}</span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {shortDateTime(entry.at)}
                    {entry.latency_ms > 0 && <> · {duration(entry.latency_ms)}</>}
                  </span>
                </div>
                {decided && <p className="text-xs text-amber-200">How long {personName} took to decide: {duration(entry.latency_ms)}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
