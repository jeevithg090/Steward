import type { Task, TriageItem } from "@steward/shared";
import { ArrowRight, EyeOff, Play, Send, Sparkles, Sunrise } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { toast } from "sonner";
import { ApprovalCard } from "@/components/cards/ApprovalCard.tsx";
import { BriefCard } from "@/components/cards/BriefCard.tsx";
import { TaskCard } from "@/components/cards/TaskCard.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Input } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import {
  useApprovals,
  useBrief,
  useGenerateBrief,
  useInfo,
  usePatchTask,
  useSettings,
  useStartTask,
  useTasks,
} from "@/lib/api.ts";
import { chatPromptHref, hasFinishedWelcome } from "@/lib/onboarding.ts";
import { formatDay, greeting } from "@/lib/utils.ts";

/** Today: the first page. Sends a first visit to the welcome instead. */
export function TodayPage() {
  if (!hasFinishedWelcome()) return <Navigate to="/welcome" replace />;
  return <Today />;
}

function Today() {
  const now = new Date();
  return (
    <Page
      title={greeting(now)}
      documentTitle="Today"
      description={<p>{formatDay(now)}. Here is what needs you, and what Steward can take off your plate.</p>}
    >
      <AskSteward />
      <WaitingOnYou />
      <TodaysBrief />
      <NewestSuggestion />
    </Page>
  );
}

/** A composer that opens the chat with the message, plus the tenant's starters as one-tap asks. */
function AskSteward() {
  const navigate = useNavigate();
  const info = useInfo();
  const [text, setText] = useState("");
  const inputId = useId();
  const starters = info.data?.starters ?? [];

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    navigate(chatPromptHref(message));
  }

  return (
    <Card as="section" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`} className="sr-only">
        Ask Steward
      </h2>
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Ask Steward to do something
        </label>
        <Input
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask Steward to do something…"
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button
          type="submit"
          variant="primary"
          size="icon"
          aria-label="Send to Steward"
          disabled={!text.trim()}
        >
          <Send aria-hidden="true" />
        </Button>
      </form>
      {starters.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption text-ink-2" id={`${inputId}-starters`}>
            Or try one of these:
          </p>
          <ul aria-labelledby={`${inputId}-starters`} className="mt-2 flex flex-wrap gap-2">
            {starters.map((starter) => (
              <li key={starter}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-auto whitespace-normal py-2 text-left"
                  onClick={() => navigate(chatPromptHref(starter))}
                >
                  {starter}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function WaitingOnYou() {
  const pending = useApprovals("pending");
  const approvals = (pending.data ?? []).filter((a) => a.status === "pending");
  if (approvals.length === 0) return null;
  return (
    <section aria-labelledby="today-waiting" className="flex flex-col gap-3">
      <h2 id="today-waiting" className="font-semibold text-ink text-title">
        Waiting for your answer
      </h2>
      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approvalId={approval.id} initial={approval} />
      ))}
    </section>
  );
}

function TodaysBrief() {
  const navigate = useNavigate();
  const brief = useBrief();
  const generate = useGenerateBrief();
  const settings = useSettings();

  function startEmail(item: TriageItem) {
    const sender = item.from.name || item.from.email;
    const prompt = item.subject
      ? `Take care of ${sender}'s email: ${item.subject}`
      : `Take care of ${sender}'s email.`;
    navigate(chatPromptHref(prompt));
  }

  if (brief.isPending) return <Loading>Loading today's brief…</Loading>;
  if (brief.isError) {
    return (
      <ErrorNotice
        title="Couldn't load today's brief"
        error={brief.error}
        onRetry={() => void brief.refetch()}
      />
    );
  }
  if (brief.data) {
    return (
      <div className="flex flex-col gap-2">
        <BriefCard brief={brief.data} onStart={startEmail} timeZone={settings.data?.timezone} />
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
            Check again
          </Button>
        </div>
        {generate.isError ? (
          <p role="alert" className="text-problem text-sub">
            Couldn't make the brief. {generate.error.message}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <Card as="section" aria-labelledby="today-brief">
      <CardHeader
        id="today-brief"
        title="Your brief"
        description={
          settings.data?.briefTime
            ? `Steward makes it each morning at ${settings.data.briefTime}. It reads your mail and calendar and tells you what needs you.`
            : "Steward reads your mail and calendar and tells you what needs you."
        }
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={<Sunrise />}
          loading={generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending ? "Reading your mail and calendar…" : "Make my brief"}
        </Button>
      </div>
      {generate.isError ? (
        <p role="alert" className="mt-3 text-problem text-sub">
          Couldn't make the brief. {generate.error.message}
        </p>
      ) : null}
    </Card>
  );
}

function NewestSuggestion() {
  const navigate = useNavigate();
  const suggested = useTasks("suggested");
  const start = useStartTask();
  const patch = usePatchTask();
  const [answer, setAnswer] = useState<{ id: string; kind: "started" | "hidden" } | undefined>();

  const newest: Task | undefined = [...(suggested.data?.tasks ?? [])]
    .filter((t) => t.state === "suggested")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) return null;
  const answered = answer?.id === newest.id ? answer.kind : undefined;

  return (
    <section aria-labelledby="today-suggestion" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-suggestion" className="flex items-center gap-2 font-semibold text-ink text-title">
          <Sparkles aria-hidden="true" className="size-5 text-accent" />
          Steward could take this on
        </h2>
        <Link
          to="/tasks?view=suggested"
          className="inline-flex min-h-target items-center gap-1 text-accent text-sub underline underline-offset-4"
        >
          All suggestions
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <TaskCard
        task={newest}
        actions={
          answered ? (
            <p role="status" className="font-medium text-ink-2 text-sub">
              {answered === "started" ? "Started." : "Hidden. It won't come back."}
            </p>
          ) : (
            <>
              <Button
                variant="primary"
                icon={<Play />}
                loading={start.isPending}
                onClick={() =>
                  start.mutate(
                    { id: newest.id },
                    {
                      onSuccess: ({ threadId }) => {
                        setAnswer({ id: newest.id, kind: "started" });
                        navigate(`/chat/${encodeURIComponent(threadId)}`);
                      },
                      onError: (error) => toast.error("Couldn't start it", { description: error.message }),
                    },
                  )
                }
              >
                Start
              </Button>
              <Button
                icon={<EyeOff />}
                loading={patch.isPending}
                onClick={() =>
                  patch.mutate(
                    { id: newest.id, state: "hidden" },
                    {
                      onSuccess: () => setAnswer({ id: newest.id, kind: "hidden" }),
                      onError: (error) => toast.error("Couldn't hide it", { description: error.message }),
                    },
                  )
                }
              >
                Hide
              </Button>
            </>
          )
        }
      />
    </section>
  );
}
