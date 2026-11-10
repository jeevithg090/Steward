/**
 * Adapted from openbot/agent-computer/src/workspace.ts (MIT, CopilotKit).
 *
 * The agent's own folder. File tools take paths relative to it and can never leave it, in three
 * layers: no absolute paths, no `..`, and a `realpath` check of where the path really lands
 * (its parent, and the file itself when it exists), so a symlink cannot lead outside. Files are
 * then opened with O_NOFOLLOW at the checked real path, so a link swapped in afterwards fails
 * instead of being followed.
 *
 * Only regular files are read or written. A named pipe would block a read forever (and a few
 * of them would stall all of Node's file system work), so files are opened non-blocking and checked
 * after opening. A file with more than one hard link may be the same file as one outside the
 * workspace, so it is never changed.
 *
 * This guards the file tools only. The shell runs as the same user and is governed separately
 * (it asks before running by default).
 */
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { WorkspaceFile } from "@steward/shared";
import { ComputerError } from "./errors.ts";

export const DEFAULT_READ_BYTES = 256 * 1024;
export const MAX_READ_BYTES = 8 * 1024 * 1024;
export const MAX_WRITE_BYTES = 5 * 1024 * 1024;
export const LIST_LIMIT = 500;
/** Folders listed but not walked into: they are huge and rarely what anyone means. */
const NOT_WALKED = new Set(["node_modules", ".git", ".venv", "__pycache__"]);
const MAX_DEPTH = 12;

/** Splits a workspace-relative path into safe parts, or refuses it. */
export function workspaceParts(input: unknown, opts: { allowRoot?: boolean } = {}): string[] {
  if (typeof input !== "string")
    throw new ComputerError("bad_path", "Give a path inside your workspace, such as notes.md.");
  const text = input.trim();
  if (text === "" || text === "." || text === "./") {
    if (opts.allowRoot) return [];
    throw new ComputerError("bad_path", "Give a path inside your workspace, such as notes.md.");
  }
  if (text.includes("\0")) throw new ComputerError("bad_path", "That path has a null character in it.");
  if (
    isAbsolute(text) ||
    /^[\\/]/.test(text) ||
    /^[a-zA-Z]:/.test(text) ||
    text === "~" ||
    text.startsWith("~/")
  ) {
    throw new ComputerError("bad_path", "Use a path relative to your workspace, not an absolute one.");
  }
  const parts = text.split(/[\\/]+/).filter((p) => p !== "" && p !== ".");
  if (parts.includes("..")) {
    throw new ComputerError("bad_path", "Paths cannot leave the workspace, so '..' is not allowed.");
  }
  return parts;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function outside(): ComputerError {
  return new ComputerError("bad_path", "That path leads outside your workspace.");
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export class Workspace {
  private rootPath: string | undefined;

  constructor(private readonly dir: string) {}

  /** Creates the folder and resolves its real path (on macOS /var and /tmp are symlinks). */
  async init(): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    this.rootPath = await realpath(this.dir);
    return this.rootPath;
  }

  async root(): Promise<string> {
    return this.rootPath ?? (await this.init());
  }

  /**
   * What is under `dir` (the whole workspace by default), in name order with each folder followed
   * by what is in it, at most 500 entries. `recursive: false` lists one level only. Pipes, sockets
   * and devices are left out: the file tools cannot use them.
   */
  async list(dir?: string, opts: { recursive?: boolean } = {}): Promise<WorkspaceFile[]> {
    return (await this.listing(dir, opts)).files;
  }

  /** The same, with whether the 500-entry cap cut the listing short. */
  async listing(
    dir?: string,
    opts: { recursive?: boolean } = {},
  ): Promise<{ files: WorkspaceFile[]; truncated: boolean }> {
    const recursive = opts.recursive ?? true;
    const root = await this.root();
    const parts = workspaceParts(dir ?? "", { allowRoot: true });
    let base: string;
    try {
      base = await realpath(join(root, ...parts));
    } catch (error) {
      if (code(error) === "ENOENT")
        throw new ComputerError("not_found", `There is no folder at ${parts.join("/")}.`);
      throw error;
    }
    if (!isInside(root, base)) throw outside();
    const info = await stat(base);
    if (!info.isDirectory())
      throw new ComputerError("bad_input", `${parts.join("/")} is a file, not a folder.`);

    const out: WorkspaceFile[] = [];
    let truncated = false;
    const walk = async (realDir: string, shown: string, depth: number): Promise<void> => {
      const entries = await readdir(realDir, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (out.length >= LIST_LIMIT) {
          truncated = true;
          return;
        }
        const real = join(realDir, entry.name);
        const path = shown ? `${shown}/${entry.name}` : entry.name;
        let target = real;
        if (entry.isSymbolicLink()) {
          // Show links that stay inside, as what they point to; never walk into them.
          const resolved = await realpath(real).catch(() => undefined);
          if (!resolved || !isInside(root, resolved)) continue;
          target = resolved;
        }
        const st = await stat(target).catch(() => undefined);
        if (!st || !(st.isFile() || st.isDirectory())) continue;
        out.push({
          path,
          size: st.isDirectory() ? 0 : st.size,
          modifiedAt: st.mtime.toISOString(),
          isDirectory: st.isDirectory(),
        });
        if (
          recursive &&
          st.isDirectory() &&
          !entry.isSymbolicLink() &&
          !NOT_WALKED.has(entry.name) &&
          depth < MAX_DEPTH
        ) {
          await walk(real, path, depth + 1);
        }
      }
    };
    await walk(base, toPosix(parts.join("/")), 0);
    return { files: out, truncated };
  }

  /** Reads up to `maxBytes` of a text file. Refuses binary files rather than returning noise. */
  async read(
    path: string,
    maxBytes = DEFAULT_READ_BYTES,
  ): Promise<{ text: string; size: number; truncated: boolean; path: string }> {
    const root = await this.root();
    const parts = workspaceParts(path);
    const shown = parts.join("/");
    let real: string;
    try {
      real = await realpath(join(root, ...parts));
    } catch (error) {
      if (code(error) === "ENOENT") throw new ComputerError("not_found", `There is no file at ${shown}.`);
      throw error;
    }
    if (!isInside(root, real)) throw outside();
    const limit = Math.max(
      1,
      Math.min(MAX_READ_BYTES, Math.floor(Number.isFinite(maxBytes) ? maxBytes : DEFAULT_READ_BYTES)),
    );
    // Pipes, sockets and devices are refused before opening; non-blocking covers one swapped in after.
    const before = await stat(real).catch(() => undefined);
    if (before && !before.isFile() && !before.isDirectory()) throw notRegular(shown);
    const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    const handle = await open(real, flags).catch((error: unknown) => {
      if (code(error) === "ELOOP") throw outside();
      if (code(error) === "ENXIO" || code(error) === "EOPNOTSUPP") throw notRegular(shown);
      throw error;
    });
    try {
      const info = await handle.stat();
      if (info.isDirectory()) throw new ComputerError("bad_input", `${shown} is a folder. List it instead.`);
      if (!info.isFile()) throw notRegular(shown);
      const length = Math.min(info.size, limit);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.subarray(0, 8192).includes(0)) {
        throw new ComputerError("not_text", `${shown} is not a text file, so it cannot be read as text.`);
      }
      return { text: decodeUtf8Head(bytes), size: info.size, truncated: info.size > bytesRead, path: shown };
    } finally {
      await handle.close();
    }
  }

  /** Creates or replaces a text file, creating folders as needed. */
  async write(path: string, content: string): Promise<WorkspaceFile> {
    const root = await this.root();
    if (typeof content !== "string") throw new ComputerError("bad_input", "File content must be text.");
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_WRITE_BYTES) {
      throw new ComputerError(
        "too_large",
        `That is too large to save. The limit is ${MAX_WRITE_BYTES / 1024 / 1024} MB.`,
      );
    }
    const parts = workspaceParts(path);
    const name = parts[parts.length - 1] ?? "";
    const parent = await this.realParent(root, parts.slice(0, -1));
    let target = join(parent, name);

    const shown = parts.join("/");
    const existing = await lstat(target).catch(() => undefined);
    if (existing?.isSymbolicLink()) {
      // Writing follows links, so check where this one really lands. A dangling link is refused.
      const resolved = await realpath(target).catch(() => undefined);
      if (!resolved || !isInside(root, resolved)) throw outside();
      target = resolved;
    }
    const info = existing ? await stat(target) : undefined;
    if (info?.isDirectory()) throw new ComputerError("bad_input", `${shown} is a folder.`);
    if (info && !info.isFile()) throw notRegular(shown);

    const handle = await openForWrite(target, shown, existing !== undefined);
    let saved: Awaited<ReturnType<FileHandle["stat"]>>;
    try {
      await handle.truncate(0);
      await handle.writeFile(bytes);
      saved = await handle.stat();
    } finally {
      await handle.close();
    }
    return {
      path: shown,
      size: saved.size,
      modifiedAt: saved.mtime.toISOString(),
      isDirectory: false,
    };
  }

  /**
   * The real path of a folder inside the workspace, created if missing. The nearest existing
   * ancestor is resolved and checked first, so a symlinked folder cannot redirect the new ones.
   */
  async realParent(root: string, parts: readonly string[]): Promise<string> {
    let existing = parts.length;
    let real: string | undefined;
    while (existing >= 0) {
      real = await realpath(join(root, ...parts.slice(0, existing))).catch(() => undefined);
      if (real) break;
      existing--;
    }
    if (!real || !isInside(root, real)) throw outside();
    const rest = parts.slice(existing);
    if (rest.length === 0) {
      if (!(await stat(real)).isDirectory())
        throw new ComputerError("bad_path", `${parts.join("/")} is a file, not a folder.`);
      return real;
    }
    const created = join(real, ...rest);
    await mkdir(created, { recursive: true }).catch((error: unknown) => {
      if (code(error) === "EEXIST" || code(error) === "ENOTDIR") {
        throw new ComputerError("bad_path", `Part of ${parts.join("/")} is a file, not a folder.`);
      }
      throw error;
    });
    const final = await realpath(created);
    if (!isInside(root, final)) throw outside();
    return final;
  }
}

function notRegular(shown: string): ComputerError {
  return new ComputerError("bad_input", `${shown} is not a regular file, so the file tools cannot use it.`);
}

/**
 * Opens a file to replace its content, without truncating it yet: a new file is created exclusively,
 * and an existing one must be a regular file with a single link, checked on the open handle, so
 * neither a pipe nor a hard link to a file outside the workspace is written through.
 */
async function openForWrite(target: string, shown: string, exists: boolean): Promise<FileHandle> {
  const fail = (error: unknown): never => {
    if (code(error) === "ELOOP") throw outside();
    if (code(error) === "ENXIO" || code(error) === "EOPNOTSUPP") throw notRegular(shown);
    throw error;
  };
  const base = constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let handle: FileHandle | undefined;
  if (!exists) {
    handle = await open(target, base | constants.O_CREAT | constants.O_EXCL, 0o644).catch(
      (error: unknown) => {
        // Made by someone else since the check: treat it as existing.
        if (code(error) === "EEXIST") return undefined;
        return fail(error);
      },
    );
    if (handle) return handle;
  }
  handle = await open(target, base).catch(fail);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw notRegular(shown);
    if (info.nlink > 1) {
      throw new ComputerError(
        "bad_input",
        `${shown} is linked to another file, so Steward will not change it. Save it under a new name instead.`,
      );
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

/** Decodes UTF-8, dropping a multi-byte character cut in half at the end. */
export function decodeUtf8Head(bytes: Buffer): string {
  let end = bytes.length;
  // Walk back over continuation bytes to the last lead byte; drop it if its sequence is incomplete.
  let i = end - 1;
  while (i >= 0 && i > end - 4 && ((bytes[i] ?? 0) & 0xc0) === 0x80) i--;
  if (i >= 0) {
    const lead = bytes[i] ?? 0;
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    if (end - i < need) end = i;
  }
  return bytes.subarray(0, end).toString("utf8");
}

/** Decodes UTF-8 from a buffer that may start in the middle of a character (a kept tail). */
export function decodeUtf8Tail(bytes: Buffer): string {
  let start = 0;
  while (start < bytes.length && start < 3 && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} ${size === 1 ? "byte" : "bytes"}`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
