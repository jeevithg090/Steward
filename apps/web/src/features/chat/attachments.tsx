/**
 * Text files the person attaches to a message. They wait in the composer, each with a Remove
 * button, and nothing reaches Steward's workspace until the message is sent: then each one is
 * added under `uploads/` and the message says where. Steward reads them with file_read, which
 * counts as outside content, so instructions hidden in a file cannot act on their own.
 */
import { UPLOAD_EXTENSIONS, UPLOAD_MAX_BYTES, type WorkspaceFile } from "@steward/shared";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { api, queryKeys } from "@/lib/api.ts";
import { formatBytes } from "@/lib/utils.ts";

/** At most this many files go with one message. */
export const ATTACH_MAX_FILES = 5;

export interface Attachment {
  id: string;
  name: string;
  size: number;
  text: string;
  /** Where it went in the workspace, once it has. A retry never adds it twice. */
  saved?: WorkspaceFile;
}

const ACCEPT = UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(",");
const KINDS = ".txt, .md, .csv, .json, .ics, .html, .xml, .yaml or .log";

/** Why a file can't be attached, in a sentence, or undefined when it can. */
export function attachProblem(file: { name: string; size: number }): string | undefined {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!file.name.includes(".") || !(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return `“${file.name}” isn't a kind of file Steward can read. It can take ${KINDS} files.`;
  }
  if (file.size > UPLOAD_MAX_BYTES) return `“${file.name}” is larger than 2 MB.`;
  return undefined;
}

/** A file's text, or undefined when it is not UTF-8 text (a picture, a PDF, a spreadsheet). */
export async function readText(file: Blob): Promise<string | undefined> {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

/** The sentence the message ends with: "I attached uploads/notes.md (2.1 KB)." */
export function attachedSentence(files: Pick<WorkspaceFile, "path" | "size">[]): string {
  const named = files.map((file) => `${file.path} (${formatBytes(file.size)})`);
  if (named.length === 0) return "";
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `I attached ${list} to your workspace.`;
}

let next = 0;

/**
 * The files waiting to go with the next message. `send` adds them to the workspace and returns the
 * sentence for the message; it throws, keeping them, when one could not be added.
 */
export function useAttachments(agentId: string | undefined) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Attachment[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);

  async function add(files: Iterable<File>) {
    const problems: string[] = [];
    const added: Attachment[] = [];
    for (const file of files) {
      if (items.length + added.length >= ATTACH_MAX_FILES) {
        problems.push(`One message can take ${ATTACH_MAX_FILES} files at most.`);
        break;
      }
      const why = attachProblem(file);
      if (why) {
        problems.push(why);
        continue;
      }
      const text = await readText(file);
      if (text === undefined) {
        problems.push(`“${file.name}” isn't plain text, so Steward can't read it.`);
        continue;
      }
      next += 1;
      added.push({ id: `att_${next}`, name: file.name, size: file.size, text });
    }
    if (added.length > 0) {
      setItems((current) => [...current, ...added]);
      setNotice(
        `Attached ${added.map((a) => a.name).join(", ")}. ${added.length === 1 ? "It goes" : "They go"} with your next message.`,
      );
    }
    setProblem(problems.length > 0 ? problems.join(" ") : null);
  }

  function remove(id: string) {
    const gone = items.find((item) => item.id === id);
    setItems((current) => current.filter((item) => item.id !== id));
    if (gone) setNotice(`Removed ${gone.name}.`);
    setProblem(null);
  }

  async function send(): Promise<string> {
    if (!agentId || items.length === 0) return "";
    setSending(true);
    setProblem(null);
    const done = [...items];
    try {
      for (const [i, item] of done.entries()) {
        if (item.saved) continue;
        const saved = await api.computer.upload(agentId, { name: item.name, text: item.text });
        done[i] = { ...item, saved };
      }
    } catch (err) {
      setItems(done);
      setProblem(err instanceof Error ? err.message : "Steward couldn't take that file.");
      throw err;
    } finally {
      setSending(false);
      void qc.invalidateQueries({ queryKey: queryKeys.computer(agentId) });
    }
    setItems([]);
    setNotice("");
    return attachedSentence(done.flatMap((item) => (item.saved ? [item.saved] : [])));
  }

  return { items, problem, notice, sending, add, remove, send };
}

/** The paperclip: opens the file picker. */
export function AttachButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Attach a text file"
        title={`Attach ${KINDS} files, up to 2 MB`}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden />
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

/** The files waiting to go, each with Remove. */
export function AttachmentChips({
  items,
  onRemove,
  disabled,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Files to send" className="m-0 flex list-none flex-wrap gap-2 p-0 px-1 pb-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hair bg-tile py-0.5 ps-3 text-caption text-ink"
        >
          <FileText aria-hidden className="size-4 shrink-0 text-ink-2" />
          <span className="truncate">{item.name}</span>
          <span className="shrink-0 text-ink-2">{formatBytes(item.size)}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${item.name}`}
            disabled={disabled}
            onClick={() => onRemove(item.id)}
          >
            <X aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
