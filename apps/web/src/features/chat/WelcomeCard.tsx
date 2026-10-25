// The front door (plan.md §2, §6): a greeting, the one promise, and a sample for every beat of the
// demo, grouped by what it is about. Each sample sends its text as a message; the text wraps, so
// nothing is cut off on a phone, and every target is at least 44px tall.
import { useElementWidth } from "@/hooks/useElementWidth";
import type { ComponentType } from "react";
import { ArrowUpRight, Brain, FileText, Hand, Inbox, PoundSterling, ShieldAlert, Sparkles, Train, Wrench } from "lucide-react";
import { FOCUS } from "@/components/ui";
import { SCAM_SAMPLE } from "@/lib/showcase-chat";

export interface Beat {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  /** The icon's colour and its circle (plan.md §4.7's accents). */
  tone: string;
  samples: string[];
}

/** The demo's late train, as the presenter says it (the e2e test clicks it by "08:12 Oxford to Paddington"). */
export const DEMO_SENTENCE = "My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40";

/** The connectors' sweep (plan.md §14): Tempo reads her email, calendar and bank statement for money she's owed. */
export const SWEEP_SAMPLE = "Find money I'm owed in my email";

/** One group per beat, each with its lucide icon. */
export const BEATS: Beat[] = [
  { id: "train", label: "A late train", icon: Train, tone: "from-accent-500/30 to-accent-700/10 text-accent-100 ring-accent-300/25", samples: [DEMO_SENTENCE] },
  { id: "engineer", label: "A missed engineer", icon: Wrench, tone: "from-amber-500/30 to-amber-700/10 text-amber-100 ring-amber-300/25", samples: ["The Broadbandly engineer never came on 19 October"] },
  { id: "scam", label: "Is this a scam?", icon: ShieldAlert, tone: "from-rose-500/30 to-rose-700/10 text-rose-100 ring-rose-300/25", samples: [SCAM_SAMPLE] },
  { id: "memory", label: "What I remember", icon: Brain, tone: "from-second-500/30 to-second-700/10 text-second-100 ring-second-300/25", samples: ["What do you remember about me?"] },
  { id: "money", label: "Money back", icon: PoundSterling, tone: "from-gold-400/35 to-gold-500/10 text-gold-100 ring-gold-300/30", samples: ["How much have you got back for me?", "Am I owed anything?"] },
  { id: "inbox", label: "Money in my email", icon: Inbox, tone: "from-emerald-500/30 to-emerald-700/10 text-emerald-100 ring-emerald-300/25", samples: [SWEEP_SAMPLE] },
  { id: "letter", label: "Read a letter", icon: FileText, tone: "from-sky-500/30 to-sky-700/10 text-sky-100 ring-sky-300/25", samples: ["Read this letter"] },
];

/** Every sample, in the order shown. */
export const SAMPLE_CHIPS: string[] = BEATS.flatMap((b) => b.samples);

export const CHIP =
  "group/chip flex min-h-11 w-full items-start justify-between gap-3 whitespace-normal break-words rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3 text-left text-[14px] leading-snug text-slate-100 transition-[background-color,border-color,transform] duration-150 hover:border-accent-300/35 hover:bg-accent-500/[0.08] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/** Two columns only when the card itself is wide enough; the chat column narrows when the avatar panel is wide. */
const TWO_COLUMNS_FROM = 560;

/** "Good evening" by this device's clock: the greeting above the name. */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function WelcomeCard({ name, onPick, disabled = false }: { name: string; onPick: (text: string) => void; disabled?: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const twoColumns = width >= TWO_COLUMNS_FROM;
  return (
    <div ref={ref} className="mx-auto w-full max-w-3xl">
      <section aria-labelledby="welcome-heading" className="pb-2 pt-2 lg:pt-8">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-200/80 motion-safe:animate-fade-up">
          <Sparkles size={13} aria-hidden className="text-accent-300" /> {greeting()}
        </p>
        <h2 id="welcome-heading" className="mt-3 font-display text-[2.6rem] leading-[1.02] text-white motion-safe:animate-fade-up sm:text-[3.4rem]">
          Hello {name}. I&apos;m <em className="text-brand pr-[0.03em]">Tempo</em>.
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-400 motion-safe:animate-fade-up">Tell me what happened, in your own words, or try one of these.</p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-3.5 py-1.5 text-[13px] font-medium text-emerald-200 motion-safe:animate-fade-up">
          <Hand size={15} aria-hidden className="shrink-0 text-emerald-300" />
          I ask once before I act. Say STOP any time.
        </p>
        <ul className={`stagger mt-7 grid gap-3 ${twoColumns ? "grid-cols-2" : "grid-cols-1"}`} aria-label="Things to try">
          {BEATS.map((beat, index) => {
            const Icon = beat.icon;
            const featured = index === 0 && twoColumns;
            return (
              <li
                key={beat.id}
                className={`surface relative flex flex-col gap-2.5 overflow-hidden rounded-3xl p-3.5 transition-[box-shadow,transform] duration-200 hover:shadow-lift motion-reduce:transition-none ${featured ? "col-span-2" : ""}`}
              >
                <p className="flex items-center gap-2.5 px-0.5 text-[12.5px] font-semibold text-slate-200">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-b ring-1 ring-inset ${beat.tone}`}>
                    <Icon size={16} aria-hidden />
                  </span>
                  {beat.label}
                </p>
                {beat.samples.map((text) => (
                  <button key={text} type="button" disabled={disabled} onClick={() => onPick(text)} className={`${CHIP} ${FOCUS} ${featured ? "text-[15px]" : ""}`}>
                    {text}
                    <ArrowUpRight size={16} aria-hidden className="mt-0.5 shrink-0 text-slate-500 transition-[transform,color] duration-150 group-hover/chip:-translate-y-0.5 group-hover/chip:translate-x-0.5 group-hover/chip:text-accent-200 motion-reduce:transition-none" />
                  </button>
                ))}
                {featured && <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent-500/20 blur-3xl" />}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
