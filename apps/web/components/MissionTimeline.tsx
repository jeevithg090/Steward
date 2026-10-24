import type { MissionView } from "@/lib/api";
import { STATE_LABELS } from "./labels";

export function duration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Each stage the mission reached and how long it stayed there (the last one is still running). */
export function MissionTimeline({ mission }: { mission: MissionView }) {
  const stages = mission.timeline;
  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="mb-2 text-lg font-semibold">Timeline</h2>
      <ol className="space-y-1">
        {stages.map((entry, i) => {
          const next = stages[i + 1];
          return (
            <li key={`${entry.to}-${i}`} className="flex justify-between gap-4 border-l-4 border-teal-700 pl-3">
              <span>{STATE_LABELS[entry.to]}</span>
              <span className="tabular-nums text-slate-600">{next ? duration(next.latency_ms) : "now"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
