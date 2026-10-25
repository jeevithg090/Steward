import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Badge, Button, Card, FOCUS } from "@/components/ui";

/** Tempo read the card; one fact is unsure, so it asks once before planning. */
export function ReadBackCard({
  question,
  date,
  busy = false,
  onConfirm,
  onCancel,
}: {
  question: string;
  date: string;
  busy?: boolean;
  onConfirm: (date: string, corrected: boolean) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(date);
  return (
    <Card as="section" tone="amber" aria-labelledby="readback-heading" className="relative overflow-hidden motion-safe:animate-scale-in">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <h3 id="readback-heading" className="flex items-center gap-3 text-[15px] font-semibold text-white">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/30">
            <ScanLine size={16} />
          </span>
          Tempo read the card
        </h3>
        <Badge tone="amber" dot>
          vision · one thing to check
        </Badge>
      </div>
      <p className="relative mt-4 text-[15px] leading-relaxed text-slate-100">{question}</p>
      <div className="relative mt-5 flex flex-wrap items-end gap-3">
        <Button variant="ok" busy={busy} onClick={() => onConfirm(date, false)}>
          Yes, that&apos;s right
        </Button>
        <span aria-hidden className="hidden h-10 w-px bg-white/10 sm:block" />
        <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-300">
          Or the right date
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`h-10 rounded-full border border-white/15 bg-ink/70 px-4 text-sm text-slate-100 [color-scheme:dark] ${FOCUS}`}
          />
        </label>
        <Button variant="quiet" disabled={busy || !value} onClick={() => onConfirm(value, true)}>
          Use this date
        </Button>
        {onCancel && (
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Not now
          </Button>
        )}
      </div>
    </Card>
  );
}
