import { useId } from "react";

/** Tempo's mark (plan.md §15.1): the time ring, violet turning to gold as the hour comes back. */
export function TempoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={`ring-${id}`} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#f5b544" />
        </linearGradient>
        <radialGradient id={`core-${id}`} cx="0.5" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#2a2550" />
          <stop offset="1" stopColor="#0d0c18" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#core-${id})`} stroke="rgb(255 255 255 / 0.1)" />
      <circle cx="24" cy="24" r="13" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="3.5" />
      <circle
        cx="24" cy="24" r="13" fill="none" stroke={`url(#ring-${id})`} strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray="68 82" transform="rotate(-90 24 24)"
      />
      <path d="M24 16.5V24l5 3" fill="none" stroke="#f4f4f6" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35.6" cy="30.2" r="2.2" fill="#fcd581" />
    </svg>
  );
}
