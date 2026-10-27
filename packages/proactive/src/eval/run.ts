/*
 * Measures Steward's triage against the labelled set in evals/triage/dataset.jsonl, with the same
 * code the server runs (src/triage.ts).
 *
 *   pnpm eval:triage                rules only, then the model when one is configured
 *   pnpm eval:triage --rules-only   rules only, no model calls
 *
 * The model comes from STEWARD_EVAL_BASE_URL + STEWARD_EVAL_MODEL (+ STEWARD_EVAL_API_KEY), or from
 * OPENROUTER_API_KEY (model STEWARD_EVAL_MODEL, default anthropic/claude-haiku-5.5). Prints a table
 * and writes evals/triage/results.md. Exits 1 if a rule ever disagrees with a label, so CI catches a
 * rule that starts hiding mail.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { triageEmails } from "../triage.ts";
import {
  EVAL_ABOUT,
  EVAL_NOW,
  EVAL_OWNER,
  pairResults,
  parseDataset,
  renderResults,
  type Section,
  score,
  summaryTable,
  toTriageEmail,
} from "./dataset.ts";
import { createOpenAICompatibleModel, evalModelConfig } from "./model.ts";

const EVAL_DIR = fileURLToPath(new URL("../../../../evals/triage/", import.meta.url));
const DATASET = `${EVAL_DIR}dataset.jsonl`;
const RESULTS = `${EVAL_DIR}results.md`;

const rulesOnly = process.argv.includes("--rules-only");
const set = parseDataset(await readFile(DATASET, "utf8"));
const emails = set.map(toTriageEmail);
const context = { now: EVAL_NOW, ownerEmail: EVAL_OWNER, about: EVAL_ABOUT };
const sections: Section[] = [];

const rulesRun = await triageEmails(emails, context);
const rulesRows = pairResults(set, rulesRun);
sections.push({ title: "Rules only, no model", model: "none", rows: rulesRows, metrics: score(rulesRows) });

const config = rulesOnly ? undefined : evalModelConfig(process.env);
let note: string | undefined;
if (config) {
  process.stdout.write(`Sorting ${set.length} messages with ${config.model} (from ${config.via})…\n`);
  const model = createOpenAICompatibleModel({
    baseUrl: config.baseUrl,
    model: config.model,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    headers: { "X-Title": "Steward triage eval" },
  });
  const run = await triageEmails(emails, { ...context, model, concurrency: 6 });
  const rows = pairResults(set, run);
  sections.push({
    title: "Rules, then the model",
    model: config.model,
    rows,
    metrics: score(rows),
    ...(run.failure ? { failure: run.failure } : {}),
  });
} else {
  note = rulesOnly
    ? "Rules only, as asked (`--rules-only`)."
    : "No model was configured, so only the rules ran. Set STEWARD_EVAL_BASE_URL, STEWARD_EVAL_MODEL and STEWARD_EVAL_API_KEY, or OPENROUTER_API_KEY, to measure a model.";
}

await writeFile(
  RESULTS,
  renderResults(sections, { ranAt: new Date(), datasetSize: set.length, ...(note ? { note } : {}) }),
);
process.stdout.write(`\n${summaryTable(sections)}\n\n`);
if (note) process.stdout.write(`${note}\n`);
process.stdout.write(`Wrote ${RESULTS}\n`);

const ruleWrong = sections.reduce((sum, s) => sum + s.metrics.ruleWrong, 0);
if (ruleWrong > 0) {
  process.stderr.write(
    `${ruleWrong} rule verdict(s) disagree with the labels. Rules must only settle what can wait.\n`,
  );
  process.exitCode = 1;
}
