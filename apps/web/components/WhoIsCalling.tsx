"use client";

import { useEffect, useMemo, useState } from "react";
import type { VoiceProfileView } from "@/lib/api";
import type { LiveEvent } from "@/lib/live";

/** The demo's callers (seeded by `make seed`): each told Tempo how they need to be spoken to. */
export const CALLERS = [
  { id: "u_margaret", name: "Margaret" },
  { id: "u_dilip", name: "Dilip" },
  { id: "u_joan", name: "Joan" },
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", hi: "Hindi", pa: "Punjabi", pl: "Polish", ur: "Urdu", cy: "Welsh",
};
const RIGHT_TO_LEFT = new Set(["ur"]);

export interface WhoIsCallingProps {
  load: (userId: string) => Promise<VoiceProfileView>;
  events?: LiveEvent[];
  callers?: { id: string; name: string }[];
}

/** How Tempo will speak with each caller, set before the first word from what they asked it to
 * remember (the Patience Profile). Shows the settings, the words the voice agent is given, and the
 * memories behind them. Voice ids never reach the browser. */
export function WhoIsCalling({ load, events = [], callers = CALLERS }: WhoIsCallingProps) {
  const [caller, setCaller] = useState(callers[0]?.id ?? "");
  const [view, setView] = useState<VoiceProfileView | null>(null);
  const [failed, setFailed] = useState(false);
  const applied = useMemo(() => events.filter((e) => e.type === "profile_applied"), [events]);
  const latest = applied[0];

  useEffect(() => {
    let live = true;
    load(caller)
      .then((v) => { if (live) { setView(v); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [caller, load, applied.length]);

  const profile = view?.profile;
  const override = view?.initiation.conversation_config_override;
  const greeting = override?.agent?.first_message;
  const keywords = override?.asr?.keywords ?? [];
  const nameOf = (id: unknown) => callers.find((c) => c.id === id)?.name ?? String(id);

  return (
    <section aria-labelledby="calling-heading" className="rounded-xl border-2 border-slate-200 bg-white p-4">
      <h2 id="calling-heading" className="text-lg font-semibold">Who&apos;s calling?</h2>
      <p className="text-sm text-slate-700">How Tempo will speak, set up before the first word from what each caller asked it to remember.</p>

      <div role="group" aria-label="Caller" className="my-3 flex flex-wrap gap-1 text-sm">
        {callers.map((c) => (
          <button key={c.id} type="button" aria-pressed={caller === c.id} onClick={() => setCaller(c.id)}
            className={`rounded px-2 py-1 ${caller === c.id ? "bg-teal-800 text-white" : "border border-slate-300"}`}>
            {c.name}
          </button>
        ))}
      </div>

      {latest && (
        <p role="status" className="mb-2 rounded bg-teal-50 p-2 text-sm">
          Last call: {nameOf(latest.user_id)}, in {LANGUAGE_NAMES[String(latest.language)] ?? String(latest.language)}
          {latest.speed !== "1.0" ? ", slower" : ""}{latest.voice === "low" ? ", lower voice" : ""}
          {latest.patience === "high" ? ", extra time" : ""}
        </p>
      )}

      {failed && <p className="text-slate-700">Can&apos;t load this caller&apos;s settings right now.</p>}
      {!failed && profile && view && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-semibold">Language</dt>
            <dd>
              {LANGUAGE_NAMES[profile.language] ?? profile.language}
              {profile.other_language ? ` (asked for ${profile.other_language}, which Tempo can't speak yet)` : ""}
            </dd>
            <dt className="font-semibold">Pace</dt>
            <dd>{profile.speed === "1.0" ? "Usual" : `Slower (${profile.speed}×)`}</dd>
            <dt className="font-semibold">Voice</dt>
            <dd>
              {profile.voice === "low" ? "Tempo, lower" : "Tempo"}
              {profile.voice === "low" && !view.low_voice_configured ? " (not set up yet, so the usual voice)" : ""}
            </dd>
            <dt className="font-semibold">Time to answer</dt>
            <dd>{profile.patience === "high" ? "Extra: never rushed" : "Patient, as for everyone"}</dd>
            <dt className="font-semibold">Questions</dt>
            <dd>{profile.prefers_text ? "Offered by text too" : "By voice"}</dd>
          </dl>

          <h3 className="mt-3 text-sm font-semibold">What Tempo&apos;s voice agent is told</h3>
          <blockquote className="mt-1 border-l-4 border-teal-700 pl-2 text-sm">{view.how_to_speak}</blockquote>

          {greeting && (
            <>
              <h3 className="mt-3 text-sm font-semibold">First words</h3>
              <p lang={profile.language} dir={RIGHT_TO_LEFT.has(profile.language) ? "rtl" : "ltr"} className="text-sm">{greeting}</p>
            </>
          )}

          {keywords.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-semibold">Words it listens out for</h3>
              <ul aria-label="Words it listens out for" className="mt-1 flex flex-wrap gap-1 text-xs">
                {keywords.map((k) => <li key={k} className="rounded-full border border-slate-300 px-2 py-0.5">{k}</li>)}
              </ul>
            </>
          )}

          <h3 className="mt-3 text-sm font-semibold">Because they said</h3>
          {profile.reasons.length === 0 ? (
            <p className="text-sm text-slate-700">Nothing yet, so Tempo&apos;s usual patient voice.</p>
          ) : (
            <ul aria-label="Because they said" className="list-disc pl-5 text-sm">
              {profile.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-600">Every setting comes from something they said and said yes to keeping. Forget it on the Memory Card and the next call forgets it too.</p>
        </>
      )}
    </section>
  );
}
