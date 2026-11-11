import type { Skill } from "@steward/shared";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button.tsx";
import { Field, Input, Textarea } from "@/components/ui/Field.tsx";
import { type SkillInput, useCreateSkill, useUpdateSkill } from "@/lib/api.ts";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * Adds a skill, or edits `skill`. `draft` fills a new one in, such as a skill Steward wrote in a
 * conversation; it is saved only when the person presses Add skill.
 */
export function SkillForm({
  skill,
  draft,
  onDone,
  onSaved,
}: {
  skill?: Skill;
  draft?: Partial<SkillInput>;
  onDone: () => void;
  onSaved?: (saved: Skill) => void;
}) {
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const start = skill ?? draft;
  const [name, setName] = useState(start?.name ?? "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [instructions, setInstructions] = useState(start?.instructions ?? "");
  const [tools, setTools] = useState((start?.tools ?? []).join(", "));
  const [touched, setTouched] = useState(false);
  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const nameError = !NAME_PATTERN.test(name)
    ? "Lowercase letters, numbers and dashes, like weekly-review."
    : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (nameError || !description.trim() || !instructions.trim()) return;
    const body = {
      name,
      description: description.trim(),
      instructions: instructions.trim(),
      tools: tools
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    };
    const done = {
      onSuccess: (saved: Skill) => {
        toast.success(skill ? "Skill saved" : "Skill added", { description: `/${body.name}` });
        onSaved?.(saved);
        onDone();
      },
    };
    if (skill) update.mutate({ id: skill.id, ...body }, done);
    else create.mutate(body, done);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field
        label="Name"
        required
        description="You'll type /name in Chat."
        error={touched ? nameError : undefined}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="weekly-review"
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
        />
      </Field>
      <Field
        label="What it's for"
        required
        error={touched && !description.trim() ? "Say what the skill is for." : undefined}
      >
        <Input
          value={description}
          maxLength={300}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short summary of my week"
        />
      </Field>
      <Field
        label="Instructions"
        required
        description="What Steward should do, in your own words."
        error={touched && !instructions.trim() ? "Write the instructions." : undefined}
      >
        <Textarea
          value={instructions}
          rows={7}
          maxLength={8000}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      <Field
        label="Tools it needs"
        description="Optional. Tool names separated by commas, like mail_list, calendar_list."
      >
        <Input
          value={tools}
          onChange={(e) => setTools(e.target.value)}
          className="font-mono"
          spellCheck={false}
        />
      </Field>
      {error ? (
        <p role="alert" className="font-medium text-problem text-sub">
          {error.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={pending}>
          {skill ? "Save skill" : "Add skill"}
        </Button>
      </div>
    </form>
  );
}
