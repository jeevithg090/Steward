import { ChevronRight } from "lucide-react";
import { RAIL, SkillIcon, amountTone, amountWord, gbp, isLive, missionAmount, personWords, plainMessage, shortDateTime, skillWords, startedAt, stateTone } from "@/components/mission";
import { Badge, FOCUS } from "@/components/ui";
import type { MissionView } from "@/lib/api";
import { STATE_LABELS } from "@/lib/labels";
import { linkProps } from "@/router";

/** "waiting on purpose" or "acting now": only while the mission is still live (plan.md §12.1 finding 6). */
export function planWords(m: MissionView): string | null {
  if (!m.plan || !isLive(m.state)) return null;
  if (m.plan.action_today === "wait") return "waiting on purpose";
  if (m.plan.action_today === "drop") return null;
  return "acting now";
}

/**
 * One card per mission, newest first, each one big link: a rail in the state's colour, the skill
 * in words with its state, the mission's own words, who and when, and the amount on the right.
 */
export function MissionList({ missions }: { missions: MissionView[] }) {
  return (
    <ul aria-label="Missions" className="stagger space-y-3">
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
              className={`surface group relative flex items-start gap-4 overflow-hidden rounded-3xl py-4 pl-5 pr-4 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:items-center sm:gap-5 sm:py-5 sm:pl-6 sm:pr-5 ${FOCUS}`}
            >
              <span aria-hidden className={`absolute inset-y-4 left-0 w-[3px] rounded-r-full ${RAIL[tone]}`} />
              <span className="hidden sm:block">
                <SkillIcon skillId={m.skill_id} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <span className="text-[15px] font-semibold tracking-[-0.01em] text-white">{skillWords(m.skill_id)}</span>
                    <Badge tone={tone} dot>
                      {state}
                    </Badge>
                    {plan && <Badge tone="indigo">{plan}</Badge>}
                  </div>
                  {amount && (
                    <div className="shrink-0 text-right sm:hidden">
                      <span className={`num block text-xl font-semibold leading-none tracking-[-0.02em] ${amountTone(m.state)}`}>{gbp(amount)}</span>
                      <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{amountWord(m.state)}</span>
                    </div>
                  )}
                </div>
                {message && <p className="mt-1.5 line-clamp-2 max-w-3xl text-sm leading-relaxed text-slate-400">{message}</p>}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                  <span className="font-medium text-slate-300">{personWords(m.user_id)}</span>
                  {when && (
                    <>
                      <span aria-hidden className="text-slate-600">
                        ·
                      </span>
                      <span className="num">{shortDateTime(when)}</span>
                    </>
                  )}
                  <span aria-hidden className="text-slate-600">
                    ·
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{m.id}</span>
                </p>
              </div>
              <div className="hidden shrink-0 items-center gap-2 self-center sm:flex">
                {amount && (
                  <div className="min-w-[5.5rem] text-right">
                    <span className={`num block text-2xl font-semibold leading-none tracking-[-0.02em] ${amountTone(m.state)}`}>{gbp(amount)}</span>
                    <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{amountWord(m.state)}</span>
                  </div>
                )}
                <ChevronRight
                  size={18}
                  aria-hidden
                  className="text-slate-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-300 motion-reduce:transition-none"
                />
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
