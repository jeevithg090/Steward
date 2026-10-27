/**
 * `show_choices`: quick-reply chips. Tapping one sends its words as the person's next message.
 * Once one is chosen, or once the conversation has moved on, the chips stay visible but inactive.
 *
 * Behaviour follows OpenDuet's reply chips (MIT, CopilotKit).
 */
import { CornerDownLeft } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import { readChoices } from "./choices.ts";

export function Choices({
  args,
  onChoose,
  disabled = false,
}: {
  args?: Record<string, unknown>;
  /** Sends the text as the person's message. Absent where nothing can be sent (a preview). */
  onChoose?: (message: string) => void;
  /** True once the conversation has moved past this question. */
  disabled?: boolean;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const { question, choices } = readChoices(args);
  if (choices.length === 0) return null;
  const inactive = disabled || chosen !== null || !onChoose;

  return (
    <section aria-label={question ?? "Quick replies"} className="my-2">
      {question ? <p className="m-0 mb-2 text-sub text-ink-2">{question}</p> : null}
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {choices.map((choice) => {
          const picked = chosen === choice.label;
          return (
            <li key={choice.label}>
              <button
                type="button"
                disabled={inactive}
                aria-pressed={picked}
                onClick={() => {
                  if (inactive) return;
                  setChosen(choice.label);
                  onChoose?.(choice.message);
                }}
                className={cn(
                  "inline-flex min-h-target items-center gap-1.5 rounded-full border px-4 text-sub font-medium",
                  "transition-colors duration-[var(--st-dur-tap)]",
                  picked
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-hair bg-card text-ink enabled:hover:bg-tile",
                  inactive && !picked && "opacity-60",
                )}
              >
                <CornerDownLeft aria-hidden className="size-3.5 text-ink-3" />
                {choice.label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
