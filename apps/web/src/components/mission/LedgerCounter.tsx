import type { ReactNode } from "react";
import { BadgeCheck, Hourglass, PoundSterling } from "lucide-react";
import { Card, useCountUp } from "@/components/ui";
import type { LedgerTotals } from "@/lib/api";

/**
 * A ledger number, counted up. What a screen reader hears (and a test finds) is the settled value;
 * the counting digits are drawn one per span beside it and hidden from assistive tech, so nothing
 * ever reads "£12.07" mid-count. (Stat's own count-up puts the value in an aria-label on a <p>,
 * which axe refuses, and shows the half-counted text to tests.)
 */
function Counted({ value, prefix = "" }: { value: string; prefix?: string }) {
  const shown = useCountUp(value);
  return (
    <>
      <span className="sr-only">
        {prefix}
        {value}
      </span>
      <span aria-hidden>
        {[...`${prefix}${shown}`].map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </span>
    </>
  );
}

/** One of the ledger's two numbers, in Stat's look: a label, then a 2-rem gold figure. */
function Figure({ label, value, prefix = "", icon, className = "" }: { label: string; value: string; prefix?: string; icon: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {icon}
        {label}
      </dt>
      <dd aria-live="polite" className="num mt-2.5 text-[2.25rem] font-semibold leading-none tracking-[-0.025em] text-gold sm:text-[2.5rem]">
        <Counted value={value} prefix={prefix} />
      </dd>
    </div>
  );
}

/** The Time Ledger: hours and pounds returned, counted only once the money arrived. */
export function LedgerCounter({ totals, compact = false, counted = false }: { totals: LedgerTotals | null; compact?: boolean; counted?: boolean }) {
  const hours = totals?.hours_returned ?? "0.0";
  const pounds = totals?.gbp_recovered ?? "0.00";
  if (compact) {
    return (
      <dl aria-label="Time Ledger" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
        <div className="flex items-center gap-1.5">
          <Hourglass size={12} aria-hidden className="text-gold-300" />
          <dt className="sr-only">Hours returned</dt>
          <dd>
            <span className="num font-semibold text-gold">{counted ? <Counted value={hours} /> : hours}</span> hours back
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <PoundSterling size={12} aria-hidden className="text-gold-300" />
          <dt className="sr-only">Pounds recovered</dt>
          <dd>
            <span className="num font-semibold text-gold">{counted ? <Counted value={pounds} prefix="£" /> : `£${pounds}`}</span> recovered
          </dd>
        </div>
      </dl>
    );
  }
  return (
    <Card as="section" aria-label="Time Ledger" tone="gold" padding="none" className="relative overflow-hidden">
      {/* Late light from the upper right, and a lit top edge: the ledger is where the golden hour lands. */}
      <span aria-hidden className="pointer-events-none absolute -right-20 -top-32 h-72 w-72 rounded-full bg-gold-400/[0.14] blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-gold-200/60 to-transparent" />
      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8 lg:px-7 lg:py-6">
        <dl className="grid grid-cols-2 gap-6 sm:flex sm:gap-0">
          <Figure label="Hours of life returned" value={hours} icon={<Hourglass size={12} aria-hidden className="text-gold-300" />} className="sm:pr-10" />
          <Figure
            label="Pounds recovered"
            value={pounds}
            prefix="£"
            icon={<PoundSterling size={12} aria-hidden className="text-gold-300" />}
            className="border-l border-gold-300/15 pl-6 sm:pl-10"
          />
        </dl>
        <p className="flex items-center gap-2.5 self-start rounded-full border border-gold-300/20 bg-ink/40 py-2 pl-3 pr-4 text-[13px] leading-snug text-gold-100 sm:self-center">
          <BadgeCheck size={16} aria-hidden className="shrink-0 text-gold-300" />
          <span>Counted only once the money arrived.</span>
        </p>
      </div>
    </Card>
  );
}
