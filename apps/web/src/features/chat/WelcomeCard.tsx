import { Sparkles } from "lucide-react";
import { Card, FOCUS } from "@/components/ui";
import { SAMPLES } from "@/lib/shield";

/** The sample chips: one for every beat of the demo (plan.md §6). Each sends its text as a message. */
export const SAMPLE_CHIPS: string[] = [
  "My 08:12 Oxford to Paddington was 38 minutes late on 23 October, ticket £28.40",
  "The Broadbandly engineer never came on 19 October",
  `Is this a scam? ${SAMPLES[0].text}`,
  "What do you remember about me?",
  "How much have you got back for me?",
  "Am I owed anything?",
  "Read this letter",
  "Help",
];

export function WelcomeCard({ name, onPick, disabled = false }: { name: string; onPick: (text: string) => void; disabled?: boolean }) {
  return (
    <Card as="section" aria-labelledby="welcome-heading" className="mx-auto mt-6 max-w-2xl">
      <h2 id="welcome-heading" className="flex items-center gap-2 text-base font-semibold text-slate-100">
        <Sparkles size={16} aria-hidden className="text-indigo-300" /> Hello {name}. I&apos;m Tempo.
      </h2>
      <p className="mt-1 text-sm text-slate-300">
        Tell me what happened, in your own words, or try one of these. I ask once before I act, and you can say STOP at any time.
      </p>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Things to try">
        {SAMPLE_CHIPS.map((text) => (
          <li key={text}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(text)}
              className={`max-w-full truncate rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-left text-xs text-slate-200 hover:border-indigo-400/50 hover:bg-indigo-500/10 disabled:opacity-50 ${FOCUS}`}
              title={text}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
