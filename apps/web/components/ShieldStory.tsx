"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { A11yControls } from "@/components/site/A11yControls";
import { Chip } from "@/components/site/ui";
import {
  LANGUAGES,
  RULE_WORDS,
  SAMPLES,
  type Language,
  type Narrator,
  type ShieldVerdict,
  type SpokenLine,
  recordedStatus,
  recordedVerdict,
  spokenLine,
  translatedSay,
} from "@/lib/shield";

/**
 * Margaret's Tuesday: how Scam Shield works, told so that it can be *heard* as well as seen.
 *
 * Everything here is recorded from a real replay-mode Gateway (the four verdicts) or is the exact
 * sentence the voice says (voice/warnings.yaml); nothing is invented in the browser. The page is
 * built to be used with the eyes shut, with a keyboard only, with a screen reader, at A++ text
 * size and in plain mode, and it says so where it can be checked rather than claimed.
 */
export interface ShieldStoryProps {
  narrator: Narrator;
  /** For tests: pretend the system asked for less motion. */
  reducedMotion?: boolean;
}

interface Scene {
  id: string;
  title: string;
  /** What the narrator says about this moment (English). */
  narration: string;
  /** What Tempo itself says here, if anything: spoken in the chosen language. */
  tempoSays?: (language: Language) => string;
  sample?: (typeof SAMPLES)[number]["id"];
  sender?: string;
  /** What is on the phone's screen. */
  screen: "message" | "deciding" | "card" | "ledger" | "hold" | "settled" | "quiet" | "doors";
}

const HMRC = recordedVerdict("hmrc");
const GREY = recordedVerdict("grey");
const GENUINE = recordedVerdict("genuine");
const STATUS = recordedStatus();

const SCENES: Scene[] = [
  {
    id: "arrives",
    title: "A text arrives",
    narration:
      "It is Tuesday afternoon. Margaret is seventy-four, she stammers, and she has a phone she does not trust. It buzzes. A text says she is owed a tax refund, and she has twenty-four hours to claim it.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "message",
  },
  {
    id: "decides",
    title: "The phone decides, in milliseconds",
    narration:
      "Before the text has finished arriving, the phone has read it. Three word patterns fire: a refund, a deadline, a link. The link says HMRC, but it is not HMRC's. A small text model, the same file the Gateway runs, scores it as scam-like. Nothing has left the phone.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "deciding",
  },
  {
    id: "speaks",
    title: "The phone speaks",
    narration: "Margaret does not have to read anything. The phone tells her, in her own language.",
    tempoSays: (language) => (language === "en" ? HMRC.say : translatedSay(HMRC, language)),
    sample: "hmrc",
    sender: "HMRC",
    screen: "card",
  },
  {
    id: "ledger",
    title: "Only four fields leave the phone",
    narration:
      "Now, and only now, the phone tells the Gateway. It sends which patterns fired, the link's host, the sender's domain and a score. It never sends the message. The Gateway checks the registers and the public phishing lists, and agrees.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "ledger",
  },
  {
    id: "hold",
    title: "The grey zone: hold, look, then speak",
    narration:
      "A second text, from a stranger: here is the link you asked for, and a shortened link. The words are harmless. The link is doubtful. So the phone holds it, and says so.",
    tempoSays: (language) => spokenLine(language, "hold"),
    sample: "grey",
    sender: "+44 7700 900321",
    screen: "hold",
  },
  {
    id: "settled",
    title: "The sandbox settles it",
    narration:
      "From the Gateway, never from the phone, Tempo follows the link in an isolated fetch. It lands on a page that only looks like Evri's, nine days old, asking for card details. Code settles the verdict, and the phone speaks it, seven seconds after the text arrived.",
    tempoSays: (language) => (language === "en" ? GREY.say : translatedSay(GREY, language)),
    sample: "grey",
    sender: "+44 7700 900321",
    screen: "settled",
  },
  {
    id: "quiet",
    title: "And when the bank really writes",
    narration:
      "Her bank sends a one-time code and says never share it. Nothing fires. The model scores it at two in a hundred. The phone stays quiet, because a shield that cries wolf is switched off within a week. If Margaret asks, Tempo says: no warning signs found. That does not prove it is genuine.",
    sample: "genuine",
    sender: "HSBC",
    screen: "quiet",
  },
  {
    id: "doors",
    title: "Every door, the same answer",
    narration:
      "Margaret's neighbour has a landline. He rings Tempo and reads the text out; the agent calls the same check and says the same words. Someone else forwards a text with the word CHECK and gets it back by SMS. And here, on the web, you can paste one yourself. One piece of code decides; the voice only carries it.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "doors",
  },
];

const RTL = new Set(["ur"]);

function bcp47(language: Language): string {
  return LANGUAGES.find((l) => l.code === language)?.bcp47 ?? "en-GB";
}

/** The four fields the phone sends, derived from the recorded verdict (docs/scam-shield.md §5.1). */
function leaves(verdict: ShieldVerdict, sender: string): { field: string; value: string }[] {
  const domain = sender.includes("@") ? sender.split("@").pop() ?? "" : "";
  return [
    { field: "rules", value: verdict.rules.join(",") || "(none)" },
    { field: "sender_domain", value: domain || "(a number or a name: nothing)" },
    { field: "link_hosts", value: verdict.links.map((l) => l.host).join(",") || "(none)" },
    { field: "score", value: verdict.confidence === null ? "(no model)" : verdict.confidence.toFixed(2) },
  ];
}

export function ShieldStory({ narrator, reducedMotion }: ShieldStoryProps) {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<Language>("en");
  const [playing, setPlaying] = useState(false);
  const [caption, setCaption] = useState<SpokenLine | null>(null);
  const [transcript, setTranscript] = useState<SpokenLine[]>([]);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [focused, setFocused] = useState<string>("nothing yet");
  const [systemReducedMotion, setSystemReducedMotion] = useState(Boolean(reducedMotion));
  // Whether the browser can speak is only known on the client; the server must render the same
  // page for everyone, so the note waits for the first client render.
  const [mounted, setMounted] = useState(false);
  const tourRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (reducedMotion !== undefined) return;
    try {
      setSystemReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      setSystemReducedMotion(false);
    }
  }, [reducedMotion]);

  const scene = SCENES[step]!;
  const verdict = scene.sample === "grey" ? GREY : scene.sample === "genuine" ? GENUINE : HMRC;
  const sample = SAMPLES.find((s) => s.id === scene.sample)!;
  const rtl = RTL.has(language);

  const linesFor = useCallback(
    (s: Scene): SpokenLine[] => {
      const lines: SpokenLine[] = [{ text: s.narration, language: "en" }];
      if (s.tempoSays) lines.push({ text: s.tempoSays(language), language });
      return lines;
    },
    [language],
  );

  const stop = useCallback(() => {
    tourRef.current = false;
    narrator.stop();
    setPlaying(false);
  }, [narrator]);

  const playFrom = useCallback(
    (index: number) => {
      const s = SCENES[index];
      if (!s) {
        stop();
        return;
      }
      setStep(index);
      const lines = linesFor(s);
      setPlaying(true);
      narrator.play(
        lines,
        (i) => {
          const line = lines[i]!;
          setCaption(line);
          setTranscript((t) => [...t, line]);
        },
        () => {
          if (tourRef.current) playFrom(index + 1);
          else setPlaying(false);
        },
      );
    },
    [linesFor, narrator, stop],
  );

  const playTour = () => {
    tourRef.current = true;
    playFrom(step);
  };
  const playThisStep = () => {
    tourRef.current = false;
    playFrom(step);
  };
  const go = (index: number) => {
    stop();
    setCardNote(null);
    setStep(Math.max(0, Math.min(SCENES.length - 1, index)));
  };

  const sayAgain = () => {
    const text = scene.tempoSays?.(language) ?? (language === "en" ? verdict.say : translatedSay(verdict, language));
    const line = { text, language };
    setCaption(line);
    setTranscript((t) => [...t, line]);
    narrator.play([line], () => undefined, () => undefined);
  };

  const knowSender = () => {
    const isNumber = /^\+?[\d\s]+$/.test(scene.sender ?? "");
    setCardNote(
      isNumber
        ? "All right. Messages from this number will not be checked on this phone."
        : "That sender is a name, not a number, so it cannot be trusted. Scammers use names.",
    );
  };

  const onFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const el = event.target as HTMLElement;
    const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 60) ?? el.tagName;
    setFocused(name || el.tagName.toLowerCase());
  };

  const visual = { opacity: eyesClosed ? 0.08 : 1, transition: systemReducedMotion ? "none" : "opacity 300ms" };
  const metrics = STATUS.model?.metrics ?? {};
  const pct = (v: number | undefined) => (v === undefined ? "n/a" : `${Math.round(v * 1000) / 10}%`);

  return (
    <div className="space-y-10" onFocus={onFocus}>
      {/* ---------------------------------------------------------------- the story */}
      <section aria-labelledby="story-heading" className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="story-heading" className="text-3xl font-bold">
            Margaret&apos;s Tuesday
          </h2>
          <Chip tone="teal">Recorded from the replay Gateway</Chip>
          {STATUS.model && <Chip>Text model {STATUS.model.version}</Chip>}
        </div>
        <p className="max-w-3xl text-lg text-slate-700">
          Press <strong>Play the story out loud</strong> and close your eyes: this is what Margaret hears. Or step through it with the
          buttons, the keyboard, or a screen reader. Every verdict below is a real answer from Tempo&apos;s Gateway, replayed; nothing
          is made up on this page.
        </p>

        <div role="group" aria-label="Story controls" className="flex flex-wrap items-end gap-3">
          {!playing ? (
            <button type="button" onClick={playTour} className="min-h-12 rounded-lg bg-teal-800 px-6 py-3 text-lg font-semibold text-white">
              Play the story out loud
            </button>
          ) : (
            <button type="button" onClick={stop} className="min-h-12 rounded-lg bg-rose-800 px-6 py-3 text-lg font-semibold text-white">
              Pause
            </button>
          )}
          <button type="button" onClick={playThisStep} disabled={playing} className="min-h-12 rounded-lg border-2 border-teal-800 px-5 py-3 text-lg font-semibold text-teal-900 disabled:opacity-50">
            Hear this step
          </button>
          <div>
            <label htmlFor="story-language" className="block text-base font-semibold">
              Tempo speaks in
            </label>
            <select
              id="story-language"
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
            aria-pressed={eyesClosed}
            onClick={() => setEyesClosed((v) => !v)}
            className={`min-h-12 rounded-lg border-2 px-5 py-3 text-lg font-semibold ${eyesClosed ? "border-slate-900 bg-slate-900 text-white" : "border-slate-700 text-slate-900"}`}
          >
            {eyesClosed ? "Eyes open" : "Eyes closed mode"}
          </button>
        </div>
        {mounted && !narrator.available && (
          <p role="note" className="rounded-lg border-2 border-amber-700 bg-amber-50 p-3 text-base">
            This browser cannot speak, so the captions below carry the words instead.
          </p>
        )}

        {/* captions: what is being said right now, for everyone */}
        <div
          aria-live="polite"
          aria-atomic="true"
          data-testid="captions"
          className={`rounded-xl border-4 border-slate-900 bg-slate-900 p-5 text-white ${eyesClosed ? "min-h-48" : "min-h-24"}`}
        >
          <p className="text-sm uppercase tracking-wide text-slate-300">{caption ? (caption.language === "en" && !scene.tempoSays?.(language).startsWith(caption.text) ? "Narrator" : "Tempo says") : "Captions"}</p>
          <p
            lang={caption ? bcp47(caption.language) : undefined}
            dir={caption && RTL.has(caption.language) ? "rtl" : "ltr"}
            className={`mt-1 leading-relaxed ${eyesClosed ? "text-3xl" : "text-xl"}`}
          >
            {caption?.text ?? "Press Play, or step through the story. What is spoken appears here, word for word."}
          </p>
        </div>

        {/* the stepper */}
        <nav aria-label="Story steps">
          <ol className="flex flex-wrap gap-2">
            {SCENES.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => go(i)}
                  className={`min-h-11 rounded-lg border-2 px-3 py-1 text-base ${i === step ? "border-teal-800 bg-teal-800 text-white" : "border-slate-300 bg-white text-slate-900"}`}
                >
                  <span className="sr-only">Step {i + 1} of {SCENES.length}: </span>
                  {i + 1}. {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          {/* the phone */}
          <div style={visual} aria-label={`Margaret's phone: ${scene.title}`} role="img" className="mx-auto w-full max-w-[22rem]">
            <div className="rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 p-2 shadow-xl">
              <div className="min-h-[34rem] rounded-[2rem] bg-white p-4 text-slate-900">
                <p className="text-center text-xs text-slate-500">Tuesday 14:07</p>
                {scene.screen === "card" || scene.screen === "settled" || scene.screen === "hold" ? (
                  <div
                    className={`mt-3 rounded-2xl p-4 text-white ${scene.screen === "hold" ? "bg-teal-800" : "bg-rose-900"}`}
                    aria-hidden="true"
                  >
                    <p className="text-3xl font-bold">{scene.screen === "hold" ? "Wait" : "Stop"}</p>
                    <p className="mt-2 text-lg leading-snug" lang={bcp47(language)} dir={rtl ? "rtl" : "ltr"}>
                      {scene.tempoSays?.(language)}
                    </p>
                    <div className="mt-3 space-y-2">
                      {["Read it again", "I know this sender", "I'm fine"].map((b) => (
                        <div key={b} className="rounded-lg bg-white/15 px-3 py-3 text-center text-base font-semibold">
                          {b}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-center text-sm font-semibold text-slate-700">{scene.sender}</p>
                    <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-slate-100 p-3 text-base leading-snug">
                      {scene.screen === "doors" ? (
                        <span>CHECK HMRC: You are due a tax refund of 248.20 GBP…</span>
                      ) : (
                        <span className={scene.screen === "ledger" ? "line-through decoration-rose-700 decoration-2" : ""}>{sample.text}</span>
                      )}
                    </div>
                    {scene.screen === "deciding" && (
                      <ul className="space-y-1 text-sm" aria-hidden="true">
                        {verdict.rules.map((r) => (
                          <li key={r} className="rounded-full border-2 border-amber-700 bg-amber-50 px-3 py-1 text-amber-950">
                            ● {RULE_WORDS[r] ?? r}
                          </li>
                        ))}
                        {verdict.links.map((l) => (
                          <li key={l.host} className="rounded-full border-2 border-rose-700 bg-rose-50 px-3 py-1 text-rose-950">
                            ● {l.words[0] ?? l.host}
                          </li>
                        ))}
                        {verdict.confidence !== null && (
                          <li className="rounded-full border-2 border-slate-700 bg-slate-50 px-3 py-1">● model: {Math.round(verdict.confidence * 100)} in 100</li>
                        )}
                      </ul>
                    )}
                    {scene.screen === "ledger" && (
                      <p className="text-center text-sm text-rose-800">The message stays here. Four fields leave →</p>
                    )}
                    {scene.screen === "quiet" && <p className="text-center text-sm text-slate-600">Tempo says nothing.</p>}
                    {scene.screen === "doors" && (
                      <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-teal-800 p-3 text-base leading-snug text-white">
                        Tempo: {HMRC.say.split(" Why:")[0]}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* the words beside the phone */}
          <div className="space-y-4">
            <h3 className="text-2xl font-semibold">
              {step + 1}. {scene.title}
            </h3>
            <p className="text-lg leading-relaxed">{scene.narration}</p>

            {scene.screen === "card" && (
              <div role="group" aria-label="The Shield card's buttons, working" className="rounded-xl border-2 border-rose-800 bg-rose-50 p-4" style={visual}>
                <p className="text-base font-semibold">The card&apos;s three buttons, live:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={sayAgain} className="min-h-12 rounded-lg border-2 border-rose-900 bg-white px-4 py-2 text-base font-semibold text-rose-950">
                    Read it again
                  </button>
                  <button type="button" onClick={knowSender} className="min-h-12 rounded-lg border-2 border-rose-900 bg-white px-4 py-2 text-base font-semibold text-rose-950">
                    I know this sender
                  </button>
                  <button type="button" onClick={() => setCardNote("The card closes. The log keeps the verdict, never the message.")} className="min-h-12 rounded-lg border-2 border-rose-900 bg-white px-4 py-2 text-base font-semibold text-rose-950">
                    I&apos;m fine
                  </button>
                </div>
                {cardNote && (
                  <p role="status" className="mt-3 text-base">
                    {cardNote}
                  </p>
                )}
              </div>
            )}

            {(scene.screen === "ledger" || scene.screen === "settled") && (
              <div className="rounded-xl border-2 border-slate-300 bg-white p-4" style={visual}>
                <h4 className="text-lg font-semibold">What left the phone</h4>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-base">
                  {leaves(verdict, scene.sender ?? "").map((f) => (
                    <div key={f.field} className="contents">
                      <dt className="text-slate-700">{f.field}</dt>
                      <dd className="break-all">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-base text-slate-700">
                  Not the message, not the number, not the name. The Gateway refuses anything more (a test proves it).
                </p>
              </div>
            )}

            {scene.screen !== "quiet" && scene.screen !== "message" && (
              <div className="rounded-xl border-2 border-slate-300 bg-white p-4" style={visual}>
                <h4 className="text-lg font-semibold">
                  {scene.screen === "settled" ? "What the sandbox found" : "Why, in plain words"}
                </h4>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
                  {verdict.why.slice(0, scene.screen === "deciding" ? 4 : 6).map((w) => (
                    <li key={w}>{w[0]?.toUpperCase()}{w.slice(1)}.</li>
                  ))}
                </ul>
              </div>
            )}

            {scene.screen === "quiet" && (
              <div className="rounded-xl border-2 border-teal-800 bg-teal-50 p-4" style={visual}>
                <p className="text-base">
                  Model score: <strong>{Math.round((GENUINE.confidence ?? 0) * 100)} in 100</strong>. Patterns fired: <strong>none</strong>.
                  Links: <strong>none</strong>. If asked: &quot;{GENUINE.say}&quot;
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="min-h-12 rounded-lg border-2 border-slate-700 px-5 py-2 text-lg font-semibold disabled:opacity-40">
                Back
              </button>
              <button type="button" onClick={() => go(step + 1)} disabled={step === SCENES.length - 1} className="min-h-12 rounded-lg bg-teal-800 px-5 py-2 text-lg font-semibold text-white disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- proof, not promises */}
      <section aria-labelledby="proof-heading" className="space-y-4">
        <h2 id="proof-heading" className="text-3xl font-bold">
          Prove the accessibility to yourself
        </h2>
        <p className="max-w-3xl text-lg text-slate-700">
          Each of these is something to try now, not a claim to take on trust.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <h3 className="text-xl font-semibold">Eyes shut</h3>
            <p className="mt-1 text-base">
              Switch on <strong>Eyes closed mode</strong> above: the pictures fade, the captions grow, the voice carries everything. That is
              Margaret&apos;s phone in her pocket.
            </p>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <h3 className="text-xl font-semibold">Keyboard only</h3>
            <p className="mt-1 text-base">
              Press <kbd className="rounded border px-1">Tab</kbd>. Every control is reachable in reading order and shows a thick amber ring.
            </p>
            <p role="status" className="mt-2 rounded-lg bg-slate-50 p-2 text-base">
              Focus is on: <strong>{focused}</strong>
            </p>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <h3 className="text-xl font-semibold">Screen reader</h3>
            <p className="mt-1 text-base">
              The captions are a live region, the steps are numbered, the phone is one described image, and everything Tempo said is in
              the transcript below.
            </p>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <h3 className="text-xl font-semibold">Bigger, plainer, slower</h3>
            <p className="mt-1 text-base">The whole site is set in rem, so these controls scale every word here. Nothing times out or moves on without you.</p>
            <div className="mt-2">
              <A11yControls compact />
            </div>
            <p className="mt-2 text-base">
              {systemReducedMotion
                ? "Your system asked for less motion, so nothing on this page animates."
                : "If your system asks for less motion, nothing on this page animates."}
            </p>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <h3 className="text-xl font-semibold">Six languages, right to left too</h3>
            <p className="mt-1 text-base">
              Choose Urdu above and press <strong>Hear this step</strong> on step 3: the warning is spoken and shown right to left, with the
              language marked for screen readers. The reasons stay in English until a speaker has checked a translation; we say so.
            </p>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <h3 className="text-xl font-semibold">No screen at all</h3>
            <p className="mt-1 text-base">
              Text <code>CHECK</code> and the message to Tempo&apos;s number, or ring and read it out: the same code answers, in the same words.
            </p>
          </div>
        </div>

        <details className="rounded-xl border-2 border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-lg font-semibold">Transcript: everything spoken on this page so far</summary>
          {transcript.length === 0 ? (
            <p className="mt-2 text-base text-slate-700">Nothing yet.</p>
          ) : (
            <ol aria-label="Transcript" className="mt-2 list-decimal space-y-1 pl-5 text-base">
              {transcript.map((line, i) => (
                <li key={`${i}-${line.text.slice(0, 12)}`} lang={bcp47(line.language)} dir={RTL.has(line.language) ? "rtl" : "ltr"}>
                  {line.text}
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>

      {/* ------------------------------------------------------------ the numbers */}
      <section aria-labelledby="numbers-heading" className="space-y-3">
        <h2 id="numbers-heading" className="text-3xl font-bold">
          The numbers, in plain words
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <dt className="text-base text-slate-700">Of what Tempo speaks about, scams</dt>
            <dd className="text-3xl font-bold">{pct(metrics.precision_at_warn)}</dd>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <dt className="text-base text-slate-700">Of the scams, spoken about</dt>
            <dd className="text-3xl font-bold">{pct(metrics.recall_at_warn)}</dd>
          </div>
          <div className="rounded-xl border-2 border-slate-200 bg-white p-4">
            <dt className="text-base text-slate-700">Genuine bank, NHS and council texts spoken about</dt>
            <dd className="text-3xl font-bold">{pct(metrics.synthetic_spoken_on_genuine)}</dd>
          </div>
        </dl>
        <p className="max-w-3xl text-base text-slate-700">
          Measured on the untouched test fold of two open SMS corpora (CC BY 4.0) and on held-out made-up bank, NHS and council texts
          the corpora never had. The model ranks; code decides when to speak. The model has never seen a 2026 scam text from the UK or
          India, and the registers, lists and sandbox here answered from recordings. Full tables and limits are in docs/scam_backtest.md.
        </p>
      </section>
    </div>
  );
}
