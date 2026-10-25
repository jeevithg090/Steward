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
    <Card as="section" tone="amber" aria-labelledby="readback-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="readback-heading" className="flex items-center gap-2 text-sm font-semibold text-amber-100">
          <ScanLine size={16} aria-hidden /> Tempo read the card
        </h3>
        <Badge tone="amber">vision · one thing to check</Badge>
      </div>
      <p className="text-sm text-slate-200">{question}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="ok" busy={busy} onClick={() => onConfirm(date, false)}>
          Yes, that&apos;s right
        </Button>
        <label className="text-xs text-slate-300">
          Or the right date
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`ml-2 rounded-lg border border-white/15 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 ${FOCUS}`}
          />
        </label>
        <Button variant="quiet" disabled={busy || !value} onClick={() => onConfirm(value, true)}>
          Use this date
        </Button>
        {onCancel && (
          <Button variant="quiet" disabled={busy} onClick={onCancel}>
            Not now
          </Button>
        )}
      </div>
    </Card>
  );
}
