// Under a reply from the brain (plan.md §17): where the answer came from, as links, and a steps
// row that opens what Tempo did this turn, each step with its time. The steps are code's record of
// the turn (brain.py), not the model's account of itself.
import { useId, useState } from "react";
import { BookOpen, ChevronRight, ExternalLink, Globe, Sparkles, Zap } from "lucide-react";
import type { ChatSource, ChatStep } from "@/lib/api";
import { FOCUS } from "@/components/ui";

const ICONS = { think: Sparkles, look_up: Globe, act: Zap } as const;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function Sources({ sources }: { sources: ChatSource[] }) {
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <BookOpen size={12} aria-hidden /> Sources
      </p>
      <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] text-slate-300 transition-colors hover:border-accent-300/35 hover:text-white ${FOCUS}`}
            >
              <span className="truncate">{s.title}</span>
              <span className="shrink-0 text-slate-500">{host(s.url)}</span>
              <ExternalLink size={11} aria-hidden className="shrink-0 text-slate-500" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StepsRow({ steps }: { steps: ChatStep[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const total = steps.reduce((sum, s) => sum + s.ms, 0);
  const longest = Math.max(1, ...steps.map((s) => s.ms));
  return (
    <div className="mt-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11.5px] text-slate-500 transition-colors hover:text-slate-200 ${FOCUS}`}
      >
        <ChevronRight size={13} aria-hidden className={`transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
        How Tempo got here · {steps.length} {steps.length === 1 ? "step" : "steps"} · {seconds(total)}
      </button>
      {open && (
        <ol id={id} className="mt-2 space-y-1.5 border-l border-white/[0.08] pl-3 motion-safe:animate-fade-in">
          {steps.map((step, i) => {
            const Icon = ICONS[step.kind] ?? Sparkles;
            return (
              <li key={`${step.label}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
                <Icon size={12} aria-hidden className={step.kind === "look_up" ? "text-second-300" : "text-accent-300"} />
                <span className="min-w-0">
                  <span className="block truncate text-slate-300">{step.label}</span>
                  <span aria-hidden className="mt-1 block h-1 rounded-full bg-white/[0.05]">
                    <span
                      className={`block h-1 rounded-full ${step.kind === "look_up" ? "bg-second-400/70" : "bg-accent-400/70"}`}
                      style={{ width: `${Math.max(4, (step.ms / longest) * 100)}%` }}
                    />
                  </span>
                </span>
                <span className="num text-slate-500">{seconds(step.ms)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
