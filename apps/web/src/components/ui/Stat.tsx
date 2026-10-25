import { useEffect, useRef, useState, type ReactNode } from "react";

function prefersStill(): boolean {
  if (typeof window === "undefined") return true;
  if (document.documentElement.hasAttribute("data-reduce-motion")) return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Counts a number up to `value` once it changes (instantly under reduced motion). Keeps the
 * value's own decimals, so "28.40" counts as money and "0.3" as hours. */
export function useCountUp(value: string, ms = 900): string {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const target = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(target) || prefersStill()) {
      setShown(value);
      return;
    }
    const decimals = value.includes(".") ? value.split(".")[1].length : 0;
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown((begin + (target - begin) * eased).toFixed(decimals));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/** A headline number: a label, the value (counted up), an optional unit and a line under it. */
export function Stat({ label, value, prefix = "", suffix = "", tone = "default", sub, icon }: {
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
  tone?: "default" | "gold" | "brand" | "emerald";
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  const shown = useCountUp(value);
  const colour = tone === "gold" ? "text-gold" : tone === "brand" ? "text-brand" : tone === "emerald" ? "text-emerald-300" : "text-white";
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {icon}
        {label}
      </p>
      <p className={`num mt-1.5 text-[2rem] font-semibold leading-none tracking-[-0.02em] ${colour}`}>
        {/* The real value for screen readers and tests; the counting digits are only for the eye. */}
        <span className="sr-only">
          {prefix}
          {value}
          {suffix}
        </span>
        <span aria-hidden>
          {prefix}
          {shown}
          {suffix}
        </span>
      </p>
      {sub && <div className="mt-2 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
