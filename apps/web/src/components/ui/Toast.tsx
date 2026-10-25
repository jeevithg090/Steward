// Toasts (plan.md §12.4): one quiet line that confirms an action or explains a failure, read out by
// screen readers (role=status / role=alert), gone after a few seconds. Anywhere in the app:
//   import { toast } from "@/components/ui";
//   toast.success("Claim filed");  toast.error("Can't reach the Gateway");  toast.info("Copied");
// <Toaster /> is mounted once, in App.tsx.
import { useEffect, useSyncExternalStore } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
  /** Optional one action, e.g. "Undo" or "Open". */
  action?: { label: string; onClick: () => void };
}

let items: ToastItem[] = [];
let serial = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastTone, text: string, action?: ToastItem["action"], ms?: number): number {
  const id = ++serial;
  items = [...items.slice(-2), { id, tone, text, action }];
  emit();
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const life = ms ?? (tone === "error" ? 7000 : narrow ? 3000 : 4000);
  setTimeout(() => dismiss(id), life);
  return id;
}

export function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (text: string, action?: ToastItem["action"], ms?: number) => push("success", text, action, ms),
  error: (text: string, action?: ToastItem["action"], ms?: number) => push("error", text, action, ms),
  info: (text: string, action?: ToastItem["action"], ms?: number) => push("info", text, action, ms),
  /** For tests. */
  clear: () => {
    items = [];
    emit();
  },
};

function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
}

const TONE = {
  success: { box: "border-emerald-500/40 bg-emerald-950/90 text-emerald-50", icon: <CheckCircle2 size={16} className="text-emerald-300" aria-hidden /> },
  error: { box: "border-rose-500/40 bg-rose-950/90 text-rose-50", icon: <TriangleAlert size={16} className="text-rose-300" aria-hidden /> },
  info: { box: "border-indigo-500/40 bg-slate-900/95 text-slate-50", icon: <Info size={16} className="text-indigo-300" aria-hidden /> },
} as const;

/** Mounted once; at the top under the header on phones (so the chat input and buttons below stay
 * tappable), bottom-right on wide screens. At most three at a time, the newest last. */
export function Toaster() {
  const list = useToasts();
  useEffect(() => () => listeners.clear(), []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-24 sm:right-6 sm:top-auto sm:items-end">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-2xl border px-3.5 py-2.5 text-sm shadow-2xl backdrop-blur-md motion-safe:animate-[toast-in_160ms_ease-out] ${TONE[t.tone].box}`}
        >
          <span className="mt-0.5 shrink-0">{TONE[t.tone].icon}</span>
          <span className="min-w-0 flex-1 leading-snug">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
              className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              {t.action.label}
            </button>
          )}
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 rounded-full p-0.5 opacity-70 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
