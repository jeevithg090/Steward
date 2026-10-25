import { Hourglass, PoundSterling } from "lucide-react";
import { Card } from "@/components/ui";
import type { LedgerTotals } from "@/lib/api";

/** The Time Ledger: hours and pounds returned, counted only once the money arrived. */
export function LedgerCounter({ totals, compact = false }: { totals: LedgerTotals | null; compact?: boolean }) {
  const hours = totals?.hours_returned ?? "0.0";
  const pounds = totals?.gbp_recovered ?? "0.00";
  if (compact) {
    return (
      <dl aria-label="Time Ledger" className="flex flex-wrap gap-4 text-xs text-slate-300">
        <div className="flex items-center gap-1.5">
          <Hourglass size={12} aria-hidden className="text-indigo-300" />
          <dt className="sr-only">Hours returned</dt>
          <dd>
            <span className="font-semibold tabular-nums text-slate-100">{hours}</span> hours back
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <PoundSterling size={12} aria-hidden className="text-emerald-300" />
          <dt className="sr-only">Pounds recovered</dt>
          <dd>
            <span className="font-semibold tabular-nums text-slate-100">£{pounds}</span> recovered
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <Card as="section" aria-label="Time Ledger" padding="tight" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Hours of life returned</dt>
          <dd aria-live="polite" className="text-2xl font-semibold tabular-nums text-indigo-100">
            {hours}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pounds recovered</dt>
          <dd aria-live="polite" className="text-2xl font-semibold tabular-nums text-emerald-100">
            £{pounds}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-slate-400">Counted only once the money arrived.</p>
    </Card>
  );
}
