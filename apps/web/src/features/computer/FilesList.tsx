/**
 * The agent's workspace folder: what it saved and made. Folders open in place, with a path to walk
 * back up. A file named in the address (`/computer?file=report.md`) is highlighted, so a page card
 * in the chat can point straight at it.
 */
import type { WorkspaceFile } from "@steward/shared";
import { ChevronRight, FileText, Folder, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button.tsx";
import { useComputerFiles } from "@/lib/api.ts";
import { formatBytes, relativeTime } from "@/lib/utils.ts";

function parentOf(path: string): string | undefined {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return undefined;
  return parts.slice(0, -1).join("/");
}

function nameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function FilesList({ agentId, highlight }: { agentId: string; highlight?: string }) {
  const [dir, setDir] = useState<string | undefined>(() => (highlight ? parentOf(highlight) : undefined));
  const files = useComputerFiles(agentId, dir);
  const crumbs = dir ? dir.split("/").filter(Boolean) : [];

  const sorted: WorkspaceFile[] = [...(files.data ?? [])].sort((a, b) =>
    a.isDirectory === b.isDirectory ? nameOf(a.path).localeCompare(nameOf(b.path)) : a.isDirectory ? -1 : 1,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <nav aria-label="Folder" className="min-w-0">
          <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sub">
            <li>
              {crumbs.length === 0 ? (
                <span aria-current="location" className="font-medium text-ink">
                  Workspace
                </span>
              ) : (
                <Button variant="link" size="sm" onClick={() => setDir(undefined)}>
                  Workspace
                </Button>
              )}
            </li>
            {crumbs.map((crumb, index) => {
              const path = crumbs.slice(0, index + 1).join("/");
              const last = index === crumbs.length - 1;
              return (
                <li key={path} className="flex items-center gap-1">
                  <ChevronRight aria-hidden className="size-3.5 text-ink-3" />
                  {last ? (
                    <span aria-current="location" className="font-medium text-ink">
                      {crumb}
                    </span>
                  ) : (
                    <Button variant="link" size="sm" onClick={() => setDir(path)}>
                      {crumb}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh the file list"
          loading={files.isFetching}
          onClick={() => void files.refetch()}
        >
          <RotateCw aria-hidden />
        </Button>
      </div>

      {files.isError ? (
        <p role="alert" className="m-0 text-problem text-sub">
          Couldn't load the files. {files.error.message}
        </p>
      ) : files.isLoading ? (
        <p role="status" className="m-0 py-6 text-center text-ink-2 text-sub">
          Loading the files…
        </p>
      ) : sorted.length === 0 ? (
        <p className="m-0 py-6 text-center text-ink-2 text-sub">
          {dir ? "This folder is empty." : "Nothing saved yet. Files Steward makes show up here."}
        </p>
      ) : (
        <ul
          aria-label={dir ? `Files in ${dir}` : "Files in the workspace"}
          className="m-0 list-none divide-y divide-hair-2 p-0"
        >
          {sorted.map((file) => {
            const name = nameOf(file.path);
            const marked = highlight !== undefined && file.path === highlight;
            const meta = file.isDirectory
              ? relativeTime(file.modifiedAt)
              : `${formatBytes(file.size)} · ${relativeTime(file.modifiedAt)}`;
            return (
              <li key={file.path} aria-current={marked ? "true" : undefined}>
                {file.isDirectory ? (
                  <button
                    type="button"
                    onClick={() => setDir(file.path)}
                    className="flex min-h-target w-full items-center gap-3 rounded-tile px-1 text-left hover:bg-tile"
                  >
                    <Folder aria-hidden className="size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-ink text-sub">{name}</span>
                    <span className="shrink-0 text-caption text-ink-3">{meta}</span>
                  </button>
                ) : (
                  <div
                    className={
                      marked
                        ? "flex min-h-target items-center gap-3 rounded-tile bg-accent-soft px-1"
                        : "flex min-h-target items-center gap-3 px-1"
                    }
                  >
                    <FileText aria-hidden className="size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate font-mono text-ink text-sub">{name}</span>
                    <span className="shrink-0 text-caption text-ink-3">{meta}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
