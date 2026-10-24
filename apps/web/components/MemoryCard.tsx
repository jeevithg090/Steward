"use client";

import { useState } from "react";
import type { MemoryCardData, MemoryItem, TemporalFact } from "@/lib/api";

const SOURCE_LABELS: Record<string, string> = {
  user_voice: "You said, by voice",
  user_sms: "You texted",
  user_web: "You entered online",
  official_api: "Official data",
};
const CATEGORY_LABELS: Record<string, string> = {
  preference: "Preferences",
  contact: "People",
  journey: "Journeys",
  household: "Home",
  mission_fact: "Claims",
  health: "Health and access",
  immigration: "Immigration",
  finance: "Money",
  access: "How to speak with me",
};
const CATEGORY_NOTES: Record<string, string> = {
  access: "Only kept because you said yes. It never expires; forget it any time.",
};

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}

export function factText(f: TemporalFact): string {
  return `${f.subject} ${f.predicate.replaceAll("_", " ")} ${f.object}`;
}

export interface MemoryCardProps {
  card: MemoryCardData | null;
  busy?: boolean;
  onForget: (item: MemoryItem) => void;
  onForgetFact: (fact: TemporalFact) => void;
  onCorrect: (item: MemoryItem, text: string) => void;
}

/** What Tempo remembers, where each thing came from and when, with edit and forget (spec §17.5). */
export function MemoryCard({ card, busy = false, onForget, onForgetFact, onCorrect }: MemoryCardProps) {
  const [view, setView] = useState<"memories" | "timeline">("memories");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const groups = Object.entries(card?.memories ?? {});

  return (
    <section aria-labelledby="memory-heading" className="rounded-xl border-2 border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="memory-heading" className="text-lg font-semibold">What Tempo remembers</h2>
        <div role="tablist" aria-label="Memory view" className="flex gap-1 text-sm">
          {(["memories", "timeline"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded px-2 py-1 ${view === v ? "bg-teal-800 text-white" : "border border-slate-300"}`}>
              {v === "memories" ? "Memories" : "Timeline"}
            </button>
          ))}
        </div>
      </div>

      {view === "memories" && (groups.length === 0 ? (
        <p className="text-slate-700">Nothing yet. Tempo only remembers what you tell it.</p>
      ) : (
        <div className="space-y-4">
          {groups.map(([category, entries]) => (
            <div key={category}>
              <h3 className="font-semibold">{CATEGORY_LABELS[category] ?? category}</h3>
              {CATEGORY_NOTES[category] && <p className="text-sm text-slate-700">{CATEGORY_NOTES[category]}</p>}
              <ul className="space-y-2">
                {entries.map(({ item, earlier }) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-2">
                    {editing === item.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); onCorrect(item, draft); setEditing(null); }} className="flex gap-2">
                        <label className="sr-only" htmlFor={`edit-${item.id}`}>Correct this memory</label>
                        <input id={`edit-${item.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1 rounded border px-2" />
                        <button type="submit" disabled={busy || !draft.trim()} className="font-semibold text-teal-800">Save</button>
                      </form>
                    ) : (
                      <p className="font-medium">{item.text}</p>
                    )}
                    <p className="text-sm text-slate-700">
                      {SOURCE_LABELS[item.source] ?? item.source} · {day(item.observed_at)} · {item.trust}
                      {item.expires_at ? ` · kept until ${day(item.expires_at)}` : ""}
                    </p>
                    {earlier.length > 0 && (
                      <ul aria-label="Earlier versions" className="text-sm text-slate-600">
                        {earlier.map((e, i) => (
                          <li key={`${e.id}-${i}`}><s>{e.text}</s> (replaced {day((earlier[i + 1] ?? item).observed_at)})</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-1 flex gap-3 text-sm">
                      <button type="button" disabled={busy} onClick={() => { setEditing(item.id); setDraft(item.text); }} className="underline">Edit</button>
                      <button type="button" disabled={busy} onClick={() => onForget(item)} aria-label={`Forget ${item.text}`}
                        className="font-semibold text-rose-800 underline">
                        Forget
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}

      {view === "timeline" && ((card?.timeline.length ?? 0) === 0 ? (
        <p className="text-slate-700">No dated facts yet.</p>
      ) : (
        <ol aria-label="Timeline" className="space-y-2">
          {card!.timeline.map((f) => (
            <li key={f.id} className="border-l-4 border-teal-700 pl-2">
              <p>{f.valid_to ? <s>{factText(f)}</s> : factText(f)}</p>
              <p className="text-sm text-slate-700">
                From {day(f.valid_from)}{f.valid_to ? `, replaced ${day(f.valid_to)}` : ", still true"}
                {" · "}
                <button type="button" disabled={busy} onClick={() => onForgetFact(f)} className="text-rose-800 underline">Forget</button>
              </p>
            </li>
          ))}
        </ol>
      ))}
    </section>
  );
}
