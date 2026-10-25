import { Loader2 } from "lucide-react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-xs text-slate-400">
      <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> {label}
    </span>
  );
}
