// The story (plan.md §2, §12.3): the ten beats as a guided demo. Each beat's "Try it" does the real
// thing: opens the page that shows it, or sends Margaret's sentence in the chat (`#/chat?say=`).
// "Play the story" reads the beats aloud one after another and highlights each; a progress rail
// shows which beats have been tried in this visit. Ends with what is real and what is not (§9).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  AudioLines,
  BadgeCheck,
  Brain,
  Check,
  CheckCircle2,
  CircleDashed,
  Coins,
  Ear,
  Gavel,
  Layers,
  type LucideIcon,
  MessageCircle,
  MessageCircleQuestion,
  Pause,
  Play,
  PoundSterling,
  Receipt,
  Rocket,
  RotateCcw,
  Scale,
  ScanText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  Volume2,
} from "lucide-react";
import { Badge, Button, Card, FOCUS, PageTitle, SectionTitle } from "@/components/ui";
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

/** One quiet icon per beat, beside its number (decorative). */
const BEAT_ICONS: Record<string, LucideIcon> = {
  Hear: Ear,
  Read: ScanText,
  Price: Receipt,
  Check: Gavel,
  Weigh: Scale,
  "Time it": Timer,
  "Ask once": MessageCircleQuestion,
  "Prove it": BadgeCheck,
  "Remember only her words": Brain,
  "Return the time": Coins,
};

/** The primary button's look, for links that act like one (Start the demo, Try it). */
const PRIMARY_LINK = `inline-flex ${TAP} select-none items-center justify-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-b from-violet-600 to-violet-700 font-semibold text-white shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_10px_28px_-12px_rgb(124_58_237/0.9)] transition-[transform,box-shadow,background-color] duration-150 ease-out hover:from-violet-500 hover:to-violet-700 hover:shadow-[0_1px_0_0_rgb(255_255_255/0.28)_inset,0_14px_34px_-12px_rgb(139_92_246/0.95)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${FOCUS}`;

/** A numbered ring: emerald with a tick once tried, violet and glowing for the beat in hand. */
function BeatRing({ n, done, here, next = false, compact = false }: { n: number; done: boolean; here: boolean; next?: boolean; compact?: boolean }) {
  return (
    <span
      aria-hidden
      className={`num relative z-10 grid shrink-0 place-items-center rounded-full text-sm font-semibold transition-[background-color,box-shadow,color] duration-300 motion-reduce:transition-none ${compact ? "h-9 w-9 sm:h-11 sm:w-11" : "h-11 w-11"} ${
        here
          ? "bg-gradient-to-b from-violet-500 to-violet-700 text-white shadow-glow"
          : done
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-emerald-950 shadow-[0_0_0_4px_rgb(16_185_129/0.12),0_8px_20px_-8px_rgb(16_185_129/0.7)]"
            : next
              ? "bg-ink-800 text-violet-100 ring-2 ring-inset ring-violet-400/60 shadow-[0_0_0_4px_rgb(139_92_246/0.12)]"
              : "bg-ink-800 text-slate-300 ring-1 ring-inset ring-white/15 group-hover:text-white group-hover:ring-violet-300/50"
      }`}
    >
      {here && <span className="absolute inset-0 rounded-full bg-violet-500/50 motion-safe:animate-ripple" />}
      <span className="relative">{done && !here ? <Check size={18} strokeWidth={2.75} /> : n}</span>
    </span>
  );
}

/** Margaret's 38 minutes, as a clock ring: decorative, the words beside it carry the meaning. */
function LateRing() {
  const r = 78;
  const c = 2 * Math.PI * r;
  const late = 38 / 60;
  return (
    <div aria-hidden className="mx-auto hidden shrink-0 flex-col items-center gap-3 sm:flex">
      <div className="relative h-[220px] w-[220px]">
        <div className="absolute inset-6 rounded-full bg-violet-600/25 blur-3xl" />
        <svg viewBox="0 0 220 220" className="relative h-full w-full">
          <defs>
            <linearGradient id="late-ring" x1="30" y1="20" x2="190" y2="200" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="0.6" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#f5b544" />
            </linearGradient>
          </defs>
          <circle cx="110" cy="110" r="100" fill="rgb(255 255 255 / 0.02)" stroke="rgb(255 255 255 / 0.08)" />
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2;
            const long = i % 5 === 0;
            const r1 = long ? 90 : 93;
            return (
              <line
                key={i}
                x1={110 + Math.sin(a) * r1}
                y1={110 - Math.cos(a) * r1}
                x2={110 + Math.sin(a) * 96}
                y2={110 - Math.cos(a) * 96}
                stroke={i / 60 <= late ? "rgb(252 213 129 / 0.55)" : "rgb(255 255 255 / 0.14)"}
                strokeWidth={long ? 1.6 : 1}
                strokeLinecap="round"
              />
            );
          })}
          <circle cx="110" cy="110" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="10" />
          <circle
            cx="110"
            cy="110"
            r={r}
            fill="none"
            stroke="url(#late-ring)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${c * late} ${c}`}
            transform="rotate(-90 110 110)"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-[3.6rem] leading-none text-gold">+38</span>
          <span className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">minutes late</span>
        </div>
      </div>
      <span className="num rounded-full bg-white/[0.05] px-3 py-1 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10">08:12 Oxford → Paddington</span>
    </div>
  );
}

function reveal(index: number) {
  const el = document.getElementById(beatId(index));
  if (!el) return;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
}

const FORGOTTEN: { to: string; label: string; Icon: LucideIcon }[] = [
  { to: "/read", label: "I can't read the letter", Icon: ScanText },
  { to: "/callers", label: "I can't hear the call", Icon: Ear },
  { to: "/shield", label: "I'm the one scammers target", Icon: ShieldAlert },
  { to: "/owed", label: "Am I owed anything?", Icon: PoundSterling },
];

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
      <PageTitle>The story</PageTitle>

      {/* The hero: Margaret, and the one fact the ten beats follow. */}
      <div className="hairline relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-violet-500/[0.10] via-white/[0.02] to-gold-400/[0.06] px-6 py-8 shadow-glass motion-safe:animate-fade-up sm:px-10 sm:py-10">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-36 right-10 h-72 w-72 rounded-full bg-gold-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="font-display text-[1.95rem] leading-[1.12] text-white sm:text-[2.6rem] sm:leading-[1.08]">
              Margaret is 74, stammers, and rings from a landline. Her 08:12 to Paddington was <em className="text-gold">38 minutes late</em>.
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-slate-300">That one fact runs through every part of Tempo, in ten beats. Each “Try it” does the real thing.</p>
          </div>
          <LateRing />
        </div>
      </div>

      <Card as="section" aria-labelledby="demo-heading" tone="indigo" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-b from-violet-500/30 to-violet-700/10 text-violet-100 ring-1 ring-inset ring-violet-300/25">
              <Rocket size={20} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h2 id="demo-heading" className="text-lg font-semibold tracking-[-0.01em] text-white">
                A guided demo, in ten beats
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-300">
                {done.size === 0
                  ? "Start at the first beat, then come back here for the next. Or play the whole story aloud first."
                  : done.size === BEATS.length
                    ? "You have tried all ten beats. Play the story aloud to hear it end to end."
                    : `${done.size} of ${BEATS.length} beats tried. Next: ${nextBeat?.name}.`}
              </p>
            </div>
          </div>
          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
            {nextBeat && (
              <a
                {...linkProps(nextBeat.tryHref)}
                onClick={(e) => {
                  demoProgress.mark(next);
                  linkProps(nextBeat.tryHref).onClick(e);
                }}
                className={`${PRIMARY_LINK} h-11 px-5 text-sm`}
              >
                <Rocket size={16} aria-hidden /> {done.size === 0 ? "Start the demo" : `Continue: ${nextBeat.name}`}
              </a>
            )}
            {playing ? (
              <Button variant="danger" onClick={stop} icon={<Pause size={16} aria-hidden />} className={`${TAP} h-11`}>
                Pause
              </Button>
            ) : (
              <Button variant="quiet" onClick={play} icon={<Play size={16} aria-hidden />} className={`${TAP} h-11`}>
                Play the story
              </Button>
            )}
          </div>
        </div>

        <nav aria-label="Demo progress" className="relative mt-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5 text-xs font-medium text-slate-300">
              <span aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${(done.size / BEATS.length) * 100}%` }} />
              </span>
              <span className="num">
                {done.size} of {BEATS.length} tried
              </span>
            </span>
            {done.size > 0 && (
              <button type="button" onClick={() => demoProgress.reset()} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-white motion-reduce:transition-none ${FOCUS}`}>
                <RotateCcw size={12} aria-hidden /> Start over
              </button>
            )}
          </div>
          <ol className="grid grid-cols-5 gap-y-5 sm:grid-cols-10">
            {BEATS.map((beat, i) => {
              const isDone = done.has(i);
              const isHere = highlighted === i;
              const linked = isDone && done.has(i + 1);
              return (
                <li key={beat.name} className="relative flex justify-center">
                  {i < BEATS.length - 1 && (
                    <span
                      aria-hidden
                      className={`absolute left-1/2 top-[21px] h-0.5 w-full ${i === 4 ? "hidden sm:block" : ""} ${
                        linked ? "bg-gradient-to-r from-emerald-400/80 to-emerald-400/60" : isDone ? "bg-gradient-to-r from-emerald-400/70 to-white/10" : "bg-white/10"
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={isHere ? "step" : undefined}
                    aria-label={`Beat ${i + 1}: ${beat.name}${isDone ? ", tried" : ""}`}
                    title={beat.name}
                    className={`group relative flex ${TAP} w-full flex-col items-center gap-2 rounded-2xl px-0.5 ${FOCUS}`}
                  >
                    <BeatRing n={i + 1} done={isDone} here={isHere} />
                    <span className={`hidden max-w-[6.5rem] text-center text-[11px] font-medium leading-tight sm:line-clamp-2 ${isHere ? "text-violet-100" : isDone ? "text-emerald-200" : "text-slate-400 group-hover:text-slate-200"}`}>
                      {beat.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <p aria-live="polite" className={playing ? "relative mt-6 flex items-center gap-2.5 rounded-2xl bg-violet-500/[0.12] px-4 py-2.5 text-sm text-violet-50 ring-1 ring-inset ring-violet-300/20" : "sr-only"}>
          {playing && <AudioLines size={16} aria-hidden className="shrink-0 text-violet-200 motion-safe:animate-pulse" />}
          {playing && current !== null ? `Reading beat ${current + 1} of ${BEATS.length}: ${BEATS[current]!.name}.` : ""}
        </p>
      </Card>

      <section aria-labelledby="beats-heading" className="pt-2">
        <SectionTitle id="beats-heading">The ten beats</SectionTitle>
        <ol
          aria-label="The ten beats"
          className="stagger relative space-y-4 before:absolute before:bottom-8 before:left-[17.5px] before:top-8 sm:before:left-[21.5px] before:w-px before:bg-gradient-to-b before:from-violet-400/60 before:via-white/10 before:to-gold-400/30"
        >
          {BEATS.map((beat, i) => {
            const active = current === i;
            const isDone = done.has(i);
            const tryIsPage = beat.tryHref === `#${beat.href}`;
            const Icon = BEAT_ICONS[beat.name] ?? Sparkles;
            return (
              <li key={beat.name} id={beatId(i)} className="relative scroll-mt-24 pl-12 sm:pl-16">
                <span className="absolute left-0 top-5">
                  <BeatRing n={i + 1} done={isDone} here={active} next={current === null && next === i} compact />
                </span>
                <Card
                  tone={active ? "indigo" : "default"}
                  aria-current={active ? "step" : undefined}
                  className={`relative overflow-hidden transition-[box-shadow,border-color,background-color] duration-300 motion-reduce:transition-none ${active ? "shadow-glow" : "hover:border-white/[0.14]"}`}
                >
                  {(active || isDone) && <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${active ? "bg-violet-400" : "bg-emerald-400/80"}`} />}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span aria-hidden className="num inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      <span className={`grid h-6 w-6 place-items-center rounded-lg ring-1 ring-inset ${active ? "bg-violet-500/25 text-violet-100 ring-violet-300/30" : "bg-white/[0.05] text-violet-200 ring-white/10"}`}>
                        <Icon size={13} strokeWidth={2} />
                      </span>
                      Beat {String(i + 1).padStart(2, "0")}
                    </span>
                    {active ? (
                      <Badge tone="indigo" dot>
                        reading aloud
                      </Badge>
                    ) : (
                      isDone && (
                        <Badge tone="emerald" dot>
                          tried
                        </Badge>
                      )
                    )}
                  </div>
                  <h3 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-white">{beat.name}</h3>
                  <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-slate-200">{beat.sentence}</p>
                  <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
                    <Layers size={13} aria-hidden className="-mt-0.5 mr-1.5 inline text-violet-300/80" />
                    Built as {beat.builtAs}.
                    {!tryIsPage && (
                      <>
                        {" "}
                        <a {...linkProps(beat.href)} className={`ml-1 whitespace-nowrap rounded font-medium text-violet-200 underline decoration-violet-300/40 underline-offset-[3px] transition-colors hover:text-white hover:decoration-violet-200 motion-reduce:transition-none ${FOCUS}`}>
                          See it on {beat.link}
                        </a>
                      </>
                    )}
                  </p>
                  <div className="mt-4 flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <a
                        {...linkProps(beat.tryHref)}
                        id={`${beatId(i)}-try`}
                        aria-describedby={`${beatId(i)}-hint`}
                        onClick={(e) => {
                          demoProgress.mark(i);
                          linkProps(beat.tryHref).onClick(e);
                        }}
                        className={`${PRIMARY_LINK} h-10 px-4 text-sm`}
                      >
                        {beat.tryHref.startsWith("#/chat?say=") ? <MessageCircle size={15} aria-hidden /> : <ArrowRight size={15} aria-hidden />}
                        Try it<span className="sr-only">: {beat.name}</span>
                      </a>
                      <Button variant="quiet" onClick={() => speak(`${beat.name}. ${beat.sentence}`)} icon={<Volume2 size={15} aria-hidden />} aria-label={`Read “${beat.name}” aloud`} className={TAP}>
                        Read
                      </Button>
                    </div>
                    <p id={`${beatId(i)}-hint`} className="min-w-0 text-[13px] leading-snug text-slate-400">
                      {beat.tryHint}
                    </p>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      </section>

      <Card as="section" aria-labelledby="forgot-heading" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-gold-400/10 blur-3xl" />
        <SectionTitle id="forgot-heading">Built for the people the internet forgot</SectionTitle>
        <p className="relative max-w-3xl text-[15px] leading-relaxed text-slate-200">
          The same people are hit from every side at once: they cannot read the letter, cannot hear the call, cannot navigate the app, and are the ones scammers
          target. Tempo's answer is one agent that reads to you, listens patiently, warns you, and is built so that it <strong className="font-semibold text-white">cannot</strong> move
          your money or act without your signed yes.
        </p>
        <ul className="relative mt-5 grid gap-3 sm:grid-cols-2">
          {FORGOTTEN.map(({ to, label, Icon }) => (
            <li key={to}>
              <a
                {...linkProps(to)}
                className={`group flex min-h-[56px] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-violet-300/30 hover:bg-white/[0.06] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${FOCUS}`}
              >
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-300/20">
                  <Icon size={17} strokeWidth={1.85} />
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-medium text-slate-100">{label}</span>
                <ArrowRight size={16} aria-hidden className="shrink-0 text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-violet-200 motion-reduce:transition-none" />
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="judges-heading" tone="amber" className="space-y-5">
        <h2 id="judges-heading" className="flex items-center gap-3 text-lg font-semibold tracking-[-0.01em] text-amber-50">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/25">
            <Scale size={18} strokeWidth={1.85} />
          </span>
          For judges: what is real
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.04] p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
              <CheckCircle2 size={13} aria-hidden /> Real in every run
            </h3>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-100">
              {REAL.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.04] p-4 sm:p-5">
            <h3 id="honesty-heading" className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">
              <CircleDashed size={13} aria-hidden /> What is honestly not done
            </h3>
            <ul aria-labelledby="honesty-heading" className="mt-3 space-y-2.5 text-sm leading-relaxed text-amber-50">
              {NOT_DONE.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgb(251_191_36/0.15)]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="flex items-start gap-2 text-sm text-amber-100">
          <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />
          <span>
            The badge at the top of every page says what is real in each run.{showcase ? " In the showcase everything is a recording of a replay-mode Gateway, and the badge says so." : ""}
          </span>
        </p>
      </Card>
    </div>
  );
}
