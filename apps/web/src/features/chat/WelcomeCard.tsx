// The front door (plan.md §2, §6): a greeting, the one promise, and a sample for every beat of the
// demo, grouped by what it is about. Each sample sends its text as a message; the text wraps, so
// nothing is cut off on a phone, and every target is at least 44px tall.
import { useElementWidth } from "@/hooks/useElementWidth";
import type { ComponentType } from "react";
import { Brain, FileText, Hand, PoundSterling, ShieldAlert, Sparkles, Train, Wrench } from "lucide-react";
import { Card, FOCUS } from "@/components/ui";
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

/** One group per beat, each with its lucide icon. */
export const BEATS: Beat[] = [
  { id: "train", label: "A late train", icon: Train, tone: "bg-indigo-500/15 text-indigo-300", samples: [DEMO_SENTENCE] },
  { id: "engineer", label: "A missed engineer", icon: Wrench, tone: "bg-amber-500/15 text-amber-300", samples: ["The Broadbandly engineer never came on 19 October"] },
  { id: "scam", label: "Is this a scam?", icon: ShieldAlert, tone: "bg-rose-500/15 text-rose-300", samples: [SCAM_SAMPLE] },
  { id: "memory", label: "What I remember", icon: Brain, tone: "bg-purple-500/15 text-purple-300", samples: ["What do you remember about me?"] },
  { id: "money", label: "Money back", icon: PoundSterling, tone: "bg-emerald-500/15 text-emerald-300", samples: ["How much have you got back for me?", "Am I owed anything?"] },
  { id: "letter", label: "Read a letter", icon: FileText, tone: "bg-white/10 text-slate-200", samples: ["Read this letter"] },
];

/** Every sample, in the order shown. */
export const SAMPLE_CHIPS: string[] = BEATS.flatMap((b) => b.samples);

export const CHIP =
  "min-h-11 w-full whitespace-normal break-words rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm leading-snug text-slate-100 transition-colors hover:border-indigo-400/50 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/** Two columns only when the card itself is wide enough; the chat column narrows when the avatar panel is wide. */
const TWO_COLUMNS_FROM = 560;

export function WelcomeCard({ name, onPick, disabled = false }: { name: string; onPick: (text: string) => void; disabled?: boolean }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const twoColumns = width >= TWO_COLUMNS_FROM;
  return (
    <div ref={ref} className="mx-auto w-full max-w-3xl">
    <Card as="section" aria-labelledby="welcome-heading" className="lg:mt-4">
      <h2 id="welcome-heading" className="flex items-center gap-2 text-lg font-semibold text-slate-50">
        <Sparkles size={18} aria-hidden className="text-indigo-300" /> Hello {name}. I&apos;m Tempo.
      </h2>
      <p className="mt-1 text-sm text-slate-300">Tell me what happened, in your own words, or try one of these.</p>
      <p className="mt-2 flex items-start gap-2 text-sm font-medium text-emerald-200">
        <Hand size={16} aria-hidden className="mt-0.5 shrink-0 text-emerald-300" />
        I ask once before I act. Say STOP any time.
      </p>
      <ul className={`mt-4 grid gap-3 ${twoColumns ? "grid-cols-2" : "grid-cols-1"}`} aria-label="Things to try">
        {BEATS.map((beat) => {
          const Icon = beat.icon;
          return (
            <li key={beat.id} className="flex flex-col gap-2 rounded-2xl border border-white/5 bg-black/20 p-3">
              <p className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${beat.tone}`}>
                  <Icon size={15} aria-hidden />
                </span>
                {beat.label}
              </p>
              {beat.samples.map((text) => (
                <button key={text} type="button" disabled={disabled} onClick={() => onPick(text)} className={`${CHIP} ${FOCUS}`}>
                  {text}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </Card>
    </div>
  );
}
