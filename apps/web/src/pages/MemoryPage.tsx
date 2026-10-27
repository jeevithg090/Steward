import { Brain, Plus, Trash } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { Field, Textarea } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { useAddMemory, useMemory, useRemoveMemory } from "@/lib/api.ts";
import { relativeTime } from "@/lib/utils.ts";

export function MemoryPage() {
  const memory = useMemory();
  const facts = [...(memory.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <Page
      title="Memory"
      description={
        <p>
          What Steward remembers about you, so you don't have to say it twice. It is kept in Steward's own
          database and given to the model only to help answer you. Forget anything you like.
        </p>
      }
    >
      <AddFact />
      <section aria-labelledby="memory-list" className="flex flex-col gap-3">
        <h2 id="memory-list" className="font-semibold text-ink text-title">
          What Steward remembers
        </h2>
        {memory.isPending ? (
          <Loading>Loading what Steward remembers…</Loading>
        ) : memory.isError ? (
          <ErrorNotice
            title="Couldn't load memory"
            error={memory.error}
            onRetry={() => void memory.refetch()}
          />
        ) : facts.length === 0 ? (
          <EmptyState icon={Brain} title="Nothing yet" level={3}>
            Tell Steward something above, or it will note things as you work together, such as "Prefers
            meetings after 10:00".
          </EmptyState>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
            {facts.map((fact) => (
              <li key={fact.id} className="border-hair-2 border-t first:border-t-0">
                <Fact id={fact.id} text={fact.text} source={fact.source} createdAt={fact.createdAt} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

function Fact({
  id,
  text,
  source,
  createdAt,
}: {
  id: string;
  text: string;
  source: "you" | "learned";
  createdAt: string;
}) {
  const remove = useRemoveMemory();
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink">{text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-2">
          <Badge tone={source === "you" ? "accent" : "neutral"}>
            {source === "you" ? "You told Steward" : "Steward noticed"}
          </Badge>
          {relativeTime(createdAt)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash />}
        loading={remove.isPending}
        aria-label={`Forget: ${text}`}
        onClick={() =>
          remove.mutate(id, {
            onSuccess: () => toast.success("Forgotten", { description: text }),
            onError: (error) => toast.error("Couldn't forget it", { description: error.message }),
          })
        }
      >
        Forget
      </Button>
    </div>
  );
}

function AddFact() {
  const add = useAddMemory();
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    add.mutate(value, {
      onSuccess: () => {
        setText("");
        toast.success("Remembered", { description: value });
      },
    });
  }

  return (
    <Card as="section" aria-labelledby="memory-add">
      <CardHeader id="memory-add" title="Tell Steward something" />
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <Field label="Something to remember" description="One fact at a time works best.">
          <Textarea
            value={text}
            rows={2}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            placeholder="I don't take calls on Fridays."
          />
        </Field>
        {add.isError ? (
          <p role="alert" className="font-medium text-problem text-sub">
            {add.error.message}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="primary"
            icon={<Plus />}
            loading={add.isPending}
            disabled={!text.trim()}
          >
            Remember this
          </Button>
        </div>
      </form>
    </Card>
  );
}
