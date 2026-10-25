// Small pieces the Devices page shares: a link styled as a button, the big pairing code, a
// countdown, and one way to run a step with a toast either way.
import { useEffect, useState, type ReactNode } from "react";
import { FOCUS, toast } from "@/components/ui";
import { formatCode, meshWords } from "@/lib/mesh";
import { linkProps } from "@/router";

export function LinkButton({ to, children, icon }: { to: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <a
      {...linkProps(to)}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 ${FOCUS}`}
    >
      {icon}
      {children}
    </a>
  );
}

/** The 6-digit code both screens show, large and spaced, read as single digits by screen readers. */
export function BigCode({ code, label = "Pairing code" }: { code: string; label?: string }) {
  return (
    <p className="font-mono text-4xl font-semibold tracking-[0.2em] text-white sm:text-5xl">
      <span aria-hidden>{formatCode(code)}</span>
      <span className="sr-only">{`${label}: ${code.split("").join(" ")}`}</span>
    </p>
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
