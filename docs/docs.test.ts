/**
 * Keeps the reference docs in step with the code, so drift fails a test instead of waiting for a
 * reader: every relative link and #anchor resolves, the tool table matches the catalogue, every
 * model provider is named where providers are listed, and the README's bot numbers are the
 * directory's.
 *
 * Imports the packages' entry points by path, because the repository root does not depend on the
 * workspace packages by name.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_PROVIDERS } from "../packages/agent/src/index.ts";
import { TOOLS } from "../packages/shared/src/index.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** The docs people read: the root files, docs/*.md and the tenants README. Plans and research are records, not references. */
const DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "tenants/README.md",
  ...readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];

/** The text outside fenced code blocks and inline code, where a link is a link. */
function prose(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/(`+)[^`]*?\1/g, (span) => " ".repeat(span.length));
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .replace(/`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every anchor a markdown file offers: its headings, numbered as GitHub numbers repeats. */
function anchors(markdown: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  const withoutFences = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
  for (const match of withoutFences.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(match[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const match of markdown.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) out.add(match[1]!);
  return out;
}

/** Relative link targets in a file's prose: `[text](target)` and `<img src="target">`. */
function links(markdown: string): string[] {
  const text = prose(markdown);
  const out: string[] = [];
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(match[1]!);
  for (const match of text.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) out.push(match[1]!);
  return out.filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

describe("the docs", () => {
  it.each(DOCS)("%s: every relative link and anchor goes somewhere", (file) => {
    const markdown = read(file);
    const broken: string[] = [];
    for (const target of links(markdown)) {
      const [path = "", anchor] = target.split("#");
      const resolved = path ? resolve(dirname(join(ROOT, file)), decodeURI(path)) : join(ROOT, file);
      if (!existsSync(resolved)) {
        broken.push(`${target} (no ${relative(ROOT, resolved)})`);
        continue;
      }
      if (anchor && resolved.endsWith(".md") && statSync(resolved).isFile()) {
        if (!anchors(readFileSync(resolved, "utf8")).has(anchor.toLowerCase())) {
          broken.push(`${target} (no heading for #${anchor})`);
        }
      }
    }
    expect(broken, `${file} links to`).toEqual([]);
  });

  it("list every built-in tool in tools.md with its kind, surface and taint", () => {
    const rows = new Map<string, string[]>();
    for (const line of read("docs/tools.md").split("\n")) {
      const cells = line.split("|").map((c) => c.trim());
      const name = /^`([a-z_]+)`$/.exec(cells[1] ?? "")?.[1];
      if (name) rows.set(name, cells.slice(2, 5));
    }
    const wrong: string[] = [];
    for (const [name, entry] of Object.entries(TOOLS)) {
      const row = rows.get(name);
      if (!row) {
        wrong.push(`${name}: no row`);
        continue;
      }
      const [kind, surface, taints] = row;
      const want = [entry.kind, entry.surface, entry.taints ? "yes" : "no"];
      if (kind !== want[0] || surface !== want[1] || taints !== want[2]) {
        wrong.push(`${name}: says ${row.join(", ")}, the catalogue says ${want.join(", ")}`);
      }
    }
    for (const name of rows.keys()) if (!(name in TOOLS)) wrong.push(`${name}: not in the catalogue`);
    expect(wrong).toEqual([]);
  });

  it.each(["README.md", "docs/models.md", "docs/make-it-your-own.md"])(
    "%s names every model provider",
    (file) => {
      const text = read(file);
      const missing = MODEL_PROVIDERS.filter((id) => !text.includes(`\`${id}\``));
      expect(missing, `${file} leaves out`).toEqual([]);
    },
  );

  it("give the README the directory's own bot numbers", () => {
    const index = JSON.parse(read("directory/index.json")) as {
      bots: { id: string; author?: { kind?: string } }[];
    };
    const count = (n: number) => n.toLocaleString("en-GB");
    const all = count(index.bots.length);
    const aiMade = count(index.bots.filter((b) => b.author?.kind === "ai").length);
    const lobe = count(index.bots.filter((b) => b.id.startsWith("lobe-")).length);
    const readme = read("README.md");
    expect(readme).toContain(`[![${all} bots](https://img.shields.io/badge/bots-${encodeURIComponent(all)}-`);
    expect(readme).toContain(
      `**${all} bots ship with Steward** in \`directory/\`: ${aiMade} made by a model`,
    );
    expect(readme).toContain(`${lobe} adapted from`);
    expect(readme).toContain(`A directory of ${all} bots`);
    expect(readme).toContain(`The ${all} bots that ship with Steward`);
    expect(readme).toContain(`${lobe} bots in the directory`);
    expect(readme).toContain(`More AI-made bots: ${aiMade} of the`);
  });
});
