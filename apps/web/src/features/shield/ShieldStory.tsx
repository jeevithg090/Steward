// Margaret's Tuesday: how Scam Shield works, told so that it can be *heard* as well as seen.
// Everything here is recorded from a real replay-mode Gateway (the verdicts) or is the exact
// sentence the voice says (voice/warnings.yaml); nothing is invented in the browser. Built to be
// used with the eyes shut, with a keyboard only, with a screen reader. Ported from the old
// ShieldStory; dark theme.
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play, Volume2 } from "lucide-react";
import { Badge, Button, Card, FOCUS, SectionTitle } from "@/components/ui";
import { LANGUAGES, RULE_WORDS, SAMPLES, type Language, type Narrator, type ShieldVerdict, type SpokenLine, recordedStatus, recordedVerdict, spokenLine, translatedSay } from "@/lib/shield";
import { LanguagePicker } from "./ShieldPanel";

export interface ShieldStoryProps {
  narrator: Narrator;
  language: Language;
  onLanguage: (language: Language) => void;
}

interface Scene {
  id: string;
  title: string;
  /** What the narrator says about this moment (English). */
  narration: string;
  /** What Tempo itself says here, if anything: spoken in the chosen language. */
  tempoSays?: (language: Language) => string;
  sample: (typeof SAMPLES)[number]["id"];
  sender: string;
  /** What is on the phone's screen. */
  screen: "message" | "deciding" | "card" | "ledger" | "hold" | "settled" | "quiet" | "doors";
}

const HMRC = recordedVerdict("hmrc");
const GREY = recordedVerdict("grey");
const GENUINE = recordedVerdict("genuine");
const STATUS = recordedStatus();

export const SCENES: Scene[] = [
  {
    id: "arrives",
    title: "A text arrives",
    narration: "It is Tuesday afternoon. Margaret is seventy-four, she stammers, and she has a phone she does not trust. It buzzes. A text says she is owed a tax refund, and she has twenty-four hours to claim it.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "message",
  },
  {
    id: "decides",
    title: "The phone decides, in milliseconds",
    narration: "Before the text has finished arriving, the phone has read it. Three word patterns fire: a refund, a deadline, a link. The link says HMRC, but it is not HMRC's. A small text model, the same file the Gateway runs, scores it as scam-like. Nothing has left the phone.",
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
    narration: "Now, and only now, the phone tells the Gateway. It sends which patterns fired, the link's host, the sender's domain and a score. It never sends the message. The Gateway checks the registers and the public phishing lists, and agrees.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "ledger",
  },
  {
    id: "hold",
    title: "The grey zone: hold, look, then speak",
    narration: "A second text, from a stranger: here is the link you asked for, and a shortened link. The words are harmless. The link is doubtful. So the phone holds it, and says so.",
    tempoSays: (language) => spokenLine(language, "hold"),
    sample: "grey",
    sender: "+44 7700 900321",
    screen: "hold",
  },
  {
    id: "settled",
    title: "The sandbox settles it",
    narration: "From the Gateway, never from the phone, Tempo follows the link in an isolated fetch. It lands on a page that only looks like Evri's, nine days old, asking for card details. Code settles the verdict, and the phone speaks it, seven seconds after the text arrived.",
    tempoSays: (language) => (language === "en" ? GREY.say : translatedSay(GREY, language)),
    sample: "grey",
    sender: "+44 7700 900321",
    screen: "settled",
  },
  {
    id: "quiet",
    title: "And when the bank really writes",
    narration: "Her bank sends a one-time code and says never share it. Nothing fires. The model scores it at two in a hundred. The phone stays quiet, because a shield that cries wolf is switched off within a week. If Margaret asks, Tempo says: no warning signs found. That does not prove it is genuine.",
    sample: "genuine",
    sender: "HSBC",
    screen: "quiet",
  },
  {
    id: "doors",
    title: "Every door, the same answer",
    narration: "Margaret's neighbour has a landline. He rings Tempo and reads the text out; the agent calls the same check and says the same words. Someone else forwards a text with the word CHECK and gets it back by SMS. And here, on the web, you can paste one yourself. One piece of code decides; the voice only carries it.",
    sample: "hmrc",
    sender: "HMRC",
    screen: "doors",
  },
];

const RTL = new Set<Language>(["ur"]);

function bcp47(language: Language): string {
  return LANGUAGES.find((l) => l.code === language)?.bcp47 ?? "en-GB";
}

/** The four fields the phone sends, derived from the recorded verdict (docs/scam-shield.md §5.1). */
export function leaves(verdict: ShieldVerdict, sender: string): { field: string; value: string }[] {
  const domain = sender.includes("@") ? (sender.split("@").pop() ?? "") : "";
  return [
    { field: "rules", value: verdict.rules.join(",") || "(none)" },
    { field: "sender_domain", value: domain || "(a number or a name: nothing)" },
    { field: "link_hosts", value: verdict.links.map((l) => l.host).join(",") || "(none)" },
    { field: "score", value: verdict.confidence === null ? "(no model)" : verdict.confidence.toFixed(2) },
  ];
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ShieldStory({ narrator, language, onLanguage }: ShieldStoryProps) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [caption, setCaption] = useState<SpokenLine | null>(null);
  const [transcript, setTranscript] = useState<SpokenLine[]>([]);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [cardNote, setCardNote] = useState<string | null>(null);
  const [focused, setFocused] = useState<string>("nothing yet");
  const tourRef = useRef(false);

  useEffect(() => () => narrator.stop(), [narrator]);

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
    const isNumber = /^\+?[\d\s]+$/.test(scene.sender);
    setCardNote(isNumber ? "All right. Messages from this number will not be checked on this phone." : "That sender is a name, not a number, so it cannot be trusted. Scammers use names.");
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const el = event.target as HTMLElement;
    const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 60) ?? el.tagName;
    setFocused(name || el.tagName.toLowerCase());
  };

  const visual = useMemo(() => ({ opacity: eyesClosed ? 0.08 : 1, transition: "opacity 300ms" }), [eyesClosed]);
  const metrics = STATUS.model?.metrics ?? {};
  const pct = (v: number | undefined) => (v === undefined ? "n/a" : `${Math.round(v * 1000) / 10}%`);
  const captionIsTempo = caption !== null && caption.language !== "en";
  const captionIsTempoEnglish = caption !== null && caption.language === "en" && scene.tempoSays !== undefined && scene.tempoSays("en") === caption.text;

  return (
    <div className="space-y-6" onFocus={onFocus}>
      <section aria-labelledby="story-heading" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="story-heading" className="text-lg font-semibold text-slate-100">
            Margaret's Tuesday
          </h2>
          <Badge tone="emerald">Recorded from the replay Gateway</Badge>
          {STATUS.model && <Badge tone="slate">Text model {STATUS.model.version}</Badge>}
        </div>
        <p className="text-sm text-slate-300">
          Press <strong className="text-slate-100">Play the story out loud</strong> and close your eyes: this is what Margaret hears. Or step through it with the buttons, the keyboard, or
          a screen reader. Every verdict below is a real answer from Tempo's Gateway, replayed; nothing is made up on this page.
        </p>

        <div role="group" aria-label="Story controls" className="flex flex-wrap items-end gap-3">
          {!playing ? (
            <Button size="lg" onClick={playTour} icon={<Play size={16} aria-hidden />}>
              Play the story out loud
            </Button>
          ) : (
            <Button size="lg" variant="danger" onClick={stop} icon={<Pause size={16} aria-hidden />}>
              Pause
            </Button>
          )}
          <Button variant="quiet" size="lg" onClick={playThisStep} disabled={playing} icon={<Volume2 size={16} aria-hidden />}>
            Hear this step
          </Button>
          <LanguagePicker id="story-language" label="Tempo speaks in" value={language} onChange={onLanguage} />
          <Button variant={eyesClosed ? "primary" : "quiet"} size="lg" aria-pressed={eyesClosed} onClick={() => setEyesClosed((v) => !v)} icon={eyesClosed ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}>
            {eyesClosed ? "Eyes open" : "Eyes closed mode"}
          </Button>
        </div>
        {!narrator.available && (
          <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
            This browser cannot speak, so the captions below carry the words instead.
          </p>
        )}

        {/* captions: what is being said right now, for everyone */}
        <div aria-live="polite" aria-atomic="true" data-testid="captions" className={`rounded-2xl border border-indigo-500/40 bg-indigo-950/40 p-5 ${eyesClosed ? "min-h-48" : "min-h-24"}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-200">{caption ? (captionIsTempo || captionIsTempoEnglish ? "Tempo says" : "Narrator") : "Captions"}</p>
          <p lang={caption ? bcp47(caption.language) : undefined} dir={caption && RTL.has(caption.language) ? "rtl" : "ltr"} className={`mt-1 leading-relaxed text-slate-100 ${eyesClosed ? "text-2xl" : "text-base"}`}>
            {caption?.text ?? "Press Play, or step through the story. What is spoken appears here, word for word."}
          </p>
        </div>

        <nav aria-label="Story steps">
          <ol className="flex flex-wrap gap-1.5">
            {SCENES.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => go(i)}
                  className={`min-h-[44px] rounded-full border px-3.5 py-1 text-sm transition-colors motion-reduce:transition-none ${FOCUS} ${i === step ? "border-indigo-400 bg-indigo-600 text-white" : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"}`}
                >
                  <span className="sr-only">
                    Step {i + 1} of {SCENES.length}:{" "}
                  </span>
                  {i + 1}. {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
          {/* the phone */}
          <div style={visual} aria-label={`Margaret's phone: ${scene.title}`} role="img" className="mx-auto w-full max-w-[20rem] motion-reduce:transition-none">
            <div className="rounded-[2.5rem] border-[8px] border-slate-800 bg-slate-800 p-2 shadow-xl">
              <div className="min-h-[30rem] rounded-[2rem] bg-slate-950 p-4 text-slate-100">
                <p className="text-center text-xs text-slate-400">Tuesday 14:07</p>
                {scene.screen === "card" || scene.screen === "settled" || scene.screen === "hold" ? (
                  <div className={`mt-3 rounded-2xl p-4 text-white ${scene.screen === "hold" ? "bg-amber-700" : "bg-rose-800"}`} aria-hidden="true">
                    <p className="text-2xl font-bold">{scene.screen === "hold" ? "Wait" : "Stop"}</p>
                    <p className="mt-2 text-sm leading-snug" lang={bcp47(language)} dir={rtl ? "rtl" : "ltr"}>
                      {scene.tempoSays?.(language)}
                    </p>
                    <div className="mt-3 space-y-2">
                      {["Read it again", "I know this sender", "I'm fine"].map((b) => (
                        <div key={b} className="rounded-full bg-white/15 px-3 py-2 text-center text-sm font-semibold">
                          {b}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-center text-xs font-semibold text-slate-400">{scene.sender}</p>
                    <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-white/10 p-3 text-sm leading-snug">
                      {scene.screen === "doors" ? <span>CHECK HMRC: You are due a tax refund of 248.20 GBP…</span> : <span className={scene.screen === "ledger" ? "line-through decoration-rose-400 decoration-2" : ""}>{sample.text}</span>}
                    </div>
                    {scene.screen === "deciding" && (
                      <ul className="space-y-1 text-xs" aria-hidden="true">
                        {verdict.rules.map((r) => (
                          <li key={r} className="rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-amber-100">
                            ● {RULE_WORDS[r] ?? r}
                          </li>
                        ))}
                        {verdict.links.map((l) => (
                          <li key={l.host} className="rounded-full border border-rose-500/40 bg-rose-950/40 px-3 py-1 text-rose-100">
                            ● {l.words[0] ?? l.host}
                          </li>
                        ))}
                        {verdict.confidence !== null && <li className="rounded-full border border-white/15 bg-white/5 px-3 py-1">● model: {Math.round(verdict.confidence * 100)} in 100</li>}
                      </ul>
                    )}
                    {scene.screen === "ledger" && <p className="text-center text-xs text-rose-200">The message stays here. Four fields leave →</p>}
                    {scene.screen === "quiet" && <p className="text-center text-xs text-slate-400">Tempo says nothing.</p>}
                    {scene.screen === "doors" && <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-indigo-600 p-3 text-sm leading-snug text-white">Tempo: {HMRC.say.split(" Why:")[0]}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* the words beside the phone */}
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-slate-100">
              {step + 1}. {scene.title}
            </h3>
            <p className="text-sm leading-relaxed text-slate-200">{scene.narration}</p>

            {scene.screen === "card" && (
              <Card role="group" aria-label="The Shield card's buttons, working" tone="rose" style={visual}>
                <p className="text-sm font-medium text-rose-100">The card's three buttons, live:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="quiet" onClick={sayAgain} className="min-h-[44px]">
                    Read it again
                  </Button>
                  <Button variant="quiet" onClick={knowSender} className="min-h-[44px]">
                    I know this sender
                  </Button>
                  <Button variant="quiet" onClick={() => setCardNote("The card closes. The log keeps the verdict, never the message.")} className="min-h-[44px]">
                    I'm fine
                  </Button>
                </div>
                <p role="status" className="mt-3 min-h-[1rem] text-sm text-slate-200">
                  {cardNote}
                </p>
              </Card>
            )}

            {(scene.screen === "ledger" || scene.screen === "settled") && (
              <Card style={visual}>
                <SectionTitle as="h3">What left the phone</SectionTitle>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                  {leaves(verdict, scene.sender).map((f) => (
                    <div key={f.field} className="contents">
                      <dt className="text-slate-400">{f.field}</dt>
                      <dd className="break-all text-slate-100">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-slate-400">Not the message, not the number, not the name. The Gateway refuses anything more (a test proves it).</p>
              </Card>
            )}

            {scene.screen !== "quiet" && scene.screen !== "message" && (
              <Card style={visual}>
                <SectionTitle as="h3">{scene.screen === "settled" ? "What the sandbox found" : "Why, in plain words"}</SectionTitle>
                <ul className="space-y-1 text-sm text-slate-200">
                  {verdict.why.slice(0, scene.screen === "deciding" ? 4 : 6).map((w) => (
                    <li key={w} className="flex items-start gap-2">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                      {capital(w)}.
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {scene.screen === "quiet" && (
              <Card tone="emerald" style={visual}>
                <p className="text-sm text-slate-200">
                  Model score: <strong className="text-slate-100">{Math.round((GENUINE.confidence ?? 0) * 100)} in 100</strong>. Patterns fired: <strong className="text-slate-100">none</strong>. Links:{" "}
                  <strong className="text-slate-100">none</strong>. If asked: “{GENUINE.say}”
                </p>
              </Card>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="quiet" onClick={() => go(step - 1)} disabled={step === 0} icon={<ChevronLeft size={16} aria-hidden />}>
                Back
              </Button>
              <Button onClick={() => go(step + 1)} disabled={step === SCENES.length - 1} icon={<ChevronRight size={16} aria-hidden />}>
                Next
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="proof-heading" className="space-y-3">
        <SectionTitle id="proof-heading">Prove the accessibility to yourself</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <Card padding="tight">
            <h3 className="text-sm font-semibold text-slate-100">Eyes shut</h3>
            <p className="mt-1 text-xs text-slate-300">
              Switch on <strong>Eyes closed mode</strong> above: the pictures fade, the captions grow, the voice carries everything. That is Margaret's phone in her pocket.
            </p>
          </Card>
          <Card padding="tight">
            <h3 className="text-sm font-semibold text-slate-100">Keyboard only</h3>
            <p className="mt-1 text-xs text-slate-300">
              Press <kbd className="rounded border border-white/20 px-1">Tab</kbd>. Every control is reachable in reading order and shows a white ring.
            </p>
            <p role="status" className="mt-2 rounded-xl bg-black/20 px-2 py-1 text-xs text-slate-200">
              Focus is on: <strong>{focused}</strong>
            </p>
          </Card>
          <Card padding="tight">
            <h3 className="text-sm font-semibold text-slate-100">Screen reader</h3>
            <p className="mt-1 text-xs text-slate-300">The captions are a live region, the steps are numbered, the phone is one described image, and everything Tempo said is in the transcript below.</p>
          </Card>
          <Card padding="tight">
            <h3 className="text-sm font-semibold text-slate-100">Six languages, right to left too</h3>
            <p className="mt-1 text-xs text-slate-300">
              Choose Urdu above and press <strong>Hear this step</strong> on step 3: the warning is spoken and shown right to left, with the language marked for screen readers. The
              reasons stay in English until a speaker has checked a translation; we say so.
            </p>
          </Card>
        </div>

        <details className="rounded-2xl border border-white/10 bg-nexus-card p-4">
          <summary className={`cursor-pointer text-sm font-medium text-indigo-300 ${FOCUS}`}>Transcript: everything spoken on this page so far</summary>
          {transcript.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Nothing yet.</p>
          ) : (
            <ol aria-label="Transcript" className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">
              {transcript.map((line, i) => (
                <li key={`${i}-${line.text.slice(0, 12)}`} lang={bcp47(line.language)} dir={RTL.has(line.language) ? "rtl" : "ltr"}>
                  {line.text}
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>

      <section aria-labelledby="numbers-heading" className="space-y-3">
        <SectionTitle id="numbers-heading">The numbers, in plain words</SectionTitle>
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Of what Tempo speaks about, scams", value: pct(metrics.precision_at_warn) },
            { label: "Of the scams, caught", value: pct(metrics.recall_at_warn) },
            { label: "Genuine bank, NHS and council texts it spoke about", value: pct(metrics.synthetic_spoken_on_genuine) },
          ].map((n) => (
            <Card key={n.label} padding="tight">
              <dt className="text-xs text-slate-400">{n.label}</dt>
              <dd className="text-2xl font-semibold text-slate-100">{n.value}</dd>
            </Card>
          ))}
        </dl>
        <p className="text-xs text-slate-400">
          Measured on a held-out fold of {metrics.n_test ?? "the"} public scam and genuine texts, and on synthetic bank, NHS and council messages. The model ranks; the rules and
          the sandbox decide what is spoken.
        </p>
      </section>
    </div>
  );
}
