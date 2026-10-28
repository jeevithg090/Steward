import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BOT_CATEGORIES, type BotCategory, type TextModel, TOOLS } from "@steward/shared";
import { stringify as stringifyYaml } from "yaml";
import { type ConfirmSame, type EmbeddingCache, type NearItem, nearDuplicates } from "./embed.ts";
import { type Job, JobSchema, parseJobs } from "./jobs.ts";
import { parseJsonObject } from "./json.ts";
import { isPackTool, plainWords } from "./prompt.ts";
import { overlap, tokens } from "./text.ts";

/**
 * Growing the taxonomy (plan §4.1). `jobs.yaml` is written and read by people; reaching the launch
 * target of 2,000 bots needs about a hundred jobs per category, so a model proposes more, a few
 * dozen at a time, and they go to `jobs-ai.yaml`, labelled as not yet read by a person. A proposed
 * job is dropped when it asks for the same thing as a job already listed, a bot on the shelf, or a
 * retired bot: by meaning when an embedder is configured, by word overlap otherwise.
 */

export const AI_JOBS_FILE = new URL("./jobs-ai.yaml", import.meta.url);

export const AI_JOBS_HEADER = `# More jobs, proposed by a model to reach the directory's launch target (plan §4.1), checked
# against jobs.yaml, the shelf and the retired list for near-duplicates. NOT YET READ BY A PERSON:
# move a job to jobs.yaml once someone has read it. Written by \`seed jobs\`; safe to edit.
`;

const TOOL_NAMES = Object.keys(TOOLS).filter(isPackTool);

export function buildJobsSystem(): string {
  return `You write the job list for a directory of ready-made assistant bots. Each job is one thing a person would ask a capable assistant to do for them, written the way they would say it: lower case, plain words, under 25 words, no brands, no company or product names, no personal names, no places that identify a real person. Answer only with JSON.`;
}

export function buildJobsPrompt(
  category: BotCategory,
  label: string,
  listed: readonly string[],
  count: number,
): string {
  const tools = TOOL_NAMES.map((t) => `- ${t}: ${plainWords(t)}`).join("\n");
  return `Category: ${category} (${label}).

Write ${count} new jobs for this category. Each must be a distinct, useful job that a real person has, specific enough that one bot could do it well, and different from every job already listed below (not the same job reworded, and not a narrower or wider copy of one).

Jobs already listed (${listed.length}):
${listed.map((j) => `- ${j}`).join("\n") || "- none yet"}

For each job, list the tools a bot would probably need, only from this catalogue:
${tools}

"connectors" is ["mail"], ["calendar"], both, or [] when the job needs neither.

Answer with exactly this JSON shape:
{"jobs": [{"job": "…", "tools": ["…"], "connectors": []}]}`;
}

export interface ProposeContext {
  model: TextModel;
  /** Embeddings for the meaning check; word overlap decides without it. */
  cache?: EmbeddingCache;
  confirm?: ConfirmSame;
  sure?: number;
  maybe?: number;
}

export interface Proposal {
  added: Job[];
  dropped: { job: string; reason: string }[];
}

/** Reads the model's answer into jobs: unknown tools are dropped from the hint, bad lines skipped. */
export function parseProposedJobs(text: string, category: BotCategory): { jobs: Job[]; skipped: string[] } {
  const raw = parseJsonObject(text);
  const list = Array.isArray(raw.jobs) ? raw.jobs : [];
  const jobs: Job[] = [];
  const skipped: string[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const job = typeof entry.job === "string" ? entry.job.trim().replace(/\s+/g, " ").replace(/\.$/, "") : "";
    const tools = Array.isArray(entry.tools)
      ? [...new Set(entry.tools.filter((t): t is string => typeof t === "string" && TOOL_NAMES.includes(t)))]
      : [];
    const connectors = Array.isArray(entry.connectors)
      ? [
          ...new Set(
            entry.connectors.filter((c): c is "mail" | "calendar" => c === "mail" || c === "calendar"),
          ),
        ]
      : [];
    const checked = JobSchema.safeParse({
      job: job.charAt(0).toLowerCase() + job.slice(1),
      tools,
      connectors,
    });
    if (!checked.success) {
      skipped.push(job || "(empty)");
      continue;
    }
    jobs.push({ category, ...checked.data });
  }
  return { jobs, skipped };
}

/**
 * Asks for `count` more jobs in one category and keeps the ones that are not near-duplicates of
 * `avoid` (listed jobs, shelf bots, retired bots) or of each other.
 */
export async function proposeJobs(
  category: BotCategory,
  count: number,
  listed: readonly Job[],
  avoid: readonly NearItem[],
  ctx: ProposeContext,
): Promise<Proposal> {
  const label = BOT_CATEGORIES[category];
  const inCategory = listed.filter((j) => j.category === category).map((j) => j.job);
  const answer = await ctx.model.complete({
    system: buildJobsSystem(),
    prompt: buildJobsPrompt(category, label, inCategory, count),
    maxTokens: Math.min(8000, 150 + count * 90),
  });
  const { jobs, skipped } = parseProposedJobs(answer, category);
  const dropped: Proposal["dropped"] = skipped.map((job) => ({ job, reason: "not a valid job line" }));
  const listedItems: NearItem[] = listed.map((j, i) => ({ id: `listed:${i}`, text: j.job }));
  const exact = new Set(listed.map((j) => j.job.toLowerCase()));
  const fresh = jobs.filter((j) => {
    if (!exact.has(j.job.toLowerCase())) return true;
    dropped.push({ job: j.job, reason: "already listed" });
    return false;
  });
  const items: NearItem[] = fresh.map((j, i) => ({ id: `new:${i}`, text: j.job }));
  let keptIds: Set<string>;
  if (ctx.cache) {
    try {
      const result = await nearDuplicates(items, [...listedItems, ...avoid], {
        cache: ctx.cache,
        // One question per job, about its closest look-alike: jobs are short, so that is enough.
        maxChecks: 1,
        ...(ctx.confirm ? { confirm: ctx.confirm } : {}),
        ...(ctx.sure !== undefined ? { sure: ctx.sure } : {}),
        ...(ctx.maybe !== undefined ? { maybe: ctx.maybe } : {}),
      });
      keptIds = new Set(result.kept.map((k) => k.id));
      for (const d of result.dropped) {
        const job = fresh[Number(d.id.slice(4))]?.job ?? d.id;
        dropped.push({
          job,
          reason: `like ${describeItem(d.duplicateOf, listed, avoid)} (${d.similarity}, ${d.how})`,
        });
      }
    } catch {
      // The embedder failed: the word-overlap check decides for this round.
      keptIds = wordsKept(items, [...listedItems, ...avoid], dropped, fresh);
    }
  } else {
    keptIds = wordsKept(items, [...listedItems, ...avoid], dropped, fresh);
  }
  return { added: fresh.filter((_, i) => keptIds.has(`new:${i}`)), dropped };
}

function describeItem(id: string, listed: readonly Job[], avoid: readonly NearItem[]): string {
  if (id.startsWith("listed:")) return `"${listed[Number(id.slice(7))]?.job ?? id}"`;
  if (id.startsWith("new:")) return "another new job";
  return avoid.find((a) => a.id === id)?.id ?? id;
}

/** The fallback: more than 0.8 of the words in common with an earlier job or bot. */
function wordsKept(
  items: NearItem[],
  existing: NearItem[],
  dropped: Proposal["dropped"],
  fresh: Job[],
): Set<string> {
  const seen = existing.map((e) => ({ id: e.id, tokens: tokens(e.text) }));
  const kept = new Set<string>();
  for (const item of items) {
    const mine = tokens(item.text);
    const twin = seen.find((s) => Math.min(s.tokens.size, mine.size) >= 3 && overlap(s.tokens, mine) > 0.8);
    if (twin) {
      dropped.push({
        job: fresh[Number(item.id.slice(4))]?.job ?? item.id,
        reason: `like ${twin.id} (words)`,
      });
      continue;
    }
    seen.push({ id: item.id, tokens: mine });
    kept.add(item.id);
  }
  return kept;
}

export async function readAiJobs(file: URL | string = AI_JOBS_FILE): Promise<Job[]> {
  if (!existsSync(file)) return [];
  return parseJobs(await readFile(file, "utf8"));
}

/** Writes every AI-proposed job, grouped by category in the taxonomy's order, under the header. */
export async function writeAiJobs(jobs: readonly Job[], file: URL | string = AI_JOBS_FILE): Promise<void> {
  const scalar = (text: string) => stringifyYaml(text, { lineWidth: 0 }).trim();
  const lines: string[] = [];
  for (const category of Object.keys(BOT_CATEGORIES)) {
    const list = jobs.filter((j) => j.category === category);
    if (list.length === 0) continue;
    lines.push("", `${category}:`);
    for (const j of list) {
      lines.push(`  - job: ${scalar(j.job)}`);
      if (j.tools.length) lines.push(`    tools: [${j.tools.join(", ")}]`);
      if (j.connectors.length) lines.push(`    connectors: [${j.connectors.join(", ")}]`);
    }
  }
  // Written beside and renamed over, so a run reading the taxonomy never sees half a file.
  const path = file instanceof URL ? fileURLToPath(file) : file;
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${AI_JOBS_HEADER}${lines.length ? lines.join("\n") : "\n{}"}\n`, "utf8");
  await rename(temp, path);
}
