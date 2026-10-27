import type { Skill } from "@steward/shared";
import { Pencil, Plus, Sparkles, Trash } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { Field, Input, Textarea } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { useCreateSkill, useDeleteSkill, useSkills, useUpdateSkill } from "@/lib/api.ts";
import { toolLabel } from "@/lib/labels.ts";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function SkillsPage() {
  const skills = useSkills();
  const [editing, setEditing] = useState<Skill | "new" | undefined>();
  const list = [...(skills.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Page
      title="Skills"
      description={
        <p>
          Instructions written once and used whenever you like. Type <code>/</code> and the skill's name in
          Chat. A skill can only ask Steward to use what it already may; every action still follows your
          rules.
        </p>
      }
      actions={
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
          Add a skill
        </Button>
      }
    >
      {skills.isPending ? (
        <Loading>Loading skills…</Loading>
      ) : skills.isError ? (
        <ErrorNotice
          title="Couldn't load skills"
          error={skills.error}
          onRetry={() => void skills.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No skills yet"
          action={
            <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
              Add a skill
            </Button>
          }
        >
          For example, a weekly review: "Look at what I did this week and what's coming next week, then write
          me a short summary."
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((skill) => (
            <li key={skill.id}>
              <SkillCard skill={skill} onEdit={() => setEditing(skill)} />
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing && editing !== "new" ? `Edit /${editing.name}` : "Add a skill"}
        size="lg"
      >
        {editing !== undefined ? (
          <SkillForm
            key={editing === "new" ? "new" : editing.id}
            skill={editing === "new" ? undefined : editing}
            onDone={() => setEditing(undefined)}
          />
        ) : null}
      </Dialog>
    </Page>
  );
}

function SkillCard({ skill, onEdit }: { skill: Skill; onEdit: () => void }) {
  const remove = useDeleteSkill();
  const [confirming, setConfirming] = useState(false);
  const fromSetup = skill.source === "tenant";
  return (
    <Card as="article" aria-label={`/${skill.name}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono font-semibold text-body text-ink">/{skill.name}</h2>
        {fromSetup ? <Badge>From your setup</Badge> : <Badge tone="accent">Yours</Badge>}
      </div>
      <p className="text-ink text-sub">{skill.description}</p>
      <details>
        <summary className="inline-flex min-h-target cursor-pointer items-center text-accent text-sub underline underline-offset-4">
          Read the instructions
        </summary>
        <p className="mt-1 whitespace-pre-wrap rounded-field bg-tile p-3 text-ink text-sub">
          {skill.instructions}
        </p>
      </details>
      {skill.tools.length > 0 ? (
        <p className="text-caption text-ink-2">Uses: {skill.tools.map(toolLabel).join(", ")}</p>
      ) : null}
      {fromSetup ? (
        <p className="text-caption text-ink-2">Change it in the package's skills.yaml.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button icon={<Pencil />} onClick={onEdit} aria-label={`Edit /${skill.name}`}>
            Edit
          </Button>
          <Button
            variant="ghost"
            icon={<Trash />}
            onClick={() => setConfirming(true)}
            aria-label={`Delete /${skill.name}`}
          >
            Delete
          </Button>
        </div>
      )}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title={`Delete /${skill.name}?`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(skill.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success("Skill deleted", { description: `/${skill.name}` });
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

function SkillForm({ skill, onDone }: { skill?: Skill; onDone: () => void }) {
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [tools, setTools] = useState((skill?.tools ?? []).join(", "));
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
      onSuccess: () => {
        toast.success(skill ? "Skill saved" : "Skill added", { description: `/${body.name}` });
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
