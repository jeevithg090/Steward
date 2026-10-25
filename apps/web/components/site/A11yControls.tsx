"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { TEXT_SIZES, type TextSize, applyPrefs, getPrefs, getServerPrefs, setPrefs, subscribe } from "@/lib/a11y-prefs";

/** Text size (A, A+, A++) and plain mode, kept per browser and announced when they change. */
export function A11yControls({ compact = false }: { compact?: boolean }) {
  const prefs = useSyncExternalStore(subscribe, getPrefs, getServerPrefs);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    applyPrefs(getPrefs());
  }, []);

  const size = (id: TextSize) => {
    setPrefs({ textSize: id });
    setAnnounce(`${TEXT_SIZES.find((s) => s.id === id)?.words ?? "Text size"} on.`);
  };
  const plain = () => {
    const next = !prefs.plain;
    setPrefs({ plain: next });
    setAnnounce(next ? "Plain mode on: one thing at a time, bigger buttons." : "Plain mode off.");
  };

  const base = "min-h-11 min-w-11 rounded-lg border-2 px-3 font-semibold";
  const on = "border-teal-800 bg-teal-800 text-white";
  const off = "border-slate-700 bg-white text-slate-900 hover:bg-slate-100";

  return (
    <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "text-lg"}`}>
      <div role="group" aria-label="Text size" className="flex items-center gap-1">
        {!compact && <span className="mr-1 text-sm font-medium text-slate-700">Text size</span>}
        {TEXT_SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={prefs.textSize === s.id}
            aria-label={s.words}
            onClick={() => size(s.id)}
            className={`${base} ${prefs.textSize === s.id ? on : off}`}
          >
            <span aria-hidden="true">{s.label}</span>
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={prefs.plain} onClick={plain} className={`${base} ${prefs.plain ? on : off}`}>
        Plain mode
      </button>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
