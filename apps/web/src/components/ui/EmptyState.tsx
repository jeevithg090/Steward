import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

/** Loading, empty and error states share this quiet card so pages feel the same. */
export function EmptyState({ title, children, icon, tone = "default", action }: { title: string; children?: ReactNode; icon?: ReactNode; tone?: "default" | "error"; action?: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-center ${tone === "error" ? "border-rose-500/40 text-rose-200" : "border-white/15 text-slate-400"}`}
    >
      <span className="text-slate-500">{icon ?? <Inbox size={28} aria-hidden />}</span>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {children && <div className="max-w-md text-xs">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
