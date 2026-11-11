/**
 * Edit a routine in place: its name, its work, when it runs and in which time zone. Only what
 * changed is sent, and the server's sentence is shown here when it refuses (a schedule more often
 * than every 15 minutes, say). The routine keeps its conversation and its last result.
 */
import type { Routine } from "@steward/shared";
import { CalendarClock } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { TimezoneSelect } from "@/components/forms/TimezoneSelect.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Field, Input, Textarea } from "@/components/ui/Field.tsx";
import { type RoutineInput, useUpdateRoutine } from "@/lib/api.ts";
import { CRON_PRESETS, checkCron } from "@/lib/cron.ts";

/** What the form changes, compared with the saved routine. Empty when nothing did. */
export function routineChanges(
  routine: Pick<Routine, "title" | "prompt" | "schedule" | "timezone">,
  form: { title: string; prompt: string; schedule: string; timezone: string },
): Partial<RoutineInput> {
  const next = {
    title: form.title.trim(),
    prompt: form.prompt.trim(),
    schedule: form.schedule.trim().replace(/\s+/g, " "),
    timezone: form.timezone,
  };
  return Object.fromEntries(
    (Object.keys(next) as (keyof typeof next)[])
      .filter((key) => next[key] !== routine[key])
      .map((key) => [key, next[key]]),
  );
}

export function RoutineEditDialog({
  routine,
  open,
  onClose,
}: {
  routine: Routine;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={`Edit “${routine.title}”`}
      size="md"
    >
      {/* Drawn only while open, so each opening starts from what is saved now. */}
      {open ? <EditForm routine={routine} onDone={onClose} /> : null}
    </Dialog>
  );
}

function EditForm({ routine, onDone }: { routine: Routine; onDone: () => void }) {
  const update = useUpdateRoutine();
  const [title, setTitle] = useState(routine.title);
  const [prompt, setPrompt] = useState(routine.prompt);
  const [schedule, setSchedule] = useState(routine.schedule);
  const [timezone, setTimezone] = useState(routine.timezone);
  const [touched, setTouched] = useState(false);
  const describerId = useId();
  const cron = checkCron(schedule);
  const changes = routineChanges(routine, { title, prompt, schedule, timezone });
  const changed = Object.keys(changes).length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!title.trim() || !prompt.trim() || !cron.ok) return;
    if (!changed) {
      onDone();
      return;
    }
    update.mutate(
      { id: routine.id, ...changes },
      {
        onSuccess: (saved) => {
          toast.success("Routine changed", { description: `${saved.title}: ${saved.scheduleText}` });
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Name" required error={touched && !title.trim() ? "Give it a name." : undefined}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </Field>
      <Field
        label="What should Steward do each time?"
        description="Write it as one run's work, in your own words."
        required
        error={touched && !prompt.trim() ? "Say what it should do." : undefined}
      >
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} rows={3} />
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
          description="Minute, hour, day of month, month, day of week. 0 8 * * 1-5 means weekdays at 08:00."
          error={cron.ok ? undefined : cron.error}
        >
          <Input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            aria-describedby={cron.text ? describerId : undefined}
          />
        </Field>
        {cron.text ? (
          <p id={describerId} aria-live="polite" className="m-0 flex items-center gap-2 text-ink text-sub">
            <CalendarClock aria-hidden="true" className="size-4 text-ink-2" />
            {cron.text}
          </p>
        ) : null}
      </fieldset>
      <Field label="Time zone">
        <TimezoneSelect value={timezone} onChange={setTimezone} />
      </Field>
      {update.isError ? (
        <p role="alert" className="m-0 font-medium text-problem text-sub">
          {update.error.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
