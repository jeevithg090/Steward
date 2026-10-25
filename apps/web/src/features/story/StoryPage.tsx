// The story (plan.md §2, README "One late train, and everything it touches"): the ten beats, each
// linking to the page that shows it, read aloud one after another by the avatar on request.
// Ported from the old Landing's BEATS; dark theme. Ends with what is honestly not done (plan §9).
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Pause, Play, Volume2 } from "lucide-react";
import { Button, Card, FOCUS, PageTitle, SectionTitle } from "@/components/ui";
import { linkProps } from "@/router";
import type { PageProps } from "@/types/page";

export interface Beat {
  name: string;
  /** One plain sentence of what Tempo does. */
  sentence: string;
  /** What that is built as, in a muted line. */
  builtAs: string;
  href: string;
  link: string;
}

export const BEATS: Beat[] = [
  { name: "Hear", sentence: "Tempo answers the way Margaret asked to be spoken to, before the first word: slowly, one question at a time, waiting as long as it takes.", builtAs: "the Patience Profile: access memories become the voice agent's instructions", href: "/callers", link: "Who's calling?" },
  { name: "Read", sentence: "It finds how late the train was, and reads a ticket, a card or a letter back to her, asking about anything it is unsure of.", builtAs: "rail data over MCP; vision intake with read-back", href: "/read", link: "Read It To Me" },
  { name: "Price", sentence: "The amount comes from a YAML rule pack with a citation, never from a model.", builtAs: "the Rights Engine and its Proof Trace (ADR 0003)", href: "/missions", link: "Mission Control" },
  { name: "Check", sentence: "Three models from three providers check the reading; they may say no, and they can never raise the amount.", builtAs: "the Consensus Court", href: "/missions", link: "Mission Control" },
  { name: "Weigh", sentence: "It asks whether the claim is worth her time, at her own value of an hour.", builtAs: "the Arbiter and the Time Ledger", href: "/missions", link: "Mission Control" },
  { name: "Time it", sentence: "Every right has a clock, and sometimes the right move is to wait, with the date.", builtAs: "Rights Decay, backtested on real case data", href: "/missions", link: "Mission Control" },
  { name: "Ask once", sentence: "It asks one question and acts only on a signed yes; STOP stops everything.", builtAs: "the consent ledger where deny wins (ADR 0004), passkeys", href: "/chat", link: "The chat" },
  { name: "Prove it", sentence: "It shows the company's own AI a mandate it can verify in milliseconds, and the company refuses anything outside it.", builtAs: "the Agent Passport, red-teamed", href: "/missions", link: "Mission Control" },
  { name: "Remember only her words", sentence: "It keeps what she said and official data; company text is evidence, never memory; everything is dated and forgettable.", builtAs: "the Memory Gate and the Memory Card", href: "/memory", link: "Memory" },
  { name: "Return the time", sentence: "It counts hours and pounds returned only once the money has arrived.", builtAs: "the Watchdog and the Time Ledger", href: "/missions", link: "Mission Control" },
];

/** plan.md §9: what is honestly not done, and limits. */
export const NOT_DONE = [
  "Tempo Mesh (pairing, passkeys, push) is not in this UI; approvals use the demo bearer.",
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

export default function StoryPage({ speak, showcase }: PageProps) {
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div className="space-y-6">
      <PageTitle
        lede="Margaret is 74, stammers, and rings from a landline. Her 08:12 to Paddington was 38 minutes late. That one fact runs through every part of Tempo, in this order."
        right={
          playing ? (
            <Button variant="danger" onClick={stop} icon={<Pause size={14} aria-hidden />}>
              Pause
            </Button>
          ) : (
            <Button onClick={play} icon={<Play size={14} aria-hidden />}>
              Play the story
            </Button>
          )
        }
      >
        The story
      </PageTitle>

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-slate-400">
        {playing && current !== null ? `Reading beat ${current + 1} of ${BEATS.length}: ${BEATS[current]!.name}.` : ""}
      </p>

      <ol aria-label="The ten beats" className="relative space-y-3 border-l border-white/10 pl-6">
        {BEATS.map((beat, i) => {
          const active = current === i;
          return (
            <li key={beat.name} className="relative">
              <span
                aria-hidden
                className={`absolute -left-[1.95rem] top-4 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${active ? "bg-indigo-500 text-white ring-4 ring-indigo-500/30" : "bg-nexus-badge text-white"}`}
              >
                {i + 1}
              </span>
              <Card tone={active ? "indigo" : "default"} aria-current={active ? "step" : undefined} className="transition-colors motion-reduce:transition-none">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-100">{beat.name}</h2>
                  <div className="flex items-center gap-2">
                    <Button variant="quiet" size="sm" onClick={() => speak(`${beat.name}. ${beat.sentence}`)} icon={<Volume2 size={14} aria-hidden />} aria-label={`Read “${beat.name}” aloud`}>
                      Read
                    </Button>
                    <a {...linkProps(beat.href)} className={`inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/30 ${FOCUS}`}>
                      {beat.link} <ArrowRight size={12} aria-hidden />
                    </a>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-200">{beat.sentence}</p>
                <p className="mt-1 text-xs text-slate-400">Built as {beat.builtAs}.</p>
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
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {[
            { to: "/read", label: "I can't read the letter" },
            { to: "/callers", label: "I can't hear the call" },
            { to: "/shield", label: "I'm the one scammers target" },
            { to: "/owed", label: "Am I owed anything?" },
          ].map((item) => (
            <li key={item.to}>
              <a {...linkProps(item.to)} className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200 hover:bg-white/10 ${FOCUS}`}>
                {item.label} <ArrowRight size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="honesty-heading" tone="amber">
        <SectionTitle id="honesty-heading">What is honestly not done</SectionTitle>
        <ul className="space-y-1 text-sm text-amber-50">
          {NOT_DONE.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-amber-200/80">
          The badge at the top of every page says what is real in each run.{showcase ? " In the showcase everything is a recording of a replay-mode Gateway, and the badge says so." : ""}
        </p>
      </Card>
    </div>
  );
}
