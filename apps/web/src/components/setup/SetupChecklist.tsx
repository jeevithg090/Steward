import type { SetupCheck } from "@steward/shared";
import { CircleAlert, CircleCheck, CircleDashed, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/Button.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Pill, type Tone } from "@/components/ui/Pill.tsx";
import { useCheckSetup, useSetup } from "@/lib/api.ts";
import { cn, plural, pluralWord } from "@/lib/utils.ts";

const STATUS: Record<SetupCheck["status"], { label: string; tone: (c: SetupCheck) => Tone }> = {
  ready: { label: "Ready", tone: () => "done" },
  not_checked: { label: "Not checked", tone: () => "needs" },
  needs_setup: { label: "Needs setup", tone: (c) => (c.optional ? "needs" : "problem") },
};

const ICONS = { ready: CircleCheck, not_checked: CircleDashed, needs_setup: CircleAlert } as const;

/** "Everything is set up." / "2 things need setup, and 1 is required." / "+ 1 thing isn't checked yet." */
export function summariseSetup(checks: SetupCheck[]): string {
  const needs = checks.filter((c) => c.status === "needs_setup");
  const required = needs.filter((c) => !c.optional).length;
  const unchecked = checks.filter((c) => c.status === "not_checked").length;
  const parts: string[] = [];
  if (needs.length === 0 && unchecked === 0) return "Everything is set up.";
  if (needs.length > 0) {
    const head = `${plural(needs.length, "thing")} ${pluralWord(needs.length, "needs", "need")} setup`;
    parts.push(
      required > 0
        ? `${head}, and ${required} ${required === 1 ? "is" : "are"} required.`
        : `${head}. Steward works without ${needs.length === 1 ? "it" : "them"}.`,
    );
  }
  if (unchecked > 0) {
    parts.push(`${plural(unchecked, "thing")} ${unchecked === 1 ? "isn't" : "aren't"} checked yet.`);
  }
  return parts.join(" ");
}

/**
 * What is ready and what needs setting up. Ready means it works, not merely that something is set:
 * the server checks each row for real, and "Check again" asks it to look once more.
 * `headingLevel` is the level of the heading this list sits under; each row is one below it.
 */
export function SetupChecklist({ headingLevel = 2 }: { headingLevel?: 1 | 2 | 3 }) {
  const setup = useSetup();
  const check = useCheckSetup();
  const [announcement, setAnnouncement] = useState("");
  const Heading = `h${headingLevel + 1}` as "h2" | "h3" | "h4";

  if (setup.isPending) return <Loading>Checking your setup…</Loading>;
  if (setup.isError) {
    return (
      <ErrorNotice
        title="Couldn't load your setup"
        error={setup.error}
        onRetry={() => void setup.refetch()}
      />
    );
  }

  const checks = setup.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-ink text-sub">{summariseSetup(checks)}</p>
        <Button
          size="sm"
          icon={<RefreshCw />}
          loading={check.isPending}
          onClick={() =>
            check.mutate(undefined, {
              onSuccess: (fresh) =>
                setAnnouncement(`Checked again. ${summariseSetup(Array.isArray(fresh) ? fresh : checks)}`),
              onError: () => setAnnouncement("Couldn't check again. Try again."),
            })
          }
        >
          {check.isPending ? "Checking…" : "Check again"}
        </Button>
      </div>
      {check.isError ? (
        <p role="alert" className="text-problem text-sub">
          Couldn't check again. {check.error.message}
        </p>
      ) : null}
      <ul className="flex flex-col rounded-card bg-card shadow-card">
        {checks.map((item) => {
          const status = STATUS[item.status];
          const Icon = ICONS[item.status];
          return (
            <li key={item.id} className="flex gap-3 border-hair-2 border-t px-4 py-3.5 first:border-t-0">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-5 shrink-0",
                  item.status === "ready"
                    ? "text-done"
                    : item.status === "needs_setup" && !item.optional
                      ? "text-problem"
                      : "text-needs",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Heading className="font-medium text-body text-ink">{item.label}</Heading>
                  <Pill tone={status.tone(item)} icon={null}>
                    {status.label}
                  </Pill>
                  <span className="text-caption text-ink-3">{item.optional ? "Optional" : "Required"}</span>
                </div>
                <p className="mt-1 text-ink-2 text-sub">{item.detail}</p>
                {item.status !== "ready" && item.fix ? (
                  <p className="mt-1 text-ink text-sub">
                    <span className="font-medium">To fix: </span>
                    {item.fix}
                  </p>
                ) : null}
                {item.status !== "ready" && item.href ? (
                  item.href.startsWith("/") ? (
                    <Link
                      to={item.href}
                      className="mt-1 inline-flex min-h-target items-center text-accent text-sub underline underline-offset-4"
                    >
                      Go to {item.label}
                    </Link>
                  ) : (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex min-h-target items-center text-accent text-sub underline underline-offset-4"
                    >
                      How to set up {item.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
