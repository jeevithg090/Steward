import { Check, Scale, UserX, X } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import type { CourtDecision } from "@/lib/api";
import { PanelHeading } from "./look";

const OUTCOME_WORDS: Record<CourtDecision["outcome"], string> = {
  proceed: "Agreed",
  proceed_flagged: "Agreed, with a flag",
  human_checkpoint: "A person should look",
};

type Verdict = CourtDecision["verdicts"][number]["verdict"] & { reasoning?: string | null };

/** The juror's one-line reason when the Gateway sends one, else the rule it judged against. */
function reason(verdict: Verdict): string {
  const said = typeof verdict.reasoning === "string" ? verdict.reasoning.trim() : "";
  return said || `Judged against ${verdict.rule_id}.`;
}

/** Three different models vote on eligibility; the amount is never up for a vote. */
export function CourtVotes({ court, id = "court-heading", bare = false }: { court: CourtDecision | null; id?: string; bare?: boolean }) {
  const agreed = court ? Math.round(court.agreement_rate * 100) : 0;
  const clear = court?.outcome === "proceed";
  const body = (
    <>
      <PanelHeading
        id={id}
        icon={<Scale size={16} />}
        title="Consensus Court"
        sub="Separate models check eligibility. The amount is never up for a vote."
        right={
          court ? (
            <Badge tone={clear ? "emerald" : "amber"} dot>
              {OUTCOME_WORDS[court.outcome]}
            </Badge>
          ) : undefined
        }
      />
      {court === null ? (
        <p className="flex items-start gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-slate-300">
          <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
          <span>Not needed: the rule is clear, so no models were asked.</span>
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-3">
            {court.verdicts.map((v) => {
              const yes = v.verdict.eligible;
              const sure = Math.round(v.verdict.confidence * 100);
              return (
                <li
                  key={v.juror}
                  className={`relative flex min-w-0 flex-col overflow-hidden rounded-2xl border p-4 ${yes ? "border-emerald-400/20 bg-gradient-to-b from-emerald-500/[0.09] to-transparent" : "border-rose-400/25 bg-gradient-to-b from-rose-500/[0.1] to-transparent"}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset ${yes ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/40" : "bg-rose-400/15 text-rose-200 ring-rose-300/40"}`}
                    >
                      {yes ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                    </span>
                    <p className="min-w-0 break-all font-mono text-[12px] leading-tight text-slate-100">{v.juror}</p>
                  </div>
                  <p className={`mt-3 text-sm font-semibold ${yes ? "text-emerald-200" : "text-rose-200"}`}>{yes ? "Eligible" : "Not eligible"}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span aria-hidden className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <span className={`block h-full rounded-full ${yes ? "bg-emerald-300/80" : "bg-rose-300/80"}`} style={{ width: `${sure}%` }} />
                    </span>
                    <span className="num shrink-0 text-[11px] text-slate-400">{sure}% sure</span>
                  </div>
                  <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-slate-400">{reason(v.verdict)}</p>
                </li>
              );
            })}
            {court.absent.map((name) => (
              <li key={name} className="flex min-w-0 flex-col rounded-2xl border border-dashed border-white/20 p-4 text-slate-400" title={`${name} did not answer`}>
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-dashed border-white/25 text-slate-400">
                    <UserX size={13} />
                  </span>
                  <p className="min-w-0 break-all font-mono text-[12px] leading-tight text-slate-300">{name}</p>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-300">absent</p>
                <p className="mt-2.5 text-xs leading-relaxed text-slate-400">Didn&apos;t answer, so it had no vote.</p>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <Scale size={13} aria-hidden className="text-violet-300" />
              <span className="font-semibold text-slate-200">{agreed}% agreement</span>
              {court.eligible !== null && <span>· {court.eligible ? "eligible" : "not eligible"}</span>}
              {court.flags.length > 0 && <span className="text-amber-200">· {court.flags.join("; ")}</span>}
            </p>
            <span aria-hidden className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <span
                className={`block h-full rounded-full ${clear ? "bg-gradient-to-r from-emerald-400/70 to-emerald-300 shadow-[0_0_12px_rgb(52_211_153/0.6)]" : "bg-gradient-to-r from-amber-400/70 to-amber-300 shadow-[0_0_12px_rgb(251_191_36/0.5)]"}`}
                style={{ width: `${agreed}%` }}
              />
            </span>
          </div>
        </>
      )}
    </>
  );
  if (bare) return <section aria-labelledby={id}>{body}</section>;
  return (
    <Card as="section" aria-labelledby={id}>
      {body}
    </Card>
  );
}
