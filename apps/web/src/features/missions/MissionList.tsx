import { ChevronRight } from "lucide-react";
import { gbp, missionAmount, personWords, shortDateTime, skillWords, startedAt, stateTone } from "@/components/mission";
import { Badge, Card, FOCUS } from "@/components/ui";
import type { MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import { linkProps } from "@/router";

/** One card per mission, newest first: state, skill in words, the amount, the person, when. */
export function MissionList({ missions }: { missions: MissionView[] }) {
  return (
    <ul aria-label="Missions" className="space-y-3">
      {missions.map((m) => {
        const amount = missionAmount(m);
        const when = startedAt(m);
        const link = linkProps(`/missions/${m.id}`);
        return (
          <Card as="li" key={m.id} padding="none">
            <a {...link} className={`flex items-center gap-4 rounded-2xl px-4 py-3 hover:bg-white/5 ${FOCUS}`} aria-label={`${skillWords(m.skill_id)} for ${personWords(m.user_id)}: ${STATE_LABELS[m.state]}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={stateTone(m.state)}>{STATE_LABELS[m.state] ?? m.state}</Badge>
                  <span className="text-sm font-semibold text-slate-100">{skillWords(m.skill_id)}</span>
                  {m.plan && <Badge tone="purple">{m.plan.action_today === "wait" ? "waiting on purpose" : "acting"}</Badge>}
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  <span>{personWords(m.user_id)}</span>
                  {when && <span>{shortDateTime(when)}</span>}
                  <span className="font-mono">{m.id}</span>
                </p>
                {(m.outcome?.message ?? m.message) && <p className="mt-1 line-clamp-2 text-xs text-slate-300">{m.outcome?.message ?? m.message}</p>}
              </div>
              <div className="shrink-0 text-right">
                {amount && <p className={`text-lg font-semibold tabular-nums ${m.state === "verified" ? "text-emerald-200" : "text-slate-100"}`}>{gbp(amount)}</p>}
                <ChevronRight size={16} aria-hidden className="ml-auto text-slate-500" />
              </div>
            </a>
          </Card>
        );
      })}
    </ul>
  );
}
