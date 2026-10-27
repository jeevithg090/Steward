/**
 * What an empty conversation offers: a greeting (never a name; Steward does not invent one) and a
 * few things to ask, from the tenant's brand or Steward's defaults.
 */
import { Sparkles } from "lucide-react";
import { useId } from "react";
import { buttonVariants } from "@/components/ui/Button.tsx";
import { useInfo } from "@/lib/api.ts";
import { cn, greeting } from "@/lib/utils.ts";

export const DEFAULT_STARTERS = [
  "What needs me today?",
  "What's on my calendar today?",
  "Open news.ycombinator.com and tell me the top story.",
  "Remember that I prefer short answers.",
];

export function Starters({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  const info = useInfo();
  const starters = (info.data?.starters?.length ? info.data.starters : DEFAULT_STARTERS).slice(0, 6);
  const name = info.data?.brand.name ?? "Steward";
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="mx-auto flex max-w-xl flex-col items-center gap-5 py-10 text-center"
    >
      <span className="grid size-12 place-items-center rounded-tile bg-accent-soft text-accent">
        <Sparkles aria-hidden className="size-6" />
      </span>
      <div>
        <h2 id={titleId} className="m-0 font-semibold text-ink text-title">
          {greeting()}. What can {name} do for you?
        </h2>
        <p className="m-0 mt-1 text-ink-2 text-sub">
          {name} works on its own computer and asks before it sends, pays, signs or deletes anything.
        </p>
      </div>
      <ul className="m-0 flex w-full list-none flex-col gap-2 p-0 sm:grid sm:grid-cols-2">
        {starters.map((starter) => (
          <li key={starter}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(starter)}
              className={cn(
                buttonVariants({ variant: "secondary", size: "md" }),
                "h-full w-full justify-start py-2.5 text-left",
              )}
            >
              {starter}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
