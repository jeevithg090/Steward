export function TraceLink({ url }: { url: string | null }) {
  if (!url) return <p className="text-sm text-slate-600">Traces appear here once Langfuse is connected.</p>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-teal-800 underline">
      Open the trace: why did Tempo do that?
    </a>
  );
}
