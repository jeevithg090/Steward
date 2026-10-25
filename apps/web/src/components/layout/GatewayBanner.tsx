import { RefreshCw, Server, Sparkles } from "lucide-react";
import { Button } from "../ui";
import { linkProps } from "@/router";

/** Shown when the Gateway cannot be reached (plan.md §12.3, track S): say so once, plainly, and
 * offer the two ways forward: try again, or walk the recorded showcase instead. */
export function GatewayBanner({ url, onRetry, onShowcase }: { url: string; onRetry: () => void; onShowcase: () => void }) {
  // `make demo` helps only on the machine the Gateway runs on; a visitor to a hosted page gets plain words.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  return (
    <div role="alert" className="mx-4 mt-3 flex flex-wrap items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-50 lg:mx-6">
      <Server size={18} className="mt-0.5 shrink-0 text-rose-300" aria-hidden />
      <p className="min-w-0 flex-1 basis-56">
        Tempo can't reach its Gateway at <span className="break-all font-mono text-xs text-rose-200">{url}</span>.{" "}
        {local ? (
          <>
            Start it with <code className="rounded bg-black/40 px-1.5 py-0.5 text-xs">make demo</code>, or look around on recorded data.
          </>
        ) : (
          "It may be restarting: try again in a moment, or look around on recorded data."
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
        <Button size="sm" icon={<Sparkles size={14} aria-hidden />} onClick={onShowcase}>
          Use the showcase
        </Button>
        <a {...linkProps("/settings")} className="inline-flex items-center rounded-full px-2.5 py-1 text-xs text-rose-100 underline">
          Settings
        </a>
      </div>
    </div>
  );
}
