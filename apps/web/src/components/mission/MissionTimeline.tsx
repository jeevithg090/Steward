import { Activity, Check, X } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type { MissionState, MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import { PanelHeading } from "./look";
import { duration, isLive, shortDateTime } from "./words";

/** How a step looks: done (emerald), the current step (violet, glowing), waiting (amber) or stopped (rose). */
type Step = "done" | "current" | "waiting" | "stopped";

const WAITS: ReadonlySet<MissionState> = new Set<MissionState>(["awaiting_consent", "waiting", "checkpoint"]);

function stepOf(isLast: boolean, missionState: MissionState): Step {
  if (!isLast) return "done";
  if (isLive(missionState)) return WAITS.has(missionState) ? "waiting" : "current";
  return missionState === "declined" || missionState === "failed_safe" ? "stopped" : "done";
}

const RING: Record<Step, string> = {
  done: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/45",
  current: "bg-violet-500/25 ring-violet-300/70 shadow-[0_0_0_4px_rgb(139_92_246/0.14),0_0_22px_rgb(139_92_246/0.55)]",
  waiting: "bg-amber-400/20 ring-amber-300/60 shadow-[0_0_0_4px_rgb(251_191_36/0.1),0_0_20px_rgb(251_191_36/0.4)]",
  stopped: "bg-rose-500/15 text-rose-200 ring-rose-300/45",
};

const PULSE: Partial<Record<Step, string>> = { current: "bg-violet-400/40", waiting: "bg-amber-400/35" };
const CORE: Partial<Record<Step, string>> = { current: "bg-violet-200", waiting: "bg-amber-200" };

/** Each state the mission reached, as a vertical stepper: when, how long the step before it took, and the person's decision. */
export function MissionTimeline({ mission, personName = "Margaret" }: { mission: MissionView; personName?: string }) {
  const stages = mission.timeline;
  return (
    <Card as="section" aria-labelledby="timeline-heading">
      <PanelHeading id="timeline-heading" icon={<Activity size={16} />} title="Timeline" />
      {stages.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing has happened yet.</p>
      ) : (
        <ol>
          {stages.map((entry, i) => {
            const last = i === stages.length - 1;
            const step = stepOf(last, mission.state);
            // The step into "running" after "awaiting_consent" is how long the person took to decide.
            const decided = entry.to === "running" && stages[i - 1]?.to === "awaiting_consent";
            const nextStep = last ? null : stepOf(i + 1 === stages.length - 1, mission.state);
            return (
              <li key={`${entry.to}-${i}`} className="relative flex gap-3.5 pb-5 last:pb-0">
                {!last && (
                  <span
                    aria-hidden
                    className={`absolute bottom-0 left-[13px] top-8 w-0.5 rounded-full bg-gradient-to-b ${
                      nextStep === "current" ? "from-emerald-400/50 to-violet-400/60" : nextStep === "waiting" ? "from-emerald-400/50 to-amber-400/60" : nextStep === "stopped" ? "from-emerald-400/50 to-rose-400/50" : "from-emerald-400/50 to-emerald-400/30"
                    }`}
                  />
                )}
                <span aria-hidden className={`relative grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset ${RING[step]}`}>
                  {PULSE[step] && <span className={`absolute inset-0 rounded-full motion-safe:animate-ripple ${PULSE[step]}`} />}
                  {step === "done" && <Check size={13} strokeWidth={2.75} />}
                  {step === "stopped" && <X size={13} strokeWidth={2.75} />}
                  {CORE[step] && <span className={`relative h-2.5 w-2.5 rounded-full ${CORE[step]}`} />}
                </span>
                <div className="min-w-0 flex-1 pt-[3px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-sm leading-snug ${last ? "font-semibold text-white" : decided ? "font-semibold text-amber-100" : "text-slate-200"}`}>{STATE_LABELS[entry.to] ?? entry.to}</span>
                    {last && (step === "current" || step === "waiting") && (
                      <Badge tone={step === "current" ? "indigo" : "amber"} className="!px-2 !py-0 !text-[10px] uppercase !tracking-[0.12em]">
                        now
                      </Badge>
                    )}
                  </div>
                  <p className="num mt-0.5 text-xs text-slate-400">
                    {shortDateTime(entry.at)}
                    {entry.latency_ms > 0 && <> · {duration(entry.latency_ms)}</>}
                  </p>
                  {decided && (
                    <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/[0.08] px-2.5 py-1.5 text-xs text-amber-100">
                      How long {personName} took to decide: {duration(entry.latency_ms)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
