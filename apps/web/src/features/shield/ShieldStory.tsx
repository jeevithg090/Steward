// Margaret's Tuesday: how Scam Shield works, told so that it can be *heard* as well as seen.
// Everything here is recorded from a real replay-mode Gateway (the verdicts) or is the exact
// sentence the voice says (voice/warnings.yaml); nothing is invented in the browser. Built to be
// used with the eyes shut, with a keyboard only, with a screen reader. Ported from the old
// ShieldStory; dark theme.
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import {
  AudioLines,
  BatteryFull,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Keyboard,
  Languages,
  Pause,
  Play,
  ScrollText,
  Signal,
  Smartphone,
  TriangleAlert,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import { Badge, Button, Card, FOCUS, Kbd, SectionTitle } from "@/components/ui";
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
  const stepsRef = useRef<HTMLOListElement>(null);

  useEffect(() => () => narrator.stop(), [narrator]);

  // On a phone the steps scroll sideways: keep the current one in view (sideways only, never the page).
  useEffect(() => {
    const list = stepsRef.current;
    const item = list?.children[step] as HTMLElement | undefined;
    if (!list || !item || list.scrollWidth <= list.clientWidth) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo?.({ left: Math.max(0, item.offsetLeft - 16), behavior: reduce ? "auto" : "smooth" });
  }, [step]);

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
    <div className="space-y-10" onFocus={onFocus}>
      <section aria-labelledby="story-heading" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="story-heading" className="font-display text-[2.1rem] leading-[1.05] text-white sm:text-[2.6rem]">
              Margaret's <em className="text-brand">Tuesday</em>
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="emerald" dot>
                Recorded from the replay Gateway
              </Badge>
              {STATUS.model && <Badge tone="slate">Text model {STATUS.model.version}</Badge>}
            </div>
          </div>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-slate-300">
          Press <strong className="font-semibold text-white">Play the story out loud</strong> and close your eyes: this is what Margaret hears. Or step through it with the buttons, the keyboard, or
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
          <div className="w-full min-[460px]:w-56">
            <LanguagePicker id="story-language" label="Tempo speaks in" value={language} onChange={onLanguage} />
          </div>
          <Button variant={eyesClosed ? "primary" : "quiet"} size="lg" aria-pressed={eyesClosed} onClick={() => setEyesClosed((v) => !v)} icon={eyesClosed ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}>
            {eyesClosed ? "Eyes open" : "Eyes closed mode"}
          </Button>
        </div>
        {!narrator.available && (
          <p role="note" className="flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-100">
            <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
            <span>This browser cannot speak, so the captions below carry the words instead.</span>
          </p>
        )}

        {/* captions: what is being said right now, for everyone */}
        <div
          aria-live="polite"
          aria-atomic="true"
          data-testid="captions"
          className={`relative overflow-hidden rounded-3xl border border-accent-400/25 bg-gradient-to-b from-accent-500/[0.14] to-accent-500/[0.03] p-5 shadow-[0_24px_60px_-34px_rgb(var(--accent-600)/0.8)] sm:p-6 ${eyesClosed ? "min-h-48" : "min-h-28"}`}
        >
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-200">
            <span aria-hidden className={`relative grid h-5 w-5 place-items-center rounded-full ${playing ? "bg-accent-500/30" : "bg-white/[0.06]"}`}>
              {playing && <span className="absolute inset-0 rounded-full bg-accent-400/40 motion-safe:animate-ripple" />}
              <AudioLines size={11} className="relative" />
            </span>
            {caption ? (captionIsTempo || captionIsTempoEnglish ? "Tempo says" : "Narrator") : "Captions"}
          </p>
          <p
            lang={caption ? bcp47(caption.language) : undefined}
            dir={caption && RTL.has(caption.language) ? "rtl" : "ltr"}
            className={`mt-3 leading-relaxed ${caption ? "text-white" : "text-slate-300"} ${eyesClosed ? "text-2xl sm:text-3xl" : "text-base sm:text-lg"}`}
          >
            {caption?.text ?? "Press Play, or step through the story. What is spoken appears here, word for word."}
          </p>
        </div>

        <nav aria-label="Story steps" className="-mx-4 sm:mx-0">
          <ol ref={stepsRef} className="relative flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
            {SCENES.map((s, i) => {
              const here = i === step;
              const past = i < step;
              return (
                <li key={s.id} className="w-[15.5rem] shrink-0 snap-start scroll-ml-4 sm:w-auto">
                  <button
                    type="button"
                    aria-current={here ? "step" : undefined}
                    aria-label={`Step ${i + 1} of ${SCENES.length}: ${s.title}`}
                    onClick={() => go(i)}
                    className={`group flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left text-[13px] leading-snug transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none ${FOCUS} ${
                      here
                        ? "border-accent-400/50 bg-accent-500/[0.14] text-white shadow-[0_12px_30px_-18px_rgb(var(--accent-600)/0.9)]"
                        : "border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`num relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                        here
                          ? "bg-gradient-to-b from-accent-500 to-accent-700 text-white shadow-glow"
                          : past
                            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-emerald-950"
                            : "bg-ink-800 text-slate-300 ring-1 ring-inset ring-white/15"
                      }`}
                    >
                      {past ? <Check size={15} strokeWidth={2.75} /> : i + 1}
                    </span>
                    <span className="min-w-0">{s.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="grid gap-6 pt-2 lg:grid-cols-[20rem_1fr] lg:gap-8">
          {/* the phone */}
          <div style={visual} aria-label={`Margaret's phone: ${scene.title}`} role="img" className="mx-auto w-full max-w-[20rem] motion-reduce:transition-none">
            <div className="relative">
              <div aria-hidden className="absolute inset-x-6 -bottom-6 top-10 rounded-full bg-accent-600/20 blur-3xl" />
              <div className="relative rounded-[2.9rem] bg-gradient-to-b from-slate-500/50 via-slate-700/60 to-slate-800/60 p-[2px] shadow-[0_40px_80px_-32px_rgb(0_0_0/0.95)]">
                <div className="rounded-[2.8rem] bg-ink p-2.5">
                  <div className="relative min-h-[31rem] overflow-hidden rounded-[2.2rem] bg-gradient-to-b from-ink-700 via-ink-900 to-ink px-4 pb-6 pt-3 text-slate-100">
                    <div className="flex items-center justify-between px-2 text-[11px] font-semibold text-slate-200">
                      <span className="num">14:07</span>
                      <span className="h-[22px] w-[86px] rounded-full bg-black ring-1 ring-white/[0.06]" />
                      <span className="flex items-center gap-1 text-slate-300">
                        <Signal size={11} />
                        <Wifi size={11} />
                        <BatteryFull size={13} />
                      </span>
                    </div>
                    <p className="mt-3 text-center text-xs text-slate-400">Tuesday 14:07</p>
                    {scene.screen === "card" || scene.screen === "settled" || scene.screen === "hold" ? (
                      <div
                        className={`mt-4 rounded-3xl p-4 text-white shadow-[0_20px_40px_-20px_rgb(0_0_0/0.9)] ring-1 ring-inset ring-white/15 ${
                          scene.screen === "hold" ? "bg-amber-700 bg-gradient-to-b from-amber-700 to-amber-800" : "bg-rose-700 bg-gradient-to-b from-rose-600 to-rose-800"
                        }`}
                        aria-hidden="true"
                      >
                        <p className="flex items-center gap-2 text-2xl font-bold">
                          <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/15">{scene.screen === "hold" ? <TriangleAlert size={17} /> : <X size={18} strokeWidth={3} />}</span>
                          {scene.screen === "hold" ? "Wait" : "Stop"}
                        </p>
                        <p className="mt-3 text-sm leading-snug" lang={bcp47(language)} dir={rtl ? "rtl" : "ltr"}>
                          {scene.tempoSays?.(language)}
                        </p>
                        <div className="mt-4 space-y-2">
                          {["Read it again", "I know this sender", "I'm fine"].map((b) => (
                            <div key={b} className="rounded-full bg-white/15 px-3 py-2 text-center text-sm font-semibold ring-1 ring-inset ring-white/10">
                              {b}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-b from-slate-500 to-slate-700 text-sm font-semibold text-white">{scene.sender.replace(/[^A-Za-z0-9]/g, "").charAt(0)}</span>
                          <p className="text-center text-xs font-semibold text-slate-300">{scene.sender}</p>
                        </div>
                        <div className="max-w-[90%] rounded-2xl rounded-tl-md bg-white/10 p-3 text-sm leading-snug">
                          {scene.screen === "doors" ? (
                            <span>CHECK HMRC: You are due a tax refund of 248.20 GBP…</span>
                          ) : (
                            <span className={scene.screen === "ledger" ? "line-through decoration-rose-400 decoration-2" : ""}>{sample.text}</span>
                          )}
                        </div>
                        {scene.screen === "deciding" && (
                          <ul className="space-y-1.5 text-xs" aria-hidden="true">
                            {verdict.rules.map((r) => (
                              <li key={r} className="flex items-center gap-2 rounded-full border border-amber-400/35 bg-amber-500/[0.12] px-3 py-1 text-amber-100">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" /> {RULE_WORDS[r] ?? r}
                              </li>
                            ))}
                            {verdict.links.map((l) => (
                              <li key={l.host} className="flex items-center gap-2 rounded-full border border-rose-400/35 bg-rose-500/[0.12] px-3 py-1 text-rose-100">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" /> {l.words[0] ?? l.host}
                              </li>
                            ))}
                            {verdict.confidence !== null && (
                              <li className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" /> model: {Math.round(verdict.confidence * 100)} in 100
                              </li>
                            )}
                          </ul>
                        )}
                        {scene.screen === "ledger" && <p className="text-center text-xs text-rose-200">The message stays here. Four fields leave →</p>}
                        {scene.screen === "quiet" && <p className="text-center text-xs text-slate-400">Tempo says nothing.</p>}
                        {scene.screen === "doors" && (
                          <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-md bg-gradient-to-b from-accent-600 to-accent-700 p-3 text-sm leading-snug text-white">Tempo: {HMRC.say.split(" Why:")[0]}</div>
                        )}
                      </div>
                    )}
                    <span className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/25" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* the words beside the phone */}
          <div className="min-w-0 space-y-4">
            <p aria-hidden className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-200">
              Step {step + 1} of {SCENES.length}
            </p>
            <h3 className="font-display text-[1.9rem] leading-[1.1] text-white sm:text-[2.2rem]">
              {step + 1}. {scene.title}
            </h3>
            <p className="max-w-2xl text-[15px] leading-relaxed text-slate-200">{scene.narration}</p>

            {scene.screen === "card" && (
              <Card role="group" aria-label="The Shield card's buttons, working" tone="rose" style={visual}>
                <p className="text-sm font-medium text-rose-100">The card's three buttons, live:</p>
                <div className="mt-3 flex flex-wrap gap-2">
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
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-black/30 p-4 font-mono text-xs ring-1 ring-inset ring-white/[0.06]">
                  {leaves(verdict, scene.sender).map((f) => (
                    <div key={f.field} className="contents">
                      <dt className="text-accent-300">{f.field}</dt>
                      <dd className="break-all text-slate-100">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[13px] text-slate-400">Not the message, not the number, not the name. The Gateway refuses anything more (a test proves it).</p>
              </Card>
            )}

            {scene.screen !== "quiet" && scene.screen !== "message" && (
              <Card style={visual}>
                <SectionTitle as="h3">{scene.screen === "settled" ? "What the sandbox found" : "Why, in plain words"}</SectionTitle>
                <ul className="space-y-2.5 text-sm text-slate-200">
                  {verdict.why.slice(0, scene.screen === "deciding" ? 4 : 6).map((w) => (
                    <li key={w} className="flex items-start gap-2.5 leading-relaxed">
                      <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/25">
                        <X size={11} strokeWidth={3} />
                      </span>
                      {capital(w)}.
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {scene.screen === "quiet" && (
              <Card tone="emerald" style={visual}>
                <p className="text-sm leading-relaxed text-slate-200">
                  Model score: <strong className="text-white">{Math.round((GENUINE.confidence ?? 0) * 100)} in 100</strong>. Patterns fired: <strong className="text-white">none</strong>. Links:{" "}
                  <strong className="text-white">none</strong>. If asked: “{GENUINE.say}”
                </p>
              </Card>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="quiet" onClick={() => go(step - 1)} disabled={step === 0} icon={<ChevronLeft size={16} aria-hidden />} className="min-h-[44px]">
                Back
              </Button>
              <Button onClick={() => go(step + 1)} disabled={step === SCENES.length - 1} icon={<ChevronRight size={16} aria-hidden />} className="min-h-[44px]">
                Next
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="proof-heading" className="space-y-3">
        <SectionTitle id="proof-heading">Prove the accessibility to yourself</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <ProofCard icon={<EyeOff size={17} strokeWidth={1.85} />} title="Eyes shut">
            Switch on <strong className="text-slate-100">Eyes closed mode</strong> above: the pictures fade, the captions grow, the voice carries everything. That is Margaret's phone in her pocket.
          </ProofCard>
          <ProofCard
            icon={<Keyboard size={17} strokeWidth={1.85} />}
            title="Keyboard only"
            extra={
              <p role="status" className="mt-3 truncate rounded-xl bg-black/30 px-3 py-2 text-xs text-slate-200 ring-1 ring-inset ring-white/[0.06]">
                Focus is on: <strong className="text-white">{focused}</strong>
              </p>
            }
          >
            Press <Kbd>Tab</Kbd>. Every control is reachable in reading order and shows a white ring.
          </ProofCard>
          <ProofCard icon={<Smartphone size={17} strokeWidth={1.85} />} title="Screen reader">
            The captions are a live region, the steps are numbered, the phone is one described image, and everything Tempo said is in the transcript below.
          </ProofCard>
          <ProofCard icon={<Languages size={17} strokeWidth={1.85} />} title="Six languages, right to left too">
            Choose Urdu above and press <strong className="text-slate-100">Hear this step</strong> on step 3: the warning is spoken and shown right to left, with the language marked for screen readers. The
            reasons stay in English until a speaker has checked a translation; we say so.
          </ProofCard>
        </div>

        <details className="group surface rounded-2xl px-4 py-1">
          <summary className={`flex min-h-[48px] cursor-pointer list-none items-center gap-2.5 rounded-xl text-sm font-medium text-accent-200 hover:text-white [&::-webkit-details-marker]:hidden ${FOCUS}`}>
            <ScrollText size={16} aria-hidden className="shrink-0 text-accent-300" />
            <span className="flex-1">Transcript: everything spoken on this page so far</span>
            <ChevronDown size={16} aria-hidden className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="pb-4">
            {transcript.length === 0 ? (
              <p className="mt-1 text-[13px] text-slate-400">Nothing yet.</p>
            ) : (
              <ol aria-label="Transcript" className="mt-1 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-200 marker:text-slate-400">
                {transcript.map((line, i) => (
                  <li key={`${i}-${line.text.slice(0, 12)}`} lang={bcp47(line.language)} dir={RTL.has(line.language) ? "rtl" : "ltr"}>
                    {line.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
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
            <div key={n.label} className="surface flex flex-col-reverse justify-end gap-2 rounded-3xl p-5">
              <dt className="text-[13px] leading-snug text-slate-400">{n.label}</dt>
              <dd className="num text-[2rem] font-semibold leading-none tracking-[-0.02em] text-white">{n.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[13px] leading-relaxed text-slate-400">
          Measured on a held-out fold of {metrics.n_test ?? "the"} public scam and genuine texts, and on synthetic bank, NHS and council messages. The model ranks; the rules and
          the sandbox decide what is spoken.
        </p>
      </section>
    </div>
  );
}

function ProofCard({ icon, title, children, extra }: { icon: ReactNode; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Card padding="tight" className="!p-4 sm:!p-5">
      <div className="flex items-start gap-3.5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-accent-500/25 to-accent-700/10 text-accent-100 ring-1 ring-inset ring-accent-300/20">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{children}</p>
          {extra}
        </div>
      </div>
    </Card>
  );
}
