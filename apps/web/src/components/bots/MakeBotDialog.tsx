import { BOT_CATEGORIES, type BotCategory, type BotPack } from "@steward/shared";
import { ArrowLeft, WandSparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { Field, Input, Select, Textarea } from "@/components/ui/Field.tsx";
import { Notice } from "@/components/ui/Notice.tsx";
import { useInfo, useMakeBot } from "@/lib/api.ts";
import { BotActions, BotListingView, useListingPreview } from "./BotListingView.tsx";

/**
 * Make a bot: the person says what it should do, the server writes a pack with their own model, and
 * the pack is shown as a listing (what it may do included) before anything is added. With the
 * scripted model there is no model to write with, and the pack says so.
 */

const CATEGORY_IDS = Object.keys(BOT_CATEGORIES) as BotCategory[];

function isCategory(value: string): value is BotCategory {
  return Object.hasOwn(BOT_CATEGORIES, value);
}

export function MakeBotDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pack, setPack] = useState<BotPack | undefined>();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setPack(undefined);
      }}
      title={pack ? pack.name : "Make a bot"}
      description={
        pack ? undefined : "Say what it should do. Steward writes the pack and shows it before you add it."
      }
      size="lg"
    >
      {open ? (
        pack ? (
          <MadePack pack={pack} onBack={() => setPack(undefined)} />
        ) : (
          <MakeForm onMade={setPack} onCancel={() => onOpenChange(false)} />
        )
      ) : null}
    </Dialog>
  );
}

function MakeForm({ onMade, onCancel }: { onMade: (pack: BotPack) => void; onCancel: () => void }) {
  const info = useInfo();
  const make = useMakeBot();
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [category, setCategory] = useState("");
  const [touched, setTouched] = useState(false);
  const jobError = job.trim().length < 3 ? "Say what the bot should do, in a sentence or two." : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (jobError) return;
    make.mutate(
      {
        job: job.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(isCategory(category) ? { category } : {}),
      },
      { onSuccess: onMade },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {info.data?.model.scripted ? (
        <Notice tone="neutral" role="note">
          No model key is set, so the bot will be made from a template rather than written for your job.
        </Notice>
      ) : null}
      <Field
        label="What should it do?"
        required
        description="In your words, like “Chase unpaid invoices politely, then firmly after two weeks.”"
        error={touched ? jobError : undefined}
      >
        <Textarea value={job} rows={4} maxLength={600} onChange={(e) => setJob(e.target.value)} />
      </Field>
      <Field label="Name" description="Optional. Steward picks one from the job if you leave it blank.">
        <Input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Invoice chaser"
        />
      </Field>
      <Field label="Category" description="Optional.">
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Let Steward choose</option>
          {CATEGORY_IDS.map((id) => (
            <option key={id} value={id}>
              {BOT_CATEGORIES[id]}
            </option>
          ))}
        </Select>
      </Field>
      {make.error ? (
        <p role="alert" className="m-0 font-medium text-problem text-sub">
          {make.error.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" icon={<WandSparkles />} loading={make.isPending}>
          Write the bot
        </Button>
      </div>
    </form>
  );
}

/** The written pack as a listing. Once added, the actions turn into Installed and Talk to it. */
function MadePack({ pack, onBack }: { pack: BotPack; onBack: () => void }) {
  const info = useInfo();
  const preview = useListingPreview({ pack });
  return (
    <div className="flex flex-col gap-5">
      {info.data?.model.scripted ? (
        <Notice tone="neutral" role="note">
          Made from a template because no model key is set.
        </Notice>
      ) : null}
      <BotListingView
        pack={preview.data?.pack ?? pack}
        preview={preview.data}
        previewPending={preview.isPending}
        previewError={preview.error?.message}
        onRetryPreview={() => preview.mutate({ pack })}
        level={3}
      />
      <div className="flex flex-wrap items-start justify-between gap-3 border-hair border-t pt-4">
        <BotActions
          pack={pack}
          source={{ pack }}
          installed={preview.data?.alreadyInstalled}
          ready={preview.isSuccess}
        />
        <Button variant="ghost" icon={<ArrowLeft />} onClick={onBack}>
          Change the job
        </Button>
      </div>
    </div>
  );
}
