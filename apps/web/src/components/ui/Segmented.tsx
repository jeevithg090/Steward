import type { ReactNode } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A count shown after the label, e.g. how many missions are live. */
  count?: number;
}

/** A row of mutually exclusive buttons (aria-pressed), e.g. a list filter. */
export function Segmented<T extends string>({ options, value, onChange, label, className = "" }: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 ${className}`}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-300 motion-reduce:transition-none ${
              on ? "bg-white/[0.1] text-white shadow-[0_1px_0_0_rgb(255_255_255/0.08)_inset]" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={`num rounded-full px-1.5 text-[11px] ${on ? "bg-accent-500/30 text-accent-100" : "bg-white/[0.06] text-slate-400"}`}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
