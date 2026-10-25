// The story (plan.md §2, §12.3): the ten beats as a guided demo. Each beat's "Try it" does the real
// thing: opens the page that shows it, or sends Margaret's sentence in the chat (`#/chat?say=`).
// "Play the story" reads the beats aloud one after another and highlights each; a progress rail
// shows which beats have been tried in this visit. Ends with what is real and what is not (§9).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Check, CheckCircle2, MessageCircle, Pause, Play, Rocket, Scale, Volume2 } from "lucide-react";
import { Button, Card, FOCUS, PageTitle, SectionTitle } from "@/components/ui";
import { linkProps } from "@/router";
import type { PageProps } from "@/types/page";
import { SAY, TAP, chatSay, shortSay } from "./demo";

export interface Beat {
  name: string;
  /** One plain sentence of what Tempo does. */
  sentence: string;
  /** What that is built as, in a muted line. */
  builtAs: string;
  /** The page that shows this beat best, and its name. */
  href: string;
  link: string;
  /** What "Try it" opens: a page, or the chat with a sentence (`#/chat?say=`). */
  tryHref: string;
  /** What will happen when you press it, in a few words. */
  tryHint: string;
}

const inChat = (text: string, then: string) => `Sends “${shortSay(text)}” in the chat: ${then}`;

export const BEATS: Beat[] = [
  {
    name: "Hear",
    sentence: "Tempo answers the way Margaret asked to be spoken to, before the first word: slowly, one question at a time, waiting as long as it takes.",
    builtAs: "the Patience Profile: access memories become the voice agent's instructions",
    href: "/callers",
    link: "Who's calling?",
    tryHref: "#/callers",
    tryHint: "Opens Who's calling? and shows how Tempo will speak with Margaret, Dilip and Joan, and why.",
  },
  {
    name: "Read",
    sentence: "It finds how late the train was, and reads a ticket, a card or a letter back to her, asking about anything it is unsure of.",
    builtAs: "rail data over MCP; vision intake with read-back",
    href: "/read",
    link: "Read It To Me",
    tryHref: "#/read",
    tryHint: "Opens Read It To Me. Press a sample photo and hear the letter.",
  },
  {
    name: "Price",
    sentence: "The amount comes from a YAML rule pack with a citation, never from a model.",
    builtAs: "the Rights Engine and its Proof Trace (ADR 0003)",
    href: "/missions",
    link: "Mission Control",
    tryHref: chatSay(SAY.lateTrain),
    tryHint: inChat(SAY.lateTrain, "the amount comes with its rule."),
  },
  {
    name: "Check",
    sentence: "Three AI jurors check the reading, each a different model; they may say no, and they can never raise the amount.",
    builtAs: "the Consensus Court",
    href: "/missions",
    link: "Mission Control",
    tryHref: chatSay(SAY.lateTrain),
    tryHint: inChat(SAY.lateTrain, "the Court's votes are under the ask."),
  },
  {
    name: "Weigh",
    sentence: "It asks whether the claim is worth her time, at her own value of an hour.",
    builtAs: "the Arbiter and the Time Ledger",
    href: "/missions",
    link: "Mission Control",
    tryHref: chatSay(SAY.lateTrain),
    tryHint: inChat(SAY.lateTrain, "the ask says what her time is worth."),
  },
  {
    name: "Time it",
    sentence: "Every right has a clock, and sometimes the right move is to wait, with the date.",
    builtAs: "Rights Decay, backtested on real case data",
    href: "/missions",
    link: "Mission Control",
    tryHref: chatSay(SAY.broadband),
    tryHint: inChat(SAY.broadband, "Tempo may wait on purpose, and says until when."),
  },
  {
    name: "Ask once",
    sentence: "It asks one question and acts only on a signed yes; STOP stops everything.",
    builtAs: "the consent ledger where deny wins (ADR 0004), passkeys",
    href: "/chat",
    link: "The chat",
    tryHref: chatSay(SAY.lateTrain),
    tryHint: inChat(SAY.lateTrain, "answer Yes or No, or say STOP."),
  },
  {
    name: "Prove it",
    sentence: "It shows the company's own AI a mandate it can verify in milliseconds, and the company refuses anything outside it.",
    builtAs: "the Agent Passport, red-teamed",
    href: "/missions",
    link: "Mission Control",
    tryHref: "#/devices",
    tryHint: "Opens Devices: set up Face ID on this browser, and the Agent Passport a company can check.",
  },
  {
    name: "Remember only her words",
    sentence: "It keeps what she said and official data; company text is evidence, never memory; everything is dated and forgettable.",
    builtAs: "the Memory Gate and the Memory Card",
    href: "/memory",
    link: "Memory",
    tryHref: chatSay(SAY.remember),
    tryHint: inChat(SAY.remember, "only her own words come back."),
  },
  {
    name: "Return the time",
    sentence: "It counts hours and pounds returned only once the money has arrived.",
    builtAs: "the Watchdog and the Time Ledger",
    href: "/missions",
    link: "Mission Control",
    tryHref: chatSay(SAY.returned),
    tryHint: inChat(SAY.returned, "pounds and hours, counted once the money has arrived."),
  },
];

/** What is real in every run, so a judge knows what they are looking at. */
export const REAL = [
  "With a Gateway, every “Try it” runs the real thing: the chat posts to the Gateway's /chat, which starts missions, checks scams and recalls memory with the same code the phone and text doors use.",
  "Amounts come from YAML rule packs with a citation, never from a model; the Proof Trace shows the rule behind each pound.",
  "Tempo asks once and acts only on a yes; STOP stops every mission; the Memory Gate keeps only what she said and official data.",
  "In replay mode the company, the rail data, the jurors and vision answer from recordings, and the badge at the top of every page says so.",
  "The showcase (no Gateway) answers from replies recorded from a real replay-mode run.",
];

/** plan.md §9: what is honestly not done, and limits. */
export const NOT_DONE = [
  "Approvals use the demo bearer until this browser has Face ID or a fingerprint set up on the Devices page (Tempo Mesh).",
  "Speech in is the browser's recogniser (Chrome, Safari); Firefox records a clip and says so.",
  "Speech out needs an ElevenLabs key on the Gateway (or one pasted in Settings); otherwise the browser's own voice speaks and the face still moves.",
  "Small talk is canned in replay; a model phrases it only with a chat key, under word rules.",
  "The model picker in Settings labels the reply; the Gateway's deployment mode chooses the jurors.",
  "Rule packs, clocks and benefit figures are demo values until a person checks each source.",
  "Tauri is configured but not built here; GitHub Actions still fails at startup on the mirror account.",
  "Translations of spoken warnings are marked unchecked until a speaker has read each one.",
];

/** How long to leave a sentence on screen when the avatar reads it: a patient reading pace. */
export function readingMs(sentence: string): number {
  return Math.max(3500, Math.min(12_000, 1200 + sentence.length * 55));
}

// Which beats have been tried in this visit. Kept in memory only (pages never write storage), so
// it survives going to a beat's page and coming back, and resets on a reload.
let tried: ReadonlySet<number> = new Set();
const listeners = new Set<() => void>();
export const demoProgress = {
  mark(index: number) {
    if (tried.has(index)) return;
    tried = new Set([...tried, index]);
    listeners.forEach((l) => l());
  },
  reset() {
    tried = new Set();
    listeners.forEach((l) => l());
  },
};
function useTried(): ReadonlySet<number> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tried,
    () => tried,
  );
}

const beatId = (i: number) => `beat-${i + 1}`;

function reveal(index: number) {
  const el = document.getElementById(beatId(index));
  if (!el) return;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
}

export default function StoryPage({ speak, showcase }: PageProps) {
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useTried();
  const next = BEATS.findIndex((_, i) => !done.has(i));
  const nextBeat = next >= 0 ? BEATS[next]! : null;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  const playFrom = useCallback(
    (index: number) => {
      const beat = BEATS[index];
      if (!beat) {
        stop();
        setCurrent(null);
        return;
      }
      setCurrent(index);
      reveal(index);
      speak(`${beat.name}. ${beat.sentence}`);
      timer.current = setTimeout(() => playFrom(index + 1), readingMs(beat.sentence));
    },
    [speak, stop],
  );

  const play = () => {
    stop();
    setPlaying(true);
    playFrom(0);
  };

  const goTo = (index: number) => {
    reveal(index);
    document.getElementById(`${beatId(index)}-try`)?.focus({ preventScroll: true });
  };

  const highlighted = current ?? (next >= 0 ? next : null);

  return (
    <div className="space-y-6">
      <PageTitle lede="Margaret is 74, stammers, and rings from a landline. Her 08:12 to Paddington was 38 minutes late. That one fact runs through every part of Tempo, in ten beats. Each “Try it” does the real thing.">
        The story
      </PageTitle>

      <Card as="section" aria-labelledby="demo-heading" tone="indigo" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="demo-heading" className="text-base font-semibold text-slate-100">
              A guided demo, in ten beats
            </h2>
            <p className="mt-0.5 text-sm text-slate-300">
              {done.size === 0
                ? "Start at the first beat, then come back here for the next. Or play the whole story aloud first."
                : done.size === BEATS.length
                  ? "You have tried all ten beats. Play the story aloud to hear it end to end."
                  : `${done.size} of ${BEATS.length} beats tried. Next: ${nextBeat?.name}.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {nextBeat && (
              <a
                {...linkProps(nextBeat.tryHref)}
                onClick={(e) => {
                  demoProgress.mark(next);
                  linkProps(nextBeat.tryHref).onClick(e);
                }}
                className={`inline-flex ${TAP} items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 ${FOCUS}`}
              >
                <Rocket size={16} aria-hidden /> {done.size === 0 ? "Start the demo" : `Continue: ${nextBeat.name}`}
              </a>
            )}
            {playing ? (
              <Button variant="danger" onClick={stop} icon={<Pause size={16} aria-hidden />} className={TAP}>
                Pause
              </Button>
            ) : (
              <Button variant="quiet" onClick={play} icon={<Play size={16} aria-hidden />} className={TAP}>
                Play the story
              </Button>
            )}
          </div>
        </div>

        <nav aria-label="Demo progress">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>
              {done.size} of {BEATS.length} tried
            </span>
            {done.size > 0 && (
              <button type="button" onClick={() => demoProgress.reset()} className={`rounded-full px-2 py-1 text-xs text-slate-300 underline hover:text-white ${FOCUS}`}>
                Start over
              </button>
            )}
          </div>
          <div aria-hidden className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400 transition-all motion-reduce:transition-none" style={{ width: `${(done.size / BEATS.length) * 100}%` }} />
          </div>
          <ol className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {BEATS.map((beat, i) => {
              const isDone = done.has(i);
              const isHere = highlighted === i;
              return (
                <li key={beat.name}>
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={isHere ? "step" : undefined}
                    aria-label={`Beat ${i + 1}: ${beat.name}${isDone ? ", tried" : ""}`}
                    title={beat.name}
                    className={`flex ${TAP} w-full items-center justify-center gap-1 rounded-xl border text-sm font-semibold transition-colors motion-reduce:transition-none ${FOCUS} ${
                      isHere ? "border-indigo-300 bg-indigo-600 text-white" : isDone ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200" : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {isDone && !isHere ? <Check size={14} aria-hidden /> : null}
                    {i + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <p aria-live="polite" className={playing ? "text-sm text-indigo-100" : "sr-only"}>
          {playing && current !== null ? `Reading beat ${current + 1} of ${BEATS.length}: ${BEATS[current]!.name}.` : ""}
        </p>
      </Card>

      <ol aria-label="The ten beats" className="relative space-y-3 border-l-2 border-white/10 pl-6 sm:pl-8">
        {BEATS.map((beat, i) => {
          const active = current === i;
          const isDone = done.has(i);
          const tryIsPage = beat.tryHref === `#${beat.href}`;
          return (
            <li key={beat.name} id={beatId(i)} className="relative scroll-mt-6">
              <span
                aria-hidden
                className={`absolute -left-[2.3rem] top-4 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold sm:-left-[2.8rem] ${
                  active ? "bg-indigo-500 text-white ring-4 ring-indigo-500/30" : isDone ? "bg-emerald-600 text-white" : "bg-nexus-badge text-white"
                }`}
              >
                {isDone && !active ? <Check size={14} /> : i + 1}
              </span>
              <Card tone={active ? "indigo" : "default"} aria-current={active ? "step" : undefined} className="transition-colors motion-reduce:transition-none">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-100">{beat.name}</h2>
                  {isDone && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                      <CheckCircle2 size={12} aria-hidden /> tried
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-slate-200">{beat.sentence}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Built as {beat.builtAs}.
                  {!tryIsPage && (
                    <>
                      {" "}
                      <a {...linkProps(beat.href)} className={`font-medium text-indigo-200 underline decoration-indigo-300/40 underline-offset-2 hover:decoration-indigo-200 ${FOCUS}`}>
                        See it on {beat.link}
                      </a>
                    </>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    {...linkProps(beat.tryHref)}
                    id={`${beatId(i)}-try`}
                    aria-describedby={`${beatId(i)}-hint`}
                    onClick={(e) => {
                      demoProgress.mark(i);
                      linkProps(beat.tryHref).onClick(e);
                    }}
                    className={`inline-flex ${TAP} items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 ${FOCUS}`}
                  >
                    {beat.tryHref.startsWith("#/chat?say=") ? <MessageCircle size={14} aria-hidden /> : <ArrowRight size={14} aria-hidden />}
                    Try it<span className="sr-only">: {beat.name}</span>
                  </a>
                  <Button variant="quiet" onClick={() => speak(`${beat.name}. ${beat.sentence}`)} icon={<Volume2 size={14} aria-hidden />} aria-label={`Read “${beat.name}” aloud`} className={TAP}>
                    Read
                  </Button>
                </div>
                <p id={`${beatId(i)}-hint`} className="mt-2 text-xs text-slate-300">
                  {beat.tryHint}
                </p>
              </Card>
            </li>
          );
        })}
      </ol>

      <Card as="section" aria-labelledby="forgot-heading">
        <SectionTitle id="forgot-heading">Built for the people the internet forgot</SectionTitle>
        <p className="text-sm text-slate-200">
          The same people are hit from every side at once: they cannot read the letter, cannot hear the call, cannot navigate the app, and are the ones scammers
          target. Tempo's answer is one agent that reads to you, listens patiently, warns you, and is built so that it <strong className="text-slate-100">cannot</strong> move
          your money or act without your signed yes.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {[
            { to: "/read", label: "I can't read the letter" },
            { to: "/callers", label: "I can't hear the call" },
            { to: "/shield", label: "I'm the one scammers target" },
            { to: "/owed", label: "Am I owed anything?" },
          ].map((item) => (
            <li key={item.to}>
              <a {...linkProps(item.to)} className={`inline-flex ${TAP} items-center gap-1 rounded-full border border-white/10 bg-white/5 px-4 text-slate-200 hover:bg-white/10 ${FOCUS}`}>
                {item.label} <ArrowRight size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="judges-heading" tone="amber" className="space-y-4">
        <h2 id="judges-heading" className="flex items-center gap-2 text-base font-semibold text-amber-50">
          <Scale size={16} aria-hidden className="text-amber-300" /> For judges: what is real
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Real in every run</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-100">
              {REAL.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 id="honesty-heading" className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              What is honestly not done
            </h3>
            <ul aria-labelledby="honesty-heading" className="mt-2 space-y-1.5 text-sm text-amber-50">
              {NOT_DONE.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-xs text-amber-200/80">
          The badge at the top of every page says what is real in each run.{showcase ? " In the showcase everything is a recording of a replay-mode Gateway, and the badge says so." : ""}
        </p>
      </Card>
    </div>
  );
}
