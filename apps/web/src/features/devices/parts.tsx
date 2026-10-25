// Small pieces the Devices page shares: a link styled as a button, the big pairing code, a
// countdown, and one way to run a step with a toast either way.
import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { FOCUS, toast } from "@/components/ui";
import { formatCode, meshWords } from "@/lib/mesh";
import { linkProps } from "@/router";

export function LinkButton({ to, children, icon }: { to: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <a
      {...linkProps(to)}
      className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 text-sm font-medium text-slate-100 transition-colors hover:border-white/20 hover:bg-white/[0.09] motion-reduce:transition-none ${FOCUS}`}
    >
      {icon}
      {children}
    </a>
  );
}

/** The 6-digit code both screens show, large and spaced, read as single digits by screen readers. */
export function BigCode({ code, label = "Pairing code" }: { code: string; label?: string }) {
  return (
    <p className="inline-flex rounded-3xl border border-accent-400/30 bg-gradient-to-b from-accent-500/[0.14] to-accent-500/[0.03] px-6 py-4 font-mono text-4xl font-semibold tracking-[0.22em] text-white shadow-glow motion-safe:animate-scale-in sm:text-5xl">
      <span aria-hidden className="num">{formatCode(code)}</span>
      <span className="sr-only">{`${label}: ${code.split("").join(" ")}`}</span>
    </p>
  );
}

/** Where you are in a short flow: done steps get a tick, the current one glows. Read as a list. */
export function Stepper({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return (
    <ol aria-label={label} className="flex items-start gap-2">
      {steps.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={step} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-1 ring-inset transition-colors duration-300 motion-reduce:transition-none ${
                  done
                    ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40"
                    : now
                      ? "bg-gradient-to-b from-accent-500 to-accent-700 text-white ring-accent-300/40 shadow-[0_0_0_4px_rgb(var(--accent-500)/0.16)]"
                      : "bg-white/[0.04] text-slate-400 ring-white/10"
                }`}
              >
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {i < steps.length - 1 && <span aria-hidden className={`h-px flex-1 rounded-full ${done ? "bg-emerald-400/40" : "bg-white/10"}`} />}
            </span>
            <span className={`text-xs leading-snug ${now ? "font-medium text-white" : done ? "text-slate-300" : "text-slate-400"}`}>
              {step}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A rounded icon tile with a soft gradient, for card headers. */
export function IconTile({ children, tone = "violet", size = "md" }: { children: ReactNode; tone?: "violet" | "emerald" | "amber" | "slate"; size?: "md" | "lg" }) {
  const tones = {
    violet: "from-accent-500/30 to-accent-700/10 text-accent-100 ring-accent-300/25 shadow-[0_12px_30px_-14px_rgb(var(--accent-600)/0.9)]",
    emerald: "from-emerald-500/25 to-emerald-700/10 text-emerald-100 ring-emerald-300/25 shadow-[0_12px_30px_-14px_rgb(16_185_129/0.8)]",
    amber: "from-amber-500/25 to-amber-700/10 text-amber-100 ring-amber-300/25",
    slate: "from-white/[0.12] to-white/[0.03] text-slate-100 ring-white/15",
  };
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center bg-gradient-to-b ring-1 ring-inset ${tones[tone]} ${size === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-2xl"}`}>
      {children}
    </span>
  );
}

/** Seconds left until an ISO time, ticking once a second. */
export function useSecondsLeft(until: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const end = new Date(until).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - now) / 1000));
}

export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Run one step: a success toast with `done`, or a plain error toast. True when it worked. */
export async function step(work: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await work();
    if (done) toast.success(done);
    return true;
  } catch (e) {
    toast.error(meshWords(e));
    return false;
  }
}
