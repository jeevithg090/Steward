/** A small time ring turning, with its label for everyone (role=status). */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-xs text-slate-400">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="animate-spin motion-reduce:animate-none">
        <circle cx="8" cy="8" r="6" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}
