"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LANGUAGES,
  LEVEL_WORDS,
  RULE_WORDS,
  SAMPLES,
  ZONE_WORDS,
  type Language,
  type ShieldSource,
  type ShieldStatus,
  type ShieldVerdict,
  type Voice,
} from "@/lib/shield";

export interface ShieldPanelProps {
  source: ShieldSource;
  voice: Voice;
  userId?: string;
}

const TONES: Record<ShieldVerdict["level"], string> = {
  likely_scam: "border-rose-800 bg-rose-50 text-rose-950",
  caution: "border-amber-700 bg-amber-50 text-amber-950",
  unknown: "border-slate-600 bg-slate-100 text-slate-900",
  no_flags: "border-teal-800 bg-teal-50 text-teal-950",
};

/**
 * Scam Shield on the web (docs/scam-shield.md §8): paste a message, hear the verdict in your
 * language, see why, and tell Tempo if it got it wrong. Big targets, one column, nothing to set up.
 * The same code path answers the phone, the SMS CHECK word and the voice agent.
 */
export function ShieldPanel({ source, voice, userId }: ShieldPanelProps) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [verdict, setVerdict] = useState<ShieldVerdict | null>(null);
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [label, setLabel] = useState<"scam" | "real" | null>(null);
  const rtl = useMemo(() => LANGUAGES.find((l) => l.code === language)?.rtl ?? false, [language]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await source.status(userId));
    } catch {
      setStatus(null);
    }
  }, [source, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const check = async (message: string) => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    setLabel(null);
    try {
      const result = await source.check(message, language, userId);
      setVerdict(result);
      await refresh();
    } catch (e) {
      setVerdict(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const say = () => {
    if (!verdict) return;
    voice.speak(verdict.say, language);
    setSpeaking(true);
  };
  const hush = () => {
    voice.stop();
    setSpeaking(false);
  };

  const feedback = async (given: "scam" | "real") => {
    if (!verdict) return;
    await source.feedback(verdict.alert_id, given);
    setLabel(given);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="check-heading" className="rounded-xl border-2 border-slate-200 bg-white p-5">
        <h2 id="check-heading" className="text-2xl font-semibold">Check a message</h2>
        <p className="mt-1 text-lg text-slate-700">
          Paste a text you are unsure of. Tempo checks the words, the links, the official registers and public
          phishing lists, and says what it found. It never says &quot;safe&quot;.
        </p>

        <div role="group" aria-label="Try one of these" className="mt-4 flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setText(s.text)}
              className="min-h-11 rounded-lg border-2 border-slate-300 px-3 py-2 text-base font-medium hover:bg-slate-100"
            >
              {s.label}
            </button>
          ))}
        </div>

        <label htmlFor="shield-text" className="mt-4 block text-lg font-semibold">
          The message
        </label>
        <textarea
          id="shield-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border-2 border-slate-400 p-3 text-lg"
          placeholder="Paste the message here, or press one of the examples above."
        />

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="shield-language" className="block text-base font-semibold">
              Say it in
            </label>
            <select
              id="shield-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="mt-1 min-h-11 rounded-lg border-2 border-slate-400 px-3 text-base"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => check(text)}
            className="min-h-12 rounded-lg bg-teal-800 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Checking…" : "Check this message"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border-2 border-amber-700 bg-amber-50 p-3 text-base">
            {error}
          </p>
        )}
      </section>

      {verdict && (
        <section aria-labelledby="verdict-heading" aria-live="polite" className={`rounded-xl border-4 p-5 ${TONES[verdict.level]}`}>
          <h2 id="verdict-heading" className="text-3xl font-bold">
            {LEVEL_WORDS[verdict.level]}
          </h2>
          <p lang={LANGUAGES.find((l) => l.code === language)?.bcp47} dir={rtl ? "rtl" : "ltr"} className="mt-3 text-2xl leading-relaxed">
            {verdict.say}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {voice.available && !speaking && (
              <button type="button" onClick={say} className="min-h-12 rounded-lg border-2 border-current px-5 py-2 text-lg font-semibold">
                Say it out loud
              </button>
            )}
            {voice.available && speaking && (
              <button type="button" onClick={hush} className="min-h-12 rounded-lg border-2 border-current px-5 py-2 text-lg font-semibold">
                Stop
              </button>
            )}
          </div>

          <dl className="mt-5 grid gap-x-6 gap-y-2 text-base sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold">What Tempo would do</dt>
            <dd>
              {ZONE_WORDS[verdict.zone]}
              {verdict.held ? " It held this one and looked behind the link before speaking." : ""}
            </dd>
            {verdict.confidence !== null && (
              <>
                <dt className="font-semibold">How sure the text model is</dt>
                <dd>
                  <span aria-hidden="true" className="mr-2 inline-block h-3 w-40 overflow-hidden rounded-full border border-current align-middle">
                    <span className="block h-full bg-current" style={{ width: `${Math.round(verdict.confidence * 100)}%` }} />
                  </span>
                  {Math.round(verdict.confidence * 100)} in 100 that this is a scam. The model ranks; code decides.
                </dd>
              </>
            )}
            {verdict.rules.length > 0 && (
              <>
                <dt className="font-semibold">The words</dt>
                <dd>
                  <ul className="list-disc pl-5">
                    {verdict.rules.map((r) => (
                      <li key={r}>It {RULE_WORDS[r] ?? r.replaceAll("_", " ")}.</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {verdict.links.length > 0 && (
              <>
                <dt className="font-semibold">The links</dt>
                <dd>
                  <ul className="list-disc pl-5">
                    {verdict.links.map((l) => (
                      <li key={l.url}>
                        <span className="font-mono">{l.host}</span>
                        {l.words.length > 0 ? `: ${l.words.join("; ")}` : ": no finding on the link itself"}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {verdict.reasons.length > 0 && (
              <>
                <dt className="font-semibold">Every reason, in order</dt>
                <dd>
                  <ol className="list-decimal pl-5">
                    {verdict.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ol>
                </dd>
              </>
            )}
            <dt className="font-semibold">What to do</dt>
            <dd>{verdict.advice}</dd>
          </dl>

          <div role="group" aria-label="Was Tempo right?" className="mt-5 flex flex-wrap items-center gap-3">
            <span className="text-base font-semibold">Was Tempo right?</span>
            <button type="button" disabled={label !== null} onClick={() => feedback("scam")} aria-pressed={label === "scam"} className="min-h-11 rounded-lg border-2 border-current px-4 py-2 text-base font-medium disabled:opacity-60">
              It was a scam
            </button>
            <button type="button" disabled={label !== null} onClick={() => feedback("real")} aria-pressed={label === "real"} className="min-h-11 rounded-lg border-2 border-current px-4 py-2 text-base font-medium disabled:opacity-60">
              It was real
            </button>
            {label && <span role="status" className="text-base">Thank you. Only the verdict and your answer are kept, never the message.</span>}
          </div>
          <p className="mt-4 text-sm">
            {verdict.simulated ? "Registers and the link sandbox answered from recordings (replay mode)." : "Registers and the link sandbox were checked live."}
            {verdict.model ? ` Text model ${verdict.model.version}.` : ""}
          </p>
        </section>
      )}

      <section aria-labelledby="log-heading" className="rounded-xl border-2 border-slate-200 bg-white p-5">
        <h2 id="log-heading" className="text-2xl font-semibold">The Shield log</h2>
        <p className="mt-1 text-base text-slate-700">What Tempo has checked. It keeps the verdict and the link hosts, never a word of the message.</p>
        {status ? (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-sm text-slate-700">Checked today</dt>
                <dd className="text-3xl font-bold">{status.today.checked}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-sm text-slate-700">Held and looked at</dt>
                <dd className="text-3xl font-bold">{status.today.held}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-sm text-slate-700">Warned about</dt>
                <dd className="text-3xl font-bold">{status.today.warned}</dd>
              </div>
            </dl>
            {status.recent.length > 0 && (
              <ul aria-label="Recent checks" className="mt-4 divide-y divide-slate-200 text-base">
                {status.recent.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="font-semibold">{LEVEL_WORDS[a.level]}</span>
                    <span className="text-slate-700">
                      {a.source}
                      {a.link_hosts.length ? ` · ${a.link_hosts.join(", ")}` : ""}
                      {a.label ? ` · you said: ${a.label}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {status.model && (
              <p className="mt-4 text-sm text-slate-700">
                Text model {status.model.version}: on the held-out test fold, {Math.round((status.model.metrics.precision_at_warn ?? 0) * 1000) / 10}% of what it
                would speak about is a scam and it catches {Math.round((status.model.metrics.recall_at_warn ?? 0) * 1000) / 10}% of them; on genuine bank,
                NHS and council texts it speaks {Math.round((status.model.metrics.synthetic_spoken_on_genuine ?? 0) * 100)}% of the time. Lists:{" "}
                {Object.entries(status.feeds)
                  .map(([name, f]) => `${name} (${f.entries})`)
                  .join(", ") || "none loaded"}
                .
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-base text-slate-700">The Shield log is not reachable right now.</p>
        )}
      </section>
    </div>
  );
}
