import type { LiveEvent } from "@/lib/live";

/** Stalling tactics as the Negotiator hears them, with the counter-play (spec §10). */
export function StallRadar({ events }: { events: LiveEvent[] }) {
  const stalls = events.filter((e) => e.type === "log_stall");
  return (
    <section aria-labelledby="stall-heading">
      <h2 id="stall-heading" className="mb-2 text-lg font-semibold">Stall Radar</h2>
      {stalls.length === 0 ? (
        <p className="text-slate-700">No stalling yet.</p>
      ) : (
        <ul aria-live="polite" className="space-y-2">
          {stalls.map((s, i) => (
            <li key={i} className="rounded-lg border-l-4 border-rose-700 bg-rose-50 p-2">
              <p className="font-semibold">{String(s.category).replaceAll("_", " ")}</p>
              <p className="text-sm italic">“{String(s.quote)}”</p>
              {s.counter ? <p className="text-sm">→ {String(s.counter)}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
