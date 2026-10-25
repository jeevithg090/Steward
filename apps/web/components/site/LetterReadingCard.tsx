"use client";

import { useEffect, useState } from "react";
import { type LetterReading, type LetterUnsure, type ReplyDraft, directionWords, kindWords, longDate } from "@/lib/letters";
import { Card, Chip, buttonClass } from "./ui";

export interface Speaker {
  available: boolean;
  speak(text: string, lang: string): void;
  stop(): void;
}

function browserSpeaker(): Speaker {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  return {
    available: Boolean(synth),
    speak(text, lang) {
      if (!synth) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.9; // patient by default
      synth.speak(utterance);
    },
    stop() {
      synth?.cancel();
    },
  };
}

/** One letter, read back in plain words, with the clocks it starts and the one question Tempo was unsure of. */
export function LetterReadingCard({
  reading, speaker: injected, onReply,
}: {
  reading: LetterReading;
  speaker?: Speaker;
  onReply: (said: string) => Promise<ReplyDraft>;
}) {
  const [speaker, setSpeaker] = useState<Speaker | null>(injected ?? null);
  const [speaking, setSpeaking] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [said, setSaid] = useState("");
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!injected) setSpeaker(browserSpeaker());
  }, [injected]);

  useEffect(() => {
    setAnswers({});
    setDraft(null);
    setSaid("");
    speaker?.stop();
    setSpeaking(false);
  }, [reading, speaker]);

  const readAloud = () => {
    if (!speaker?.available) return;
    speaker.speak(reading.reading_text, reading.language);
    setSpeaking(true);
  };
  const stop = () => {
    speaker?.stop();
    setSpeaking(false);
  };

  const open = reading.unsure.filter((u) => !(u.key in answers));
  const direction = directionWords(reading.money.direction);
  const money = reading.money.amount_gbp ? `${direction}: £${reading.money.amount_gbp}` : direction;
  // A corrected pay-by date replaces the one that was read; a plain "yes" keeps it.
  const corrected = answers.due_date ?? answers.by;
  const by = corrected && corrected !== "confirmed" ? corrected : reading.by;

  return (
    <section aria-labelledby="reading-heading" className="space-y-5" lang={reading.language}>
      <div className="flex flex-wrap items-center gap-3">
        {reading.sample ? <Chip tone="amber">Sample reading, written by hand</Chip> : <Chip tone="teal">Recorded from the replay Gateway</Chip>}
        {reading.simulated?.length ? <Chip tone="amber">Vision replayed: {reading.simulated.join(", ")}</Chip> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        {speaker?.available ? (
          <>
            <button type="button" onClick={readAloud} className={`${buttonClass("primary")} min-h-14 text-xl`}>
              Read it aloud
            </button>
            {speaking && (
              <button type="button" onClick={stop} className={`${buttonClass("quiet")} min-h-14 text-xl`}>
                Stop reading
              </button>
            )}
          </>
        ) : (
          <p className="text-slate-700">This browser can&apos;t read aloud. The whole reading is written below.</p>
        )}
      </div>

      {open.length > 0 && (
        <div role="group" aria-labelledby="unsure-heading" className="rounded-xl border-4 border-amber-600 bg-amber-50 p-4">
          <h2 id="unsure-heading" className="text-lg font-semibold">Before I go on, one thing I wasn&apos;t sure of</h2>
          {open.map((u) => <UnsureQuestion key={u.key} item={u} onAnswer={(value) => setAnswers((a) => ({ ...a, [u.key]: value }))} />)}
        </div>
      )}

      <Card>
        <h2 id="reading-heading" className="text-2xl font-bold text-slate-900">
          {kindWords(reading.kind)}{" "}
          <span className="block text-lg font-medium text-slate-700">
            from {reading.sender}{reading.date ? `, dated ${longDate(reading.date)}` : ""}
          </span>
        </h2>
        <dl className="mt-4 space-y-4 text-lg">
          <div>
            <dt className="font-semibold text-teal-900">What it says</dt>
            <dd className="text-slate-800">{reading.says}</dd>
          </div>
          <div>
            <dt className="font-semibold text-teal-900">Money</dt>
            <dd className="text-slate-800">{money}</dd>
          </div>
          <div>
            <dt className="font-semibold text-teal-900">What you must do</dt>
            <dd className="text-slate-800">
              {reading.must_do}
              {by && <strong className="block"> By {longDate(by)}.</strong>}
            </dd>
          </div>
          {reading.clocks.length > 0 && (
            <div>
              <dt className="font-semibold text-teal-900">The clocks this letter starts</dt>
              <dd>
                <ul className="list-disc pl-6 text-slate-800">
                  {reading.clocks.map((c) => <li key={c.id}>{c.label}: runs out on {longDate(c.expires_on)}</li>)}
                </ul>
              </dd>
            </div>
          )}
        </dl>
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer font-semibold text-slate-800">The words Tempo reads aloud</summary>
          <p className="mt-2 text-lg text-slate-800">{reading.reading_text}</p>
        </details>
      </Card>

      <Card>
        <h2 className="text-xl font-bold text-slate-900">Say your reply, Tempo writes it</h2>
        <p className="mt-1 text-slate-800">
          Say what you want to tell them, in your own words. Tempo turns it into a plain formal reply and adds no facts you did not give. You
          read it, then you send it.
        </p>
        <form
          className="mt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              setDraft(await onReply(said));
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="said" className="block font-medium">What do you want to say?</label>
          <textarea id="said" value={said} onChange={(e) => setSaid(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border-2 border-slate-400 p-2 text-lg" />
          <button type="submit" disabled={!said.trim() || busy} className={`mt-3 ${buttonClass("primary")}`}>Draft my reply</button>
        </form>
        {error && <p role="alert" className="mt-3 text-rose-900">{error}</p>}
        {draft && (
          <div className="mt-4">
            <h3 className="font-semibold">Your reply, to check before you send it</h3>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border-2 border-slate-300 bg-slate-50 p-3 font-sans text-lg">{draft.draft}</pre>
            <p className="mt-2 text-sm text-slate-700">
              {draft.adds_no_facts ? "Made from your words and this reading only; nothing else was added." : "Check every fact before sending."}
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}

function UnsureQuestion({ item, onAnswer }: { item: LetterUnsure; onAnswer: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="mt-2">
      <p className="text-lg">{item.question}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <button type="button" onClick={() => onAnswer("confirmed")} className={buttonClass("primary")}>Yes, that&apos;s right</button>
        <label className="text-sm">
          Or the right one
          <input
            type={/date|^by$/.test(item.key) ? "date" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="ml-2 min-h-11 rounded border-2 border-slate-400 px-2 py-1"
          />
        </label>
        <button type="button" disabled={!value} onClick={() => onAnswer(value)} className={buttonClass("quiet")}>Use this</button>
      </div>
    </div>
  );
}
