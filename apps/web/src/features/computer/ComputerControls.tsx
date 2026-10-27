/**
 * Everything around the live screen: the banner when Steward asks for help, the status line (where
 * it is, who is driving, whether the picture is live) and the wheel itself.
 */
import { Globe, Hand, LifeBuoy, RotateCw, Undo2, WifiOff } from "lucide-react";
import { type FormEvent, type RefObject, useId, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { cn } from "@/lib/utils.ts";
import { useComputer } from "./session.tsx";

/** "news.ycombinator.com/item?id=1" from a full URL, for a status line. */
export function shortUrl(url: string | undefined): string | undefined {
  if (!url || url === "about:blank") return undefined;
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
    return `${parsed.host.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** Shown while Steward waits for the person to do something on its screen. */
export function HelpBanner({ onTake }: { onTake?: () => void }) {
  const computer = useComputer();
  const help = computer.status?.help;
  if (!help || computer.driving) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-field bg-needs-soft px-4 py-3 text-sub"
    >
      <LifeBuoy aria-hidden className="size-5 shrink-0 text-needs" />
      <p className="m-0 min-w-0 flex-1 text-ink">
        <strong className="font-semibold">Steward needs you: </strong>
        {help.reason}
      </p>
      <Button
        variant="primary"
        size="sm"
        icon={<Hand />}
        onClick={() => {
          computer.take();
          onTake?.();
        }}
      >
        Take the wheel
      </Button>
    </div>
  );
}

/** Take the wheel, or hand it back. */
export function WheelButton({
  buttonRef,
  size = "sm",
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  size?: "sm" | "md";
}) {
  const computer = useComputer();
  const live = computer.connection === "open";
  return computer.driving ? (
    <Button ref={buttonRef} variant="primary" size={size} icon={<Undo2 />} onClick={() => computer.release()}>
      Hand back
    </Button>
  ) : (
    <Button
      ref={buttonRef}
      variant="secondary"
      size={size}
      icon={<Hand />}
      disabled={!live}
      onClick={() => computer.take()}
    >
      Take the wheel
    </Button>
  );
}

/** Where the screen is, who is driving, and whether the picture is live. */
export function ScreenStatus({ className }: { className?: string }) {
  const computer = useComputer();
  const where = shortUrl(computer.status?.url);
  const title = computer.status?.title;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption", className)}>
      {computer.connection === "open" ? (
        <Pill tone={computer.driving ? "accent" : "done"} icon={computer.driving ? Hand : null}>
          {computer.driving ? "You're driving" : "Live"}
        </Pill>
      ) : computer.connection === "closed" ? (
        <Pill tone="problem" icon={WifiOff}>
          Not connected
        </Pill>
      ) : (
        <Pill tone="working">{computer.connection === "connecting" ? "Connecting…" : "Reconnecting…"}</Pill>
      )}
      {where ? (
        <span className="flex min-w-0 items-center gap-1.5 text-ink-2" title={computer.status?.url}>
          <Globe aria-hidden className="size-3.5 shrink-0" />
          <span className="sr-only">Address: </span>
          <span className="truncate">{where}</span>
        </span>
      ) : null}
      {title ? (
        <span className="hidden min-w-0 truncate text-ink-3 sm:inline">
          <span className="sr-only">Page title: </span>
          {title}
        </span>
      ) : null}
    </div>
  );
}

/** The problem line under the screen: a dropped connection with Retry, or a refused input. */
export function ScreenProblems() {
  const computer = useComputer();
  return (
    <>
      {computer.problem ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-problem-soft px-3 py-2 text-sub"
        >
          <span className="text-ink">{computer.problem}</span>
          <Button size="sm" variant="secondary" icon={<RotateCw />} onClick={() => computer.retry()}>
            Retry
          </Button>
        </div>
      ) : null}
      {computer.notice ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-field bg-tile px-3 py-2 text-sub"
        >
          <span className="text-ink-2">{computer.notice}</span>
          <Button size="sm" variant="ghost" onClick={() => computer.clearNotice()}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Go to an address yourself. Only while you hold the wheel. */
export function AddressBar() {
  const computer = useComputer();
  const [value, setValue] = useState("");
  const id = useId();
  if (!computer.driving) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    if (computer.send({ type: "navigate", url })) setValue("");
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Go to an address on Steward's screen
      </label>
      <input
        id={id}
        type="text"
        inputMode="url"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Go to an address"
        autoComplete="off"
        spellCheck={false}
        className="min-h-target min-w-0 flex-1 rounded-field border border-line bg-card px-3 text-ink text-sub"
      />
      <Button type="submit" size="sm" variant="secondary">
        Go
      </Button>
    </form>
  );
}
