import { ROUTINE_LIMITS, type Routine } from "@steward/shared";
import { CalendarClock, MessageSquare, Play, Plus, Repeat, Trash } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { TimezoneSelect } from "@/components/forms/TimezoneSelect.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { Field, Input, Switch, Textarea } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading, Notice } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import {
  useCreateRoutine,
  useDeleteRoutine,
  useRoutines,
  useRunRoutine,
  useUpdateRoutine,
} from "@/lib/api.ts";
import { CRON_PRESETS, checkCron } from "@/lib/cron.ts";
import { browserTimeZone, formatDateTime, relativeTime } from "@/lib/utils.ts";

export function RoutinesPage() {
  const routines = useRoutines();
  const list = [...(routines.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const enabled = list.filter((r) => r.enabled).length;

  return (
    <Page
      title="Routines"
      description={
        <p>
          Work Steward does on a schedule, without being asked each time. It still asks before it sends, pays,
          signs or deletes anything. You can also set one up by asking in Chat.
        </p>
      }
    >
      <section aria-labelledby="routines-list" className="flex flex-col gap-3">
        <h2 id="routines-list" className="font-semibold text-ink text-title">
          Your routines
          {list.length > 0 ? (
            <span className="ml-2 font-normal text-ink-2 text-sub">
              {enabled} of {ROUTINE_LIMITS.maxEnabled} switched on
            </span>
          ) : null}
        </h2>
        {routines.isPending ? (
          <Loading>Loading your routines…</Loading>
        ) : routines.isError ? (
          <ErrorNotice
            title="Couldn't load your routines"
            error={routines.error}
            onRetry={() => void routines.refetch()}
          />
        ) : list.length === 0 ? (
          <EmptyState icon={Repeat} title="No routines yet">
            Add one below, for example "Every weekday at 08:00, check my inbox and tell me what needs me".
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((routine) => (
              <li key={routine.id}>
                <RoutineCard routine={routine} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewRoutine />
    </Page>
  );
}

function LastResult({ routine }: { routine: Routine }) {
  if (!routine.lastRunAt || !routine.lastStatus) return <span className="text-ink-2">Hasn't run yet</span>;
  const pill =
    routine.lastStatus === "ok" ? (
      <Pill tone="done">Worked</Pill>
    ) : routine.lastStatus === "refused" ? (
      <Pill tone="needs">Refused</Pill>
    ) : routine.lastStatus === "skipped" ? (
      <Pill tone="needs">Waiting for you</Pill>
    ) : (
      <Pill tone="problem">Failed</Pill>
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      {pill}
      <span className="text-ink-2">{relativeTime(routine.lastRunAt)}</span>
      {routine.lastError ? <span className="block w-full text-ink-2">{routine.lastError}</span> : null}
    </span>
  );
}

function RoutineCard({ routine }: { routine: Routine }) {
  const navigate = useNavigate();
  const update = useUpdateRoutine();
  const run = useRunRoutine();
  const remove = useDeleteRoutine();
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();

  return (
    <Card as="article" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="font-semibold text-body text-ink">
            {routine.title}
          </h3>
          <p className="mt-1 text-ink-2 text-sub">“{routine.prompt}”</p>
        </div>
        <Switch
          checked={routine.enabled}
          onCheckedChange={(on) =>
            update.mutate(
              { id: routine.id, enabled: on },
              {
                onSuccess: () =>
                  toast.success(on ? "Switched on" : "Switched off", { description: routine.title }),
                onError: (error) => toast.error("That didn't work", { description: error.message }),
              },
            )
          }
          disabled={update.isPending}
          label={
            <>
              On schedule<span className="sr-only">: {routine.title}</span>
            </>
          }
          className="shrink-0"
        />
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sub sm:grid-cols-[8rem_1fr]">
        <dt className="text-ink-2">When</dt>
        <dd className="text-ink">
          {routine.scheduleText} <span className="text-ink-2">({routine.timezone.replaceAll("_", " ")})</span>
        </dd>
        <dt className="text-ink-2">Next run</dt>
        <dd className="text-ink">
          {routine.enabled && routine.nextRunAt ? (
            <>
              {formatDateTime(routine.nextRunAt)}{" "}
              <span className="text-ink-2">({relativeTime(routine.nextRunAt)})</span>
            </>
          ) : (
            <span className="text-ink-2">Paused</span>
          )}
        </dd>
        <dt className="text-ink-2">Last result</dt>
        <dd className="text-ink">
          <LastResult routine={routine} />
        </dd>
      </dl>

      {routine.consecutiveFailures > 0 ? (
        <Notice tone="needs">
          Failed {routine.consecutiveFailures} {routine.consecutiveFailures === 1 ? "time" : "times"} in a
          row. After {ROUTINE_LIMITS.maxConsecutiveFailures}, it switches itself off.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon={<Play />}
          loading={run.isPending}
          disabled={!routine.enabled}
          aria-describedby={routine.enabled ? undefined : `${headingId}-paused`}
          onClick={() =>
            run.mutate(routine.id, {
              onSuccess: ({ threadId }) =>
                toast.success("Running now", {
                  description: "Steward is doing the work in the routine's conversation.",
                  action: { label: "Open", onClick: () => navigate(`/chat/${encodeURIComponent(threadId)}`) },
                }),
              onError: (error) => toast.error("Couldn't run it", { description: error.message }),
            })
          }
        >
          Run now
        </Button>
        <Button variant="ghost" icon={<Trash />} onClick={() => setConfirming(true)}>
          Delete
        </Button>
        {routine.threadId ? (
          <Link
            to={`/chat/${encodeURIComponent(routine.threadId)}`}
            className="inline-flex min-h-target items-center gap-1.5 px-1 text-accent text-sub underline underline-offset-4"
          >
            <MessageSquare aria-hidden="true" className="size-4" />
            See what it did<span className="sr-only">: {routine.title}</span>
          </Link>
        ) : null}
      </div>
      {!routine.enabled ? (
        <p id={`${headingId}-paused`} className="text-caption text-ink-2">
          This routine is paused. Turn it on to run it.
        </p>
      ) : null}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this routine?"
        description={`"${routine.title}" will stop running. Its past conversations stay.`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(routine.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success("Routine deleted", { description: routine.title });
                  },
                  onError: (error) => toast.error("Couldn't delete it", { description: error.message }),
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />
    </Card>
  );
}

function NewRoutine() {
  const create = useCreateRoutine();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("0 8 * * 1-5");
  const [timezone, setTimezone] = useState(browserTimeZone);
  const [touched, setTouched] = useState(false);
  const cron = checkCron(schedule);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!title.trim() || !prompt.trim() || !cron.ok) return;
    create.mutate(
      { title: title.trim(), prompt: prompt.trim(), schedule: schedule.trim(), timezone, enabled: true },
      {
        onSuccess: (routine) => {
          toast.success("Routine added", { description: `${routine.title}: ${routine.scheduleText}` });
          setTitle("");
          setPrompt("");
          setTouched(false);
        },
      },
    );
  }

  return (
    <Card as="section" aria-labelledby="routine-new">
      <CardHeader
        id="routine-new"
        title="Add a routine"
        description={`Routines run at most every ${ROUTINE_LIMITS.minIntervalMinutes} minutes, and up to ${ROUTINE_LIMITS.maxEnabled} can be on at once. After ${ROUTINE_LIMITS.maxConsecutiveFailures} failures in a row, a routine switches itself off.`}
      />
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
        <Field label="Name" required error={touched && !title.trim() ? "Give it a name." : undefined}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Morning inbox check"
          />
        </Field>
        <Field
          label="What should Steward do each time?"
          description="Write it as one run's work, in your own words."
          required
          error={touched && !prompt.trim() ? "Say what it should do." : undefined}
        >
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Check my inbox and tell me what needs me."
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-ink text-sub">When</legend>
          <div className="flex flex-wrap gap-2">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.cron}
                size="sm"
                variant={schedule === preset.cron ? "primary" : "secondary"}
                aria-pressed={schedule === preset.cron}
                onClick={() => setSchedule(preset.cron)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Field
            label="Schedule (cron)"
            description="Five parts: minute, hour, day of month, month, day of week. 0 8 * * 1-5 means weekdays at 08:00."
            error={cron.ok ? undefined : cron.error}
          >
            <Input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          {cron.text ? (
            <p aria-live="polite" className="flex items-center gap-2 text-ink text-sub">
              <CalendarClock aria-hidden="true" className="size-4 text-ink-2" />
              {cron.text}
            </p>
          ) : null}
        </fieldset>
        <Field label="Time zone">
          <TimezoneSelect value={timezone} onChange={setTimezone} />
        </Field>
        {create.isError ? (
          <p role="alert" className="font-medium text-problem text-sub">
            {create.error.message}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" icon={<Plus />} loading={create.isPending}>
            Add routine
          </Button>
        </div>
      </form>
    </Card>
  );
}
