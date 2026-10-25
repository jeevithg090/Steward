import { ExternalLink } from "lucide-react";
import { FOCUS } from "@/components/ui";

/** The Langfuse trace behind a mission, when the Gateway has one. */
export function TraceLink({ url }: { url: string | null }) {
  if (!url) return <p className="text-xs text-slate-500">Traces appear here once Langfuse is connected.</p>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-300 underline hover:text-indigo-200 ${FOCUS}`}>
      Open the trace: why did Tempo do that? <ExternalLink size={12} aria-hidden />
    </a>
  );
}
