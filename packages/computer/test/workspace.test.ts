import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ComputerError } from "../src/errors.ts";
import { decodeUtf8Head, formatBytes, LIST_LIMIT, Workspace, workspaceParts } from "../src/workspace.ts";

let base: string;
let outside: string;
let ws: Workspace;
let root: string;

async function refusal(fn: () => Promise<unknown>): Promise<ComputerError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ComputerError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeAll(async () => {
  // Under os.tmpdir(): on macOS that is a symlinked /var path, which the workspace must resolve.
  base = await mkdtemp(join(tmpdir(), "steward-ws-"));
  outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "top secret");
  ws = new Workspace(join(base, "workspace"));
  root = await ws.init();
  await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
  await symlink(outside, join(root, "escape-dir"));
  await symlink(join(root, "missing-target"), join(root, "dangling.txt"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("workspace paths", () => {
  it("refuses absolute paths and '..' before touching the disk", () => {
    expect(() => workspaceParts("/etc/passwd")).toThrow(/relative to your workspace/);
    expect(() => workspaceParts("C:\\Windows")).toThrow(/relative to your workspace/);
    expect(() => workspaceParts("~/x")).toThrow(/relative to your workspace/);
    expect(() => workspaceParts("../x")).toThrow(/'\.\.' is not allowed/);
    expect(() => workspaceParts("a/../../x")).toThrow(/'\.\.' is not allowed/);
    expect(() => workspaceParts("a\\..\\x")).toThrow(/'\.\.' is not allowed/);
    expect(() => workspaceParts("")).toThrow(/Give a path/);
    expect(workspaceParts("./notes//today.md")).toEqual(["notes", "today.md"]);
    expect(workspaceParts("", { allowRoot: true })).toEqual([]);
  });
});

describe("Workspace", () => {
  it("writes, reads and lists inside the workspace", async () => {
    const saved = await ws.write("reports/aug/summary.md", "# August\nAll good.\n");
    expect(saved).toMatchObject({ path: "reports/aug/summary.md", size: 19, isDirectory: false });
    expect(await readFile(join(root, "reports/aug/summary.md"), "utf8")).toBe("# August\nAll good.\n");
    const read = await ws.read("reports/aug/summary.md");
    expect(read).toMatchObject({ text: "# August\nAll good.\n", size: 19, truncated: false });

    const listed = await ws.list();
    const paths = listed.map((f) => f.path);
    expect(paths).toContain("reports");
    expect(paths).toContain("reports/aug/summary.md");
    // Links that lead outside are not listed at all.
    expect(paths).not.toContain("escape.txt");
    expect(paths).not.toContain("escape-dir");
    expect((await ws.list("reports")).map((f) => f.path)).toEqual(["reports/aug", "reports/aug/summary.md"]);
  });

  it("refuses to read or write through a symlink that leads outside", async () => {
    expect((await refusal(() => ws.read("escape.txt"))).message).toMatch(/outside your workspace/);
    expect((await refusal(() => ws.read("escape-dir/secret.txt"))).message).toMatch(/outside your workspace/);
    expect((await refusal(() => ws.write("escape.txt", "overwrite"))).message).toMatch(
      /outside your workspace/,
    );
    expect((await refusal(() => ws.write("escape-dir/new.txt", "x"))).message).toMatch(
      /outside your workspace/,
    );
    expect((await refusal(() => ws.write("escape-dir/deeper/new.txt", "x"))).message).toMatch(
      /outside your workspace/,
    );
    expect((await refusal(() => ws.list("escape-dir"))).message).toMatch(/outside your workspace/);
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("top secret");
  });

  it("refuses a dangling link and follows one that stays inside", async () => {
    expect((await refusal(() => ws.write("dangling.txt", "x"))).code).toBe("bad_path");
    await ws.write("real.txt", "inside");
    await symlink(join(root, "real.txt"), join(root, "alias.txt"));
    expect((await ws.read("alias.txt")).text).toBe("inside");
    await ws.write("alias.txt", "through the alias");
    expect(await readFile(join(root, "real.txt"), "utf8")).toBe("through the alias");
  });

  it("reports missing files, folders and binary files plainly", async () => {
    await mkdir(join(root, "reports"), { recursive: true });
    expect((await refusal(() => ws.read("nope.md"))).code).toBe("not_found");
    expect((await refusal(() => ws.read("reports"))).code).toBe("bad_input");
    await writeFile(join(root, "image.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    expect((await refusal(() => ws.read("image.bin"))).code).toBe("not_text");
    expect((await refusal(() => ws.write("reports", "x"))).code).toBe("bad_input");
  });

  it("caps reads without splitting a character", async () => {
    await ws.write("big.txt", "é".repeat(1000));
    const read = await ws.read("big.txt", 101);
    expect(read.truncated).toBe(true);
    expect(read.text).toBe("é".repeat(50));
    expect(read.size).toBe(2000);
  });

  it("refuses files over the write limit", async () => {
    expect((await refusal(() => ws.write("huge.txt", "x".repeat(5 * 1024 * 1024 + 1)))).code).toBe(
      "too_large",
    );
  });
});

describe("helpers", () => {
  it("refuses pipes and sockets at once instead of waiting on them", async () => {
    const pipe = join(root, "pipe");
    expect(spawnSync("mkfifo", [pipe]).status).toBe(0);
    const started = Date.now();
    const read = await refusal(() => ws.read("pipe"));
    expect(read).toMatchObject({
      code: "bad_input",
      message: "pipe is not a regular file, so the file tools cannot use it.",
    });
    const write = await refusal(() => ws.write("pipe", "x"));
    expect(write.message).toBe("pipe is not a regular file, so the file tools cannot use it.");
    expect(Date.now() - started).toBeLessThan(2_000);

    const server = createServer();
    await new Promise<void>((resolve) => server.listen(join(root, "sock"), resolve));
    try {
      expect((await refusal(() => ws.read("sock"))).message).toMatch(/not a regular file/);
      expect((await refusal(() => ws.write("sock", "x"))).message).toMatch(/not a regular file/);
      // Listings leave them out: nothing the file tools could open.
      const paths = (await ws.list()).map((f) => f.path);
      expect(paths).not.toContain("pipe");
      expect(paths).not.toContain("sock");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(pipe, { force: true });
    }
  });

  it("never writes through a hard link to a file outside", async () => {
    const target = join(outside, "linked.txt");
    await writeFile(target, "outside content");
    await link(target, join(root, "linked.txt"));
    const refused = await refusal(() => ws.write("linked.txt", "overwritten through the workspace"));
    expect(refused.message).toBe(
      "linked.txt is linked to another file, so Steward will not change it. Save it under a new name instead.",
    );
    expect(await readFile(target, "utf8")).toBe("outside content");
    // Replacing an ordinary file still works, and leaves no stale tail behind.
    await ws.write("plain.txt", "a longer first version");
    await ws.write("plain.txt", "short");
    expect(await readFile(join(root, "plain.txt"), "utf8")).toBe("short");
    expect((await stat(join(root, "plain.txt"))).nlink).toBe(1);
  });

  it("lists one level when asked, and says when the cap cut a listing short", async () => {
    await ws.write("tree/a/deep.txt", "x");
    await ws.write("tree/top.txt", "x");
    expect((await ws.list("tree", { recursive: false })).map((f) => f.path)).toEqual([
      "tree/a",
      "tree/top.txt",
    ]);
    expect((await ws.list("tree")).map((f) => f.path)).toEqual(["tree/a", "tree/a/deep.txt", "tree/top.txt"]);
    expect((await ws.listing("tree")).truncated).toBe(false);

    await mkdir(join(root, "many"));
    await Promise.all(
      Array.from({ length: LIST_LIMIT + 1 }, (_, i) => writeFile(join(root, "many", `f${i}.txt`), "")),
    );
    const many = await ws.listing("many");
    expect(many.files).toHaveLength(LIST_LIMIT);
    expect(many.truncated).toBe(true);
  });

  it("formats sizes for people", () => {
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(2150)).toBe("2.1 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("drops a half character at the end of a buffer", () => {
    const bytes = Buffer.from("a😀", "utf8");
    expect(decodeUtf8Head(bytes.subarray(0, 3))).toBe("a");
    expect(decodeUtf8Head(bytes)).toBe("a😀");
  });
});
