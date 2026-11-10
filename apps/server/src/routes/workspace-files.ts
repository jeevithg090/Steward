import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { isComputerError, Workspace } from "@steward/computer";
import {
  ROUTES,
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  UploadBody,
  type WorkspaceFile,
  type WorkspaceFileText,
} from "@steward/shared";
import type { Context, Hono } from "hono";
import type { StewardServices } from "../context.ts";
import { HttpError, notFound, readBody } from "../http/errors.ts";

/** The most of one file the person's viewer is sent. A longer file says it was cut. */
export const VIEW_MAX_BYTES = 1024 * 1024;

/** How the viewer shows a file, from its name. Anything it does not know is plain text. */
export function fileFormat(path: string): WorkspaceFileText["format"] {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "json") return "json";
  return "text";
}

/**
 * A safe file name from the one the person's computer gave: no folders, no leading dot, letters,
 * digits, spaces, dots, dashes and underscores only, at most 80 characters with the extension kept.
 */
export function safeUploadName(name: string): string | undefined {
  const base = (name.split(/[\\/]/).pop() ?? "").normalize("NFKC");
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) return undefined;
  const stem = base
    .slice(0, dot)
    .replace(/[^\p{L}\p{N} ._-]+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 80 - ext.length - 1)
    .trim();
  return `${stem || "file"}.${ext}`;
}

/** Where a file the person viewed or added could not be read, in words for the person. */
function asHttpError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (isComputerError(err)) {
    switch (err.code) {
      case "bad_path":
        throw new HttpError(400, "That file is outside Steward's workspace.");
      case "not_found":
        throw new HttpError(404, "That file isn't there any more.");
      case "not_text":
        throw new HttpError(415, "This file isn't plain text, so it can't be shown here.");
      case "bad_input":
        throw new HttpError(400, "That's a folder, not a file.");
      case "too_large":
        throw new HttpError(413, "That file is too large.");
      default:
        break;
    }
  }
  throw err;
}

/**
 * The person's own way into the agent's workspace: open a file Steward made, and add a text file
 * for Steward to read. Both go straight to disk through the computer's `Workspace`, so the same
 * containment applies (no absolute paths, no `..`, `realpath` checks, links never followed out),
 * and neither starts the browser.
 *
 * A file is only ever sent as JSON. Steward never serves workspace content as a page on its own
 * origin: a page it made can carry text from the web, and the web app shows it sandboxed.
 */
export function registerWorkspaceFileRoutes(app: Hono, s: StewardServices): void {
  const workspaceOf = (c: Context) => {
    const agentId = c.req.param("agentId");
    if (!agentId || !s.hasAgent(agentId)) throw notFound("that agent");
    return join(s.config.dataDir, "computers", agentId, "workspace");
  };

  app.get(ROUTES.computerFile, async (c) => {
    const dir = workspaceOf(c);
    const path = c.req.query("path") ?? "";
    if (!path || path.length > 1024) throw new HttpError(400, "Say which file to open.");
    if (!existsSync(dir)) throw new HttpError(404, "That file isn't there any more.");
    try {
      const workspace = new Workspace(dir);
      const file = await workspace.read(path, VIEW_MAX_BYTES);
      // Bytes that are not UTF-8 decode to U+FFFD; a file of them is not text to show.
      if (file.text.includes("\uFFFD"))
        throw new HttpError(415, "This file isn't plain text, so it can't be shown here.");
      const info = await stat(join(await workspace.root(), ...file.path.split("/")));
      const body: WorkspaceFileText = {
        path: file.path,
        size: file.size,
        modifiedAt: info.mtime.toISOString(),
        format: fileFormat(file.path),
        text: file.text,
        truncated: file.truncated,
      };
      c.header("Cache-Control", "no-store");
      return c.json(body);
    } catch (err) {
      asHttpError(err);
    }
  });

  app.post(ROUTES.computerUploads, async (c) => {
    const dir = workspaceOf(c);
    const body = await readBody(c, UploadBody);
    const name = safeUploadName(body.name);
    if (!name)
      throw new HttpError(
        415,
        "Steward can take text files: .txt, .md, .csv, .json, .ics, .html, .xml, .yaml or .log.",
      );
    if (Buffer.byteLength(body.text, "utf8") > UPLOAD_MAX_BYTES)
      throw new HttpError(413, "That file is larger than 2 MB.");
    if (body.text.includes("\0")) throw new HttpError(415, "That file isn't plain text.");
    try {
      const workspace = new Workspace(dir);
      const root = await workspace.root();
      const dot = name.lastIndexOf(".");
      let path = `uploads/${name}`;
      for (let n = 2; existsSync(join(root, ...path.split("/"))); n++) {
        if (n > 99) throw new HttpError(409, "There are too many files with that name. Rename it first.");
        path = `uploads/${name.slice(0, dot)}-${n}${name.slice(dot)}`;
      }
      const saved: WorkspaceFile = await workspace.write(path, body.text);
      return c.json(saved, 201);
    } catch (err) {
      asHttpError(err);
    }
  });
}
