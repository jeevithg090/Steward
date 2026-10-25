import { ChevronRight } from "lucide-react";
import { gbp, isLive, missionAmount, personWords, plainMessage, shortDateTime, skillWords, startedAt, stateTone } from "@/components/mission";
import { Badge, type BadgeTone, FOCUS } from "@/components/ui";
import type { MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import { linkProps } from "@/router";

/** The state's colour down the card's edge (plan.md §4.7's accents). */
const EDGE: Record<BadgeTone, string> = {
  emerald: "before:bg-emerald-400",
  amber: "before:bg-amber-400",
  rose: "before:bg-rose-500",
  indigo: "before:bg-indigo-400",
  purple: "before:bg-purple-400",
  slate: "before:bg-slate-500",
};

/** "waiting on purpose" or "acting now": only while the mission is still live (plan.md §12.1 finding 6). */
export function planWords(m: MissionView): string | null {
  if (!m.plan || !isLive(m.state)) return null;
  if (m.plan.action_today === "wait") return "waiting on purpose";
  if (m.plan.action_today === "drop") return null;
  return "acting now";
}

/** One card per mission, newest first, each one big link: state, skill in words, the amount, the person, when. */
export function MissionList({ missions }: { missions: MissionView[] }) {
  return (
    <ul aria-label="Missions" className="space-y-3">
      {missions.map((m) => {
        const amount = missionAmount(m);
        const when = startedAt(m);
        const link = linkProps(`/missions/${m.id}`);
        const tone = stateTone(m.state);
        const state = STATE_LABELS[m.state] ?? m.state;
        const plan = planWords(m);
        const message = plainMessage(m.outcome?.message ?? m.message);
        return (
          <li key={m.id}>
            <a
              {...link}
              aria-label={`${skillWords(m.skill_id)} for ${personWords(m.user_id)}${amount ? `, ${gbp(amount)}` : ""}: ${state}`}
              className={`relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-nexus-card py-3 pl-5 pr-3 transition-colors before:absolute before:inset-y-0 before:left-0 before:w-1.5 hover:border-white/20 hover:bg-white/[0.06] motion-reduce:transition-none sm:gap-4 sm:pr-4 ${EDGE[tone]} ${FOCUS}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-slate-100">{skillWords(m.skill_id)}</span>
                  <Badge tone={tone}>{state}</Badge>
                  {plan && <Badge tone="purple">{plan}</Badge>}
                </div>
                {message && <p className="mt-1 line-clamp-2 text-sm text-slate-300">{message}</p>}
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                  <span>{personWords(m.user_id)}</span>
                  {when && <span>{shortDateTime(when)}</span>}
                  <span className="font-mono text-slate-500">{m.id}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {amount && <span className={`text-lg font-semibold tabular-nums ${m.state === "verified" ? "text-emerald-200" : isLive(m.state) ? "text-slate-100" : "text-slate-400 line-through decoration-slate-500/60"}`}>{gbp(amount)}</span>}
                <ChevronRight size={18} aria-hidden className="text-slate-500" />
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
