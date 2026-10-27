/**
 * `show_comparison`: options side by side, each with its pros and cons, and Steward's verdict.
 * Pros and cons are lists with a word before each item, so they read the same without the icons.
 */
import { Check, Minus, Sparkles } from "lucide-react";
import { Pill } from "@/components/ui/Pill.tsx";
import { CardFrame, Quiet } from "./kit.tsx";

interface Option {
  name: string;
  summary?: string;
  pros: string[];
  cons: string[];
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? [value.trim()] : [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, 8);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function readComparison(args: Record<string, unknown> | undefined) {
  const raw = Array.isArray(args?.options) ? args.options : Array.isArray(args?.items) ? args.items : [];
  const options: Option[] = raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .slice(0, 4)
    .map((entry, index) => ({
      name: text(entry.name) ?? text(entry.title) ?? text(entry.label) ?? `Option ${index + 1}`,
      summary: text(entry.summary) ?? text(entry.description),
      pros: strings(entry.pros),
      cons: strings(entry.cons),
    }));
  const pick = text(args?.pick) ?? text(args?.recommended) ?? text(args?.choice);
  return {
    title: text(args?.title) ?? "Comparison",
    caption: text(args?.caption),
    options,
    verdict: text(args?.verdict) ?? text(args?.recommendation),
    pick:
      pick && options.some((option) => option.name.toLowerCase() === pick.toLowerCase()) ? pick : undefined,
  };
}

export function Comparison({ args }: { args?: Record<string, unknown> }) {
  const { title, caption, options, verdict, pick } = readComparison(args);
  if (options.length === 0) {
    return (
      <CardFrame title={title}>
        <Quiet>Comparing the options…</Quiet>
      </CardFrame>
    );
  }
  return (
    <CardFrame
      title={title}
      caption={caption}
      footer={
        verdict ? (
          <p className="m-0 flex items-start gap-2 text-sub text-ink">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              <strong className="font-semibold">Verdict: </strong>
              {verdict}
            </span>
          </p>
        ) : undefined
      }
    >
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {options.map((option) => {
          const picked = pick !== undefined && option.name.toLowerCase() === pick.toLowerCase();
          return (
            <li
              key={option.name}
              className={`rounded-tile border p-3 ${picked ? "border-accent bg-accent-soft/40" : "border-hair"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="m-0 text-sub font-semibold text-ink">{option.name}</h4>
                {picked ? (
                  <Pill tone="done" icon={Check}>
                    Steward's pick
                  </Pill>
                ) : null}
              </div>
              {option.summary ? <p className="m-0 mt-1 text-caption text-ink-2">{option.summary}</p> : null}
              {option.pros.length > 0 ? (
                <ul className="m-0 mt-2 list-none space-y-1 p-0 text-caption">
                  {option.pros.map((pro) => (
                    <li key={pro} className="flex items-start gap-1.5 text-ink">
                      <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-done" />
                      <span>
                        <span className="sr-only">Pro: </span>
                        {pro}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {option.cons.length > 0 ? (
                <ul className="m-0 mt-2 list-none space-y-1 p-0 text-caption">
                  {option.cons.map((con) => (
                    <li key={con} className="flex items-start gap-1.5 text-ink-2">
                      <Minus aria-hidden className="mt-0.5 size-3.5 shrink-0 text-problem" />
                      <span>
                        <span className="sr-only">Con: </span>
                        {con}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </CardFrame>
  );
}
