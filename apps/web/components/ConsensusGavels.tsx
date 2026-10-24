import type { CourtDecision } from "@/lib/api";

/** Three models from three providers vote on eligibility; the amount is never up for a vote. */
export function ConsensusGavels({ court }: { court: CourtDecision | null }) {
  return (
    <section aria-labelledby="court-heading">
      <h2 id="court-heading" className="mb-2 text-lg font-semibold">Consensus Court</h2>
      {court === null ? (
        <p className="text-slate-700">Not needed: the rule is clear, so no models were asked.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {court.verdicts.map((v) => (
              <li key={v.juror} className="rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-sm">
                <p className="font-semibold">{v.juror}</p>
                <p>{v.verdict.eligible ? "⚖️ eligible" : "✗ not eligible"}</p>
              </li>
            ))}
            {court.absent.map((name) => (
              <li key={name} className="rounded-lg border-2 border-dashed border-slate-300 px-3 py-2 text-sm">
                <p className="font-semibold">{name}</p>
                <p>— absent</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-slate-700">
            {Math.round(court.agreement_rate * 100)}% agreement
            {court.flags.length > 0 && <> · {court.flags.join("; ")}</>}
          </p>
        </>
      )}
    </section>
  );
}
