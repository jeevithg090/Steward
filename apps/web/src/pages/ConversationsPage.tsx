/**
 * `/conversations`: every conversation, newest first, not just the few the sidebar has room for.
 * Find one by its name or its last message, narrow it to chats, routines or tasks, open it, rename
 * it, or delete it. Deleting asks first and says what goes with it.
 */
import type { ThreadSummary } from "@steward/shared";
import { MessageSquare, MessageSquarePlus, Pencil, Trash } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/Button.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { ChoiceGroup, Field, Input } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { useDeleteThread, useRenameThread, useThreads } from "@/lib/api.ts";
import { relativeTime } from "@/lib/utils.ts";

type KindFilter = "all" | ThreadSummary["kind"];

const KIND_LABELS: Record<ThreadSummary["kind"], string> = {
  chat: "Chat",
  routine: "Routine",
  task: "Task",
};

/** True when the words are in the conversation's name or its last message, ignoring case. */
export function matchesConversation(thread: ThreadSummary, words: string): boolean {
  const query = words.trim().toLowerCase();
  if (!query) return true;
  return `${thread.title}\n${thread.lastMessagePreview ?? ""}`.toLowerCase().includes(query);
}

export function ConversationsPage() {
  const threads = useThreads();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [renaming, setRenaming] = useState<ThreadSummary | undefined>();
  const [deleting, setDeleting] = useState<ThreadSummary | undefined>();
  const listId = useId();

  const all = [...(threads.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = all.filter(
    (thread) => (kind === "all" || thread.kind === kind) && matchesConversation(thread, query),
  );

  return (
    <Page
      title="Conversations"
      description={<p>Every conversation with Steward, newest first. Open one, rename it, or delete it.</p>}
      actions={
        <LinkButton to="/chat" variant="primary" icon={<MessageSquarePlus />}>
          New conversation
        </LinkButton>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Field label="Find a conversation" className="sm:max-w-sm sm:flex-1">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="A name or something said in it"
            aria-controls={listId}
          />
        </Field>
        <ChoiceGroup<KindFilter>
          legend="Show"
          value={kind}
          onValueChange={setKind}
          choices={[
            { value: "all", label: "All" },
            { value: "chat", label: "Chats" },
            { value: "routine", label: "Routines" },
            { value: "task", label: "Tasks" },
          ]}
        />
      </div>

      <section aria-label="Conversations" className="mt-6 flex flex-col gap-3">
        <p role="status" className="m-0 text-caption text-ink-2">
          {threads.isSuccess
            ? shown.length === all.length
              ? `${all.length} ${all.length === 1 ? "conversation" : "conversations"}`
              : `${shown.length} of ${all.length} conversations`
            : ""}
        </p>
        {threads.isPending ? (
          <Loading>Loading your conversations…</Loading>
        ) : threads.isError ? (
          <ErrorNotice
            title="Couldn't load your conversations"
            error={threads.error}
            onRetry={() => void threads.refetch()}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={all.length === 0 ? "No conversations yet" : "Nothing matches"}
          >
            {all.length === 0
              ? "Ask Steward something and the conversation is kept here."
              : "Try other words, or show every kind."}
          </EmptyState>
        ) : (
          <ul
            id={listId}
            className="m-0 flex list-none flex-col overflow-hidden rounded-card bg-card p-0 shadow-card"
          >
            {shown.map((thread) => (
              <li key={thread.id} className="border-hair-2 border-t first:border-t-0">
                <ConversationRow
                  thread={thread}
                  onRename={() => setRenaming(thread)}
                  onDelete={() => setDeleting(thread)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <RenameDialog thread={renaming} onClose={() => setRenaming(undefined)} />
      <DeleteConversationDialog thread={deleting} onClose={() => setDeleting(undefined)} />
    </Page>
  );
}

function ConversationRow({
  thread,
  onRename,
  onDelete,
}: {
  thread: ThreadSummary;
  onRename: () => void;
  onDelete: () => void;
}) {
  const title = thread.title || "New conversation";
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-center gap-2">
          <Link
            to={`/chat/${encodeURIComponent(thread.id)}`}
            className="truncate font-medium text-body text-ink underline-offset-2 hover:underline"
          >
            {title}
          </Link>
          {thread.running ? <Pill tone="working">Working</Pill> : null}
        </p>
        <p className="m-0 mt-0.5 text-caption text-ink-2">
          {KIND_LABELS[thread.kind]} · {relativeTime(thread.updatedAt)}
        </p>
        {thread.lastMessagePreview ? (
          <p className="m-0 mt-1 line-clamp-1 text-ink-2 text-sub">{thread.lastMessagePreview}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" icon={<Pencil />} aria-label={`Rename ${title}`} onClick={onRename}>
          Rename
        </Button>
        <Button variant="ghost" size="sm" icon={<Trash />} aria-label={`Delete ${title}`} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function RenameDialog({ thread, onClose }: { thread: ThreadSummary | undefined; onClose: () => void }) {
  return (
    <Dialog
      open={thread !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title="Rename conversation"
      size="sm"
    >
      {/* Keyed, so each conversation starts with its own name in the box. */}
      {thread ? <RenameForm key={thread.id} thread={thread} onDone={onClose} /> : null}
    </Dialog>
  );
}

function RenameForm({ thread, onDone }: { thread: ThreadSummary; onDone: () => void }) {
  const rename = useRenameThread();
  const [title, setTitle] = useState(thread.title);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    rename.mutate(
      { id: thread.id, title: value },
      {
        onSuccess: () => {
          toast.success("Renamed", { description: value });
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Name" error={rename.isError ? rename.error.message : undefined}>
        <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={rename.isPending} disabled={!title.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Asks before deleting a conversation, and says what goes with it. Used here and in the chat. */
export function DeleteConversationDialog({
  thread,
  onClose,
  onDeleted,
}: {
  thread: Pick<ThreadSummary, "id" | "title" | "running"> | undefined;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteThread();
  const title = thread?.title || "New conversation";
  return (
    <Dialog
      open={thread !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          remove.reset();
          onClose();
        }
      }}
      title={`Delete “${title}”?`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            icon={<Trash />}
            loading={remove.isPending}
            onClick={() => {
              if (!thread) return;
              remove.mutate(thread.id, {
                onSuccess: () => {
                  toast.success("Conversation deleted", { description: title });
                  onClose();
                  onDeleted?.();
                },
              });
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-ink-2 text-sub">
        <p className="m-0">Its messages are removed from Steward. This can't be undone.</p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
          {thread?.running ? <li>Steward is working in it now. That work stops.</li> : null}
          <li>A coding agent working in it stops, and so do tasks it handed to other agents.</li>
          <li>Anything you allowed for this conversation only is turned off.</li>
          <li>The record of what Steward did stays on the Record page.</li>
        </ul>
        {remove.isError ? (
          <p role="alert" className="m-0 font-medium text-problem">
            {remove.error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
