import { ExternalLink, Telescope } from "lucide-react";
import { FOCUS } from "@/components/ui";

/** The Langfuse trace behind a mission, when the Gateway has one. */
export function TraceLink({ url }: { url: string | null }) {
  if (!url) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Telescope size={13} aria-hidden className="shrink-0 text-slate-500" />
        Traces appear here once Langfuse is connected.
      </p>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-violet-300 underline decoration-violet-300/40 underline-offset-2 transition-colors hover:text-violet-100 hover:decoration-violet-100 motion-reduce:transition-none ${FOCUS}`}
    >
      <Telescope size={14} aria-hidden /> Open the trace: why did Tempo do that? <ExternalLink size={12} aria-hidden />
    </a>
  );
}
