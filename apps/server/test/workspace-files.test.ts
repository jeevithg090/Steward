import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceFile, WorkspaceFileText } from "@steward/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileFormat, safeUploadName } from "../src/routes/workspace-files.ts";
import { missingPackages } from "./helpers.ts";
import { startTestServer, type TestServer } from "./server.ts";

describe("file names and formats", () => {
  it("keeps a plain name and its extension, and drops folders and odd characters", () => {
    expect(safeUploadName("notes.md")).toBe("notes.md");
    expect(safeUploadName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(safeUploadName("C:\\Users\\me\\Budget 2026.CSV")).toBe("Budget 2026.csv");
    expect(safeUploadName(".hidden.txt")).toBe("hidden.txt");
    expect(safeUploadName("a<b>|c.json")).toBe("a-b-c.json");
    expect(safeUploadName(".txt")).toBeUndefined();
  });

  it("refuses files that are not text", () => {
    expect(safeUploadName("photo.png")).toBeUndefined();
    expect(safeUploadName("run.sh")).toBeUndefined();
    expect(safeUploadName("noextension")).toBeUndefined();
  });

  it("shows each kind of file its own way", () => {
    expect(fileFormat("made/plan.md")).toBe("markdown");
    expect(fileFormat("made/page.HTML")).toBe("html");
    expect(fileFormat("data.csv")).toBe("csv");
    expect(fileFormat("data.json")).toBe("json");
    expect(fileFormat("notes.txt")).toBe("text");
  });
});

const missing = await missingPackages();

describe.runIf(missing.length === 0)("opening and adding workspace files over HTTP", () => {
  let t: TestServer;
  let workspace: string;
  let outside: string;

  beforeAll(async () => {
    t = await startTestServer();
    workspace = join(t.server.services.config.dataDir, "computers", "steward", "workspace");
    mkdirSync(join(workspace, "made"), { recursive: true });
    writeFileSync(join(workspace, "made", "plan.md"), "# Plan\n\nThree steps.");
    writeFileSync(
      join(workspace, "made", "page.html"),
      "<!doctype html><title>P</title><h1>Hi</h1><script>alert(1)</script>",
    );
    writeFileSync(join(workspace, "binary.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
    writeFileSync(join(workspace, "latin1.txt"), Buffer.from("caf\xe9 au lait", "latin1"));
    writeFileSync(join(workspace, "big.txt"), "x".repeat(1024 * 1024 + 10));
    outside = mkdtempSync(join(tmpdir(), "steward-outside-"));
    writeFileSync(join(outside, "secret.txt"), "not yours");
    symlinkSync(join(outside, "secret.txt"), join(workspace, "link.txt"));
    symlinkSync(outside, join(workspace, "away"));
  });

  afterAll(async () => {
    await t?.close();
    rmSync(outside, { recursive: true, force: true });
  });

  const open = (path: string, agent = "steward") =>
    t.api<WorkspaceFileText & { error?: string }>(
      `/api/computer/${agent}/file?path=${encodeURIComponent(path)}`,
    );

  it("opens a page Steward made as text, as JSON, never as a page", async () => {
    const res = await fetch(`${t.base}/api/computer/steward/file?path=made%2Fpage.html`);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await res.json()) as WorkspaceFileText;
    expect(body).toMatchObject({ path: "made/page.html", format: "html", truncated: false });
    expect(body.text).toContain("<h1>Hi</h1>");

    const md = await open("made/plan.md");
    expect(md.status).toBe(200);
    expect(md.body).toMatchObject({ format: "markdown", text: "# Plan\n\nThree steps." });
  });

  it("never reads outside the workspace, by path or by link", async () => {
    for (const path of ["../../steward.db", "/etc/hosts", "made/../../x", "link.txt", "away/secret.txt"]) {
      const res = await open(path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toContain("not yours");
    }
    expect((await open("../../steward.db")).status).toBe(400);
    expect((await open("link.txt")).status).toBe(400);
  });

  it("refuses binary and non-UTF-8 files, folders, missing files and unknown agents", async () => {
    expect((await open("binary.dat")).status).toBe(415);
    expect((await open("latin1.txt")).status).toBe(415);
    expect((await open("made")).status).toBe(400);
    expect((await open("made/gone.md")).status).toBe(404);
    expect((await open("")).status).toBe(400);
    expect((await open("made/plan.md", "nobody")).status).toBe(404);
  });

  it("sends only the first megabyte of a large file, and says so", async () => {
    const res = await open("big.txt");
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.size).toBe(1024 * 1024 + 10);
    expect(res.body.text.length).toBe(1024 * 1024);
  });

  it("adds a text file under uploads/, with a number when the name is taken", async () => {
    const add = (name: string, text: string) =>
      t.api<WorkspaceFile & { error?: string }>("/api/computer/steward/uploads", {
        method: "POST",
        json: { name, text },
      });
    const first = await add("../Notes.md", "# Mine");
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ path: "uploads/Notes.md", isDirectory: false, size: 6 });
    expect(readFileSync(join(workspace, "uploads", "Notes.md"), "utf8")).toBe("# Mine");

    const second = await add("Notes.md", "# Again");
    expect(second.body.path).toBe("uploads/Notes-2.md");
    expect(readFileSync(join(workspace, "uploads", "Notes.md"), "utf8")).toBe("# Mine");

    expect((await add("photo.png", "x")).status).toBe(415);
    expect((await add("nul.txt", "a\0b")).status).toBe(415);
    expect((await add("big.txt", "é".repeat(1024 * 1024 + 1))).status).toBe(413);
  });

  it("refuses an upload that is not JSON, and one from another site", async () => {
    const raw = await fetch(`${t.base}/api/computer/steward/uploads`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(raw.status).toBe(415);
    const cross = await fetch(`${t.base}/api/computer/steward/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ name: "a.txt", text: "x" }),
    });
    expect(cross.status).toBe(403);
  });

  it("does not start the browser to open or add a file", async () => {
    expect(t.server.services.computers.status("steward").running).toBe(false);
  });
});
