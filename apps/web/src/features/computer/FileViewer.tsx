/**
 * Opens a file from Steward's workspace: a page it made, a note it saved, a file the person added.
 *
 * What Steward makes can carry text it read on the web or in mail, so nothing in a file may act:
 * - Markdown goes through the chat's own renderer: raw HTML dropped, images never loaded, links
 *   behind a confirmation.
 * - HTML is drawn in an `<iframe sandbox="">` from `srcdoc`: no scripts, no forms, no popups, and an
 *   opaque origin that cannot reach Steward's API or storage. Before that the page is parsed (inert)
 *   and given a Content-Security-Policy that loads nothing from anywhere, and its links and form
 *   targets are taken out, so a click inside it goes nowhere.
 * - Everything else is shown as plain text.
 */
import type { WorkspaceFileText } from "@steward/shared";
import { FileText } from "lucide-react";
import { useMemo } from "react";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { useWorkspaceFile } from "@/lib/api.ts";
import { formatBytes, relativeTime } from "@/lib/utils.ts";
import { Markdown } from "../chat/Markdown.tsx";

/** The policy the page is drawn under: nothing loads except its own inline styles and data images. */
export const VIEWER_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'";

/** Attributes that would send the frame, or a ping, somewhere else when clicked or submitted. */
const LEAVING = new Set(["href", "xlink:href", "ping", "action", "formaction", "target", "formtarget"]);
const LINKS = new Set(["a", "area"]);

/**
 * The page as the frame will draw it. Parsing with DOMParser runs nothing and loads nothing. Scripts
 * are removed (the sandbox would stop them anyway), links keep their words but lead nowhere (the
 * address stays as a tooltip), and the policy is the first thing in the head, so it covers all of it.
 */
export function sandboxedDocument(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of doc.querySelectorAll(
    "script, noscript, base, link, meta[http-equiv], iframe, frame, object, embed, portal",
  )) {
    node.remove();
  }
  for (const node of doc.querySelectorAll("*")) {
    const href = LINKS.has(node.localName)
      ? (node.getAttribute("href") ?? node.getAttribute("xlink:href"))
      : null;
    for (const attribute of [...node.attributes]) {
      if (LEAVING.has(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
    }
    if (href && !node.hasAttribute("title")) node.setAttribute("title", href);
  }
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", VIEWER_CSP);
  doc.head.prepend(meta);
  const referrer = doc.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  meta.after(referrer);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function nameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** The file's contents, drawn the safe way for its kind. */
export function FileContent({ file }: { file: WorkspaceFileText }) {
  const page = useMemo(() => (file.format === "html" ? sandboxedDocument(file.text) : ""), [file]);
  if (file.format === "html") {
    return (
      <iframe
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={page}
        title={`${nameOf(file.path)}, with its scripts and links turned off`}
        className="h-[60dvh] w-full rounded-tile border border-hair bg-white"
      />
    );
  }
  if (file.format === "markdown") {
    return (
      <div className="rounded-tile border border-hair bg-card p-4">
        <Markdown headingsFrom={3}>{file.text}</Markdown>
      </div>
    );
  }
  return (
    <pre className="m-0 max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded-tile border border-hair bg-tile p-3 font-mono text-ink text-sub">
      {file.text}
    </pre>
  );
}

/** Loads one workspace file and shows it, with its size and age, and a note when it was cut. */
export function FileViewer({ agentId, path }: { agentId: string; path: string }) {
  const file = useWorkspaceFile(agentId, path);
  if (file.isError)
    return <ErrorNotice title="Couldn't open this file" error={file.error} onRetry={() => file.refetch()} />;
  if (!file.data) return <Loading>Opening {nameOf(path)}…</Loading>;
  const { data } = file;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-caption text-ink-2">
        <FileText aria-hidden className="size-3.5" />
        <span className="font-mono">{data.path}</span>
        <span>
          {formatBytes(data.size)} · changed {relativeTime(data.modifiedAt)}
        </span>
      </p>
      {data.format === "html" ? (
        <p className="m-0 text-caption text-ink-2">
          Its scripts, forms and links are turned off here, and it loads nothing from the web.
        </p>
      ) : null}
      {data.truncated ? (
        <p className="m-0 text-caption text-needs">
          This file is large, so only its first {formatBytes(new Blob([data.text]).size)} are shown.
        </p>
      ) : null}
      <FileContent file={data} />
    </div>
  );
}

/** The viewer in a dialog, opened from the Files tab or from a page card in the chat. */
export function FileViewerDialog({
  agentId,
  path,
  onClose,
}: {
  agentId: string;
  /** The file to show. The dialog is open while it is set. */
  path: string | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={path !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={path ? nameOf(path) : "File"}
      description="From Steward's workspace. It may quote what Steward read on the web or in mail."
      size="lg"
    >
      {path ? <FileViewer agentId={agentId} path={path} /> : null}
    </Dialog>
  );
}
