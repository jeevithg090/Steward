/**
 * What Steward is doing right now, in one line: three dots and the current step in plain words
 * ("Opening news.ycombinator.com", "Reading your mail"), or that it is waiting for an answer. The
 * line is a polite live region, so a screen reader hears each new step once.
 */
import { CircleStop, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button.tsx";
import { Pill } from "@/components/ui/Pill.tsx";

export function RunStatus({
  running,
  step,
  waitingForAnswer,
  speaking,
  onStopSpeaking,
}: {
  running: boolean;
  /** The current step, in words. */
  step: string;
  waitingForAnswer: boolean;
  speaking: boolean;
  onStopSpeaking: () => void;
}) {
  const words = waitingForAnswer
    ? "Steward is waiting for your answer."
    : running
      ? `Steward is working: ${step}.`
      : "";
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-3">
      <p role="status" aria-live="polite" className="m-0 flex items-center gap-2 text-ink-2 text-sub">
        {waitingForAnswer ? (
          <Pill tone="needs" icon={Clock}>
            Waiting for your answer
          </Pill>
        ) : running ? (
          <>
            <TypingDots />
            <span className="sr-only">{words}</span>
            <Pill tone="working" icon={null}>
              <span aria-hidden="true" className="max-w-[60vw] truncate">
                {step}
              </span>
            </Pill>
          </>
        ) : null}
      </p>
      {speaking ? (
        <Button variant="ghost" size="sm" icon={<CircleStop />} onClick={onStopSpeaking}>
          Stop reading aloud
        </Button>
      ) : null}
    </div>
  );
}

/** Three dots that pulse in turn. Still, but still three dots, when the person asks for less motion. */
function TypingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 rounded-full bg-ink-3 motion-safe:animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
