export interface Juror {
  model: string;
  vote: "eligible" | "not eligible" | "absent";
}

/** Three models from three providers vote on eligibility; the amount is never up for a vote. */
export function ConsensusGavels({ jurors }: { jurors: Juror[] | null }) {
  return (
    <section aria-labelledby="court-heading">
      <h2 id="court-heading" className="mb-2 text-lg font-semibold">Consensus Court</h2>
      {jurors === null ? (
        <p className="text-slate-700">Not needed: the rule is clear, so no models were asked.</p>
      ) : (
        <ul className="flex gap-2">
          {jurors.map((j) => (
            <li key={j.model} className="rounded-lg border-2 border-slate-300 px-3 py-2 text-sm">
              <p className="font-semibold">{j.model}</p>
              <p>{j.vote === "eligible" ? "⚖️ eligible" : j.vote === "absent" ? "— absent" : "✗ not eligible"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
