/**
 * A skill Steward wrote in the conversation (`show_skill`). The whole text is shown, and nothing is
 * saved until the person presses Save skill or saves it from Edit first. A saved skill grants no
 * tools: it is followed only when they call it by name, and every action still follows their rules.
 * When the conversation read outside content, the card says so above the button, since a page or
 * an email could have shaped what the skill says.
 */
import type { Skill } from "@steward/shared";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { SkillForm } from "@/components/forms/SkillForm.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { CardFrame } from "@/gallery/kit.tsx";
import { useCreateSkill, useSkills } from "@/lib/api.ts";
import { useChatActions } from "./chat-context.tsx";
import { DisplayTool, type ToolProps } from "./tool-cards.tsx";
import { readToolResult } from "./tool-result.ts";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function SkillToolCard(tool: ToolProps) {
  const chat = useChatActions();
  const outcome = readToolResult(tool.status === "complete" ? tool.result : undefined);
  return (
    <DisplayTool tool={tool}>
      <SkillDraft
        name={text(tool.args.name)}
        description={text(tool.args.description)}
        instructions={text(tool.args.instructions)}
        ready={outcome.status === "ok"}
        readOutside={chat?.readOutside ?? false}
      />
    </DisplayTool>
  );
}

export function SkillDraft({
  name,
  description,
  instructions,
  ready,
  readOutside,
}: {
  name: string;
  description: string;
  instructions: string;
  /** False while Steward is still writing it. */
  ready: boolean;
  readOutside: boolean;
}) {
  const skills = useSkills();
  const create = useCreateSkill();
  const [editing, setEditing] = useState(false);
  const [savedAs, setSavedAs] = useState<string | undefined>();
  const existing = skills.data?.find((skill) => skill.name === name);
  const saved = savedAs ?? existing?.name;

  function save() {
    create.mutate(
      { name, description, instructions, tools: [] },
      {
        onSuccess: (skill: Skill) => {
          setSavedAs(skill.name);
          toast.success("Skill added", { description: `/${skill.name}` });
        },
      },
    );
  }

  return (
    <CardFrame
      title={name ? `A skill to save: /${name}` : "A skill to save"}
      label={name ? `A skill to save: /${name}` : "A skill to save"}
      caption={description || undefined}
      footer={
        saved ? (
          <p role="status" className="m-0 text-ink text-sub">
            Saved as <code>/{saved}</code>. Type it in Chat to use it, or change it on{" "}
            <Link to="/skills" className="text-accent underline underline-offset-4">
              Skills
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {readOutside ? (
              <Notice tone="needs" role="note">
                Read it before saving: this conversation read outside content, such as a web page, an email or
                a file, and that could have shaped what the skill says.
              </Notice>
            ) : null}
            <p className="m-0 text-caption text-ink-2">
              Nothing is saved until you press Save skill. A skill adds no permissions: everything it asks for
              still follows your rules.
            </p>
            {create.isError ? (
              <p role="alert" className="m-0 font-medium text-problem text-sub">
                {create.error.message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon={<Sparkles />}
                disabled={!ready || !name}
                loading={create.isPending}
                onClick={save}
              >
                Save skill
              </Button>
              <Button disabled={!ready} onClick={() => setEditing(true)}>
                Edit first
              </Button>
            </div>
          </div>
        )
      }
    >
      {instructions ? (
        <p className="m-0 whitespace-pre-wrap break-words text-ink text-sub">{instructions}</p>
      ) : (
        <p className="m-0 text-ink-2 text-sub">Steward is writing it…</p>
      )}
      <Dialog open={editing} onOpenChange={setEditing} title="Add a skill" size="lg">
        {editing ? (
          <SkillForm
            draft={{ name, description, instructions, tools: [] }}
            onDone={() => setEditing(false)}
            onSaved={(skill) => setSavedAs(skill.name)}
          />
        ) : null}
      </Dialog>
    </CardFrame>
  );
}
