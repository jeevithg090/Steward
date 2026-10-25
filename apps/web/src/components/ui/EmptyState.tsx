import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

/** Loading, empty and error states share this quiet card so pages feel the same. */
export function EmptyState({ title, children, icon, tone = "default", action }: { title: string; children?: ReactNode; icon?: ReactNode; tone?: "default" | "error"; action?: ReactNode }) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : undefined}
      className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-3xl border border-dashed px-6 py-12 text-center ${error ? "border-rose-400/35 bg-rose-500/[0.04] text-rose-200" : "border-white/[0.12] bg-white/[0.015] text-slate-400"}`}
    >
      <span className="relative grid h-14 w-14 place-items-center">
        <span aria-hidden className={`absolute inset-0 rounded-full border ${error ? "border-rose-400/30" : "border-violet-300/20"}`} />
        <span aria-hidden className={`absolute inset-2 rounded-full ${error ? "bg-rose-500/10" : "bg-violet-500/10"}`} />
        <span className={`relative ${error ? "text-rose-300" : "text-violet-200"}`}>{icon ?? <Inbox size={22} aria-hidden />}</span>
      </span>
      <p className={`text-[15px] font-medium ${error ? "text-rose-100" : "text-slate-100"}`}>{title}</p>
      {children && <div className="max-w-md text-sm leading-relaxed">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
