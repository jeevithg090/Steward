import type { Approval } from "@steward/shared";
import { ArrowLeft, ArrowRight, Check, FolderOpen, Globe, Hand, SquareTerminal } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ApprovalCardView } from "@/components/cards/ApprovalCard.tsx";
import { AccessibilityControls } from "@/components/settings/AccessibilityControls.tsx";
import { SetupChecklist } from "@/components/setup/SetupChecklist.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { useDocumentTitle } from "@/components/ui/PageHeader.tsx";
import { useInfo } from "@/lib/api.ts";
import { finishWelcome } from "@/lib/onboarding.ts";
import { cn } from "@/lib/utils.ts";

const STEPS = ["meet", "computer", "asks", "comfort", "setup"] as const;
type Step = (typeof STEPS)[number];

/** A made-up request for the "asks before it acts" step. Fictional address; nobody's real mail. */
const EXAMPLE_APPROVAL: Approval = {
  id: "apr_example",
  toolCallId: "call_example",
  runId: "run_example",
  threadId: "thr_example",
  agentId: "steward",
  status: "pending",
  summary: "Send an email to orders@example.com: “Re: Thursday's delivery”",
  tool: { name: "mail_send", kind: "send", surface: "mail", source: "builtin" },
  args: {
    to: ["orders@example.com"],
    subject: "Re: Thursday's delivery",
    body: "Thursday works. See you then.",
  },
  target: { recipients: ["orders@example.com"] },
  decision: {
    effect: "ask",
    rule: { id: "example", name: "Ask before sending", source: "preset" },
    reason: "Sending an email always asks unless you have allowed it.",
    findings: [],
  },
  canAlways: true,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
};

/**
 * First run: what Steward is, its computer, how it asks, display settings, then the setup
 * checklist. Each step's heading takes focus so a screen reader announces it. Skip is always there,
 * and finishing (or skipping) is remembered in this browser.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const info = useInfo();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const name = info.data?.brand.name ?? "Steward";
  const step: Step = (STEPS as readonly string[]).includes(params.get("step") ?? "")
    ? (params.get("step") as Step)
    : "meet";
  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;

  useDocumentTitle("Welcome", name);

  // Each new step's heading takes focus, so a screen reader announces where the person is. Not on
  // the first step of a fresh load: there the first Tab must still reach the skip link.
  // Compared with the last step rather than a first-run flag: React runs effects twice in
  // development, and a flag would treat the second run as a step change.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  function go(to: number) {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, to))]!;
    setParams(next === "meet" ? {} : { step: next });
  }

  function finish() {
    finishWelcome();
    navigate("/", { replace: true });
  }

  const content: Record<Step, { title: string; body: ReactNode }> = {
    meet: {
      title: `Meet ${name}`,
      body: (
        <>
          <p className="text-body text-ink">
            {info.data?.brand.tagline ??
              "Does the work, asks before it acts, and keeps a record you can read."}
          </p>
          <ul className="flex flex-col gap-3 text-ink text-sub">
            <Point>It reads your mail and calendar, and each morning tells you what needs you.</Point>
            <Point>It does the work on a computer of its own while you get on with your day.</Point>
            <Point>
              It never sends, pays, signs or deletes anything without showing you exactly what, and waiting
              for your answer.
            </Point>
            <Point>It writes down everything it does, in a record you can read and check.</Point>
          </ul>
          {info.data?.mail.isDemo ? (
            <Notice tone="needs" title="You're trying it with a demo inbox">
              The mail and calendar you'll see are made up, so you can try everything safely.
            </Notice>
          ) : null}
        </>
      ),
    },
    computer: {
      title: "It has a computer of its own",
      body: (
        <>
          <p className="text-body text-ink">
            {name} has its own web browser, a folder for its files, and a command line. It works there, not on
            your screen.
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            <Tile icon={<Globe />} title="A browser">
              It opens pages, reads them and fills in forms.
            </Tile>
            <Tile icon={<FolderOpen />} title="Its own files">
              Notes, reports and downloads stay in its workspace.
            </Tile>
            <Tile icon={<SquareTerminal />} title="A command line">
              It asks before it runs anything there.
            </Tile>
          </ul>
          <p className="text-ink-2 text-sub">
            You can watch its screen live on the Computer page, and take the wheel whenever you like. It stops
            and waits until you hand it back. When a page needs a password, you type it into a secret box:{" "}
            {name} never sees it.
          </p>
        </>
      ),
    },
    asks: {
      title: "It asks before it acts",
      body: (
        <>
          <p className="text-body text-ink">
            When {name} wants to send, pay, sign or delete something, it stops and shows you a card like this
            one:
          </p>
          <ApprovalCardView approval={EXAMPLE_APPROVAL} example headingLevel={2} />
          <ul className="flex flex-col gap-2 text-ink text-sub">
            <Point>
              <strong>Refuse</strong> stops it. Nothing happens.
            </Point>
            <Point>
              <strong>Allow once</strong> lets it do this one thing.
            </Point>
            <Point>
              <strong>Always allow</strong> adds a rule, so it won't ask again for the same thing. You can
              take it back in Rules.
            </Point>
          </ul>
          <p className="text-ink-2 text-sub">
            Payments and passwords always ask. So does anything risky after it has read a web page or an
            email, in case the page tried to trick it.
          </p>
        </>
      ),
    },
    comfort: {
      title: "Make it comfortable",
      body: (
        <>
          <p className="text-body text-ink">
            Choose what suits you. It changes straight away, and you can change it later in Settings.
          </p>
          <AccessibilityControls compact showReset={false} />
          <p className="text-ink-2 text-sub">
            You can talk to {name} too: press the microphone in Chat and speak.
          </p>
        </>
      ),
    },
    setup: {
      title: "Check your setup",
      body: (
        <>
          <p className="text-body text-ink">
            See what is ready and what needs setting up. {name} works without the optional parts.
          </p>
          <SetupChecklist headingLevel={1} />
        </>
      ),
    },
  };

  const current = content[step];

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 pt-4">
        <span className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="font-semibold text-title">{name}</span>
        </span>
        {last ? null : (
          <Button variant="ghost" onClick={finish}>
            Skip
          </Button>
        )}
      </header>

      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-6 pb-36 sm:pt-10">
        <p className="font-medium text-ink-2 text-sub">
          Step {index + 1} of {STEPS.length}
        </p>
        <div aria-hidden="true" className="mt-2 flex gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-(--st-dur-swap)",
                i <= index ? "bg-accent" : "bg-tile",
              )}
            />
          ))}
        </div>
        <div key={step} className="mt-8 flex animate-enter flex-col gap-5">
          <h1 ref={headingRef} tabIndex={-1} className="font-semibold text-display">
            {current.title}
          </h1>
          {current.body}
        </div>
      </main>

      <nav
        aria-label="Welcome steps"
        className="glass fixed inset-x-0 bottom-0 border-hair border-t pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          {index > 0 ? (
            <Button icon={<ArrowLeft />} onClick={() => go(index - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {last ? (
            <Button variant="primary" size="lg" icon={<Check />} onClick={finish}>
              Start using {name}
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => go(index + 1)}>
              Next
              <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Hand aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}

function Tile({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-card bg-card p-4 shadow-card">
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-tile bg-accent-soft text-accent [&_svg]:size-5"
      >
        {icon}
      </span>
      <span className="font-semibold text-ink text-sub">{title}</span>
      <span className="text-ink-2 text-sub">{children}</span>
    </li>
  );
}
