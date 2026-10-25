import { FileText, Volume2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { type LetterReading, directionWords, kindWords, longDate } from "@/lib/letters";

/** One letter, read back in plain words, inside the chat: what it is, what it says, who owes what, what to do by when, the clocks it starts. */
export function LetterReadingCard({ reading, onSpeak }: { reading: LetterReading; onSpeak?: (text: string) => void }) {
  const money = reading.money.amount_gbp ? `${directionWords(reading.money.direction)}: £${reading.money.amount_gbp}` : directionWords(reading.money.direction);
  return (
    <section aria-label="Letter reading" lang={reading.language} className="mt-3 space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText size={16} aria-hidden className="text-indigo-300" />
        <h2 className="text-sm font-semibold text-slate-100">
          {kindWords(reading.kind)} from {reading.sender}
          {reading.date ? `, dated ${longDate(reading.date)}` : ""}
        </h2>
        {reading.sample ? <Badge tone="amber">sample, written by hand</Badge> : <Badge tone="indigo">read by Tempo</Badge>}
        {reading.simulated?.length ? <Badge tone="amber">vision replayed</Badge> : null}
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">What it says</dt>
          <dd className="text-slate-200">{reading.says}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Money</dt>
          <dd className={reading.money.direction === "owed_to_you" ? "text-emerald-200" : reading.money.direction === "you_owe" ? "text-amber-200" : "text-slate-200"}>{money}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">What to do</dt>
          <dd className="text-slate-200">
            {reading.must_do}
            {reading.by && <strong className="block text-slate-100">By {longDate(reading.by)}.</strong>}
          </dd>
        </div>
        {reading.clocks.length > 0 && (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">The clocks this letter starts</dt>
            <dd>
              <ul className="list-disc pl-5 text-slate-200">
                {reading.clocks.map((c) => (
                  <li key={c.id}>
                    {c.label}: runs out on {longDate(c.expires_on)}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {reading.unsure.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">One thing I wasn&apos;t sure of</dt>
            <dd>
              <ul className="list-disc pl-5 text-amber-100">
                {reading.unsure.map((u) => (
                  <li key={u.key}>{u.question}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      {onSpeak && (
        <Button variant="quiet" size="sm" icon={<Volume2 size={14} aria-hidden />} onClick={() => onSpeak(reading.reading_text)}>
          Read it aloud again
        </Button>
      )}
    </section>
  );
}
