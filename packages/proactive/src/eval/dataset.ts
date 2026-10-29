import type { TriageItem, TriageVerdict } from "@steward/shared";
import { z } from "zod";
import type { TriageEmail, TriageRun } from "../triage.ts";

/**
 * The labelled triage set (`evals/triage/dataset.jsonl`) and how a run is scored. Kept apart from
 * the runner so the scoring is tested without a model or a network.
 */

/** The morning the set was written for: Thursday 22 October 2026, 07:30 in the studio's zone. */
export const EVAL_NOW = new Date("2026-10-22T07:30:00-07:00");
/** The inbox owner. Never a name: Steward does not use one the person did not give. */
export const EVAL_OWNER = "owner@marlowceramics.com";
export const EVAL_ABOUT =
  "I run Marlow Ceramics, a small studio that makes mugs and tableware for shops such as Hearth & Co.";

const address = z.object({ name: z.string().optional(), email: z.string().min(3) });

const rowSchema = z.object({
  id: z.string().regex(/^[nc]\d{2}$/),
  label: z.enum(["needs_you", "can_wait"]),
  why: z.string().min(1),
  from: address,
  to: z.array(address).min(1),
  cc: z.array(address),
  subject: z.string(),
  receivedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "receivedAt must be a date"),
  headers: z.record(z.string(), z.string()),
  labels: z.array(z.string()),
  body: z.string().min(1),
});

export type LabelledEmail = z.infer<typeof rowSchema>;

/** Reads the JSONL, refusing the whole set on the first bad row (with its line number). */
export function parseDataset(text: string): LabelledEmail[] {
  const rows: LabelledEmail[] = [];
  const ids = new Set<string>();
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    const parsed = rowSchema.safeParse(JSON.parse(line));
    if (!parsed.success)
      throw new Error(`dataset.jsonl line ${index + 1}: ${parsed.error.issues[0]?.message}`);
    if (ids.has(parsed.data.id))
      throw new Error(`dataset.jsonl line ${index + 1}: duplicate id ${parsed.data.id}`);
    ids.add(parsed.data.id);
    rows.push(parsed.data);
  });
  return rows;
}

export function toTriageEmail(row: LabelledEmail): TriageEmail {
  return {
    id: row.id,
    threadId: row.id,
    from: row.from,
    to: row.to,
    cc: row.cc,
    subject: row.subject,
    snippet: row.body.slice(0, 140),
    body: row.body,
    receivedAt: row.receivedAt,
    unread: true,
    labels: row.labels,
    headers: row.headers,
  };
}

export interface Metrics {
  total: number;
  labelledNeedsYou: number;
  labelledCanWait: number;
  /** Flagged needs you and labelled needs you. Unsorted mail counts as flagged: that is what the person sees. */
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  /** Share of flagged mail that really needed the person. */
  precision: number;
  /** Share of mail that needed the person that was flagged. */
  recall: number;
  /** F-beta with beta 2: recall weighs four times as much as precision. */
  f2: number;
  accuracy: number;
  byRules: number;
  /** Rule verdicts that disagree with the label. Must be zero: rules only ever say "can wait". */
  ruleWrong: number;
  byModel: number;
  unsorted: number;
}

export interface Scored {
  item: LabelledEmail;
  result: TriageItem;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function score(rows: readonly Scored[]): Metrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let byRules = 0;
  let ruleWrong = 0;
  let byModel = 0;
  let unsorted = 0;
  for (const { item, result } of rows) {
    const flagged = result.verdict === "needs_you";
    const needed = item.label === "needs_you";
    if (flagged && needed) tp++;
    else if (flagged) fp++;
    else if (needed) fn++;
    else tn++;
    if (result.by === "model") byModel++;
    else if (result.confidence === 0) unsorted++;
    else {
      byRules++;
      if (result.verdict !== item.label) ruleWrong++;
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f2 = precision + recall === 0 ? 0 : (5 * precision * recall) / (4 * precision + recall);
  return {
    total: rows.length,
    labelledNeedsYou: rows.filter((row) => row.item.label === "needs_you").length,
    labelledCanWait: rows.filter((row) => row.item.label === "can_wait").length,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    precision,
    recall,
    f2,
    accuracy: ratio(tp + tn, rows.length),
    byRules,
    ruleWrong,
    byModel,
    unsorted,
  };
}

export function pairResults(set: readonly LabelledEmail[], run: TriageRun): Scored[] {
  return set.map((item, index) => ({ item, result: run.items[index]! }));
}

export interface Section {
  title: string;
  /** The model's label, or "none". */
  model: string;
  rows: Scored[];
  metrics: Metrics;
  /** Why the model could not sort some messages, when it could not. */
  failure?: string;
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/**
 * A Markdown table with every column padded to one width, the way the repo's formatter writes it,
 * so a freshly written results file passes `biome check` unchanged.
 */
export function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const clean = (cells: readonly string[]) => cells.map(cell);
  const head = clean(header);
  const body = rows.map(clean);
  const widths = head.map((h, i) => Math.max(3, h.length, ...body.map((row) => (row[i] ?? "").length)));
  const line = (cells: readonly string[]) =>
    `| ${widths.map((w, i) => (cells[i] ?? "").padEnd(w)).join(" | ")} |`;
  return [line(head), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...body.map(line)];
}

function verdictWord(verdict: TriageVerdict): string {
  return verdict === "needs_you" ? "needs you" : "can wait";
}

/** The terminal table: one line per mode. */
export function summaryTable(sections: readonly Section[]): string {
  const header = [
    "Mode",
    "Precision",
    "Recall",
    "F2",
    "Accuracy",
    "By rules (wrong)",
    "By model",
    "Unsorted",
  ];
  const lines = sections.map((s) => [
    s.title,
    percent(s.metrics.precision),
    percent(s.metrics.recall),
    percent(s.metrics.f2),
    percent(s.metrics.accuracy),
    `${s.metrics.byRules} (${s.metrics.ruleWrong})`,
    String(s.metrics.byModel),
    String(s.metrics.unsorted),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((line) => line[i]!.length)));
  const format = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [format(header), widths.map((w) => "-".repeat(w)).join("  "), ...lines.map(format)].join("\n");
}

/** The results file: the measures for each mode, every disagreement, then every verdict. */
export function renderResults(
  sections: readonly Section[],
  meta: { ranAt: Date; datasetSize: number; note?: string },
): string {
  const first = sections[0];
  const out: string[] = [
    "# Triage eval results",
    "",
    `Run ${meta.ranAt.toISOString()} on ${meta.datasetSize} labelled messages` +
      (first
        ? ` (${first.metrics.labelledNeedsYou} need you, ${first.metrics.labelledCanWait} can wait).`
        : "."),
    "Written by `pnpm eval:triage`; see `README.md` beside this file for what the numbers mean.",
    "",
  ];
  if (meta.note) out.push(meta.note, "");
  out.push(
    ...markdownTable(
      [
        "Mode",
        "Model",
        "Precision (needs you)",
        "Recall (needs you)",
        "F2",
        "Accuracy",
        "Decided by rules (wrong)",
        "By model",
        "Unsorted",
      ],
      sections.map((s) => [
        s.title,
        s.model,
        `${percent(s.metrics.precision)} (${s.metrics.truePositive} of ${s.metrics.truePositive + s.metrics.falsePositive})`,
        `${percent(s.metrics.recall)} (${s.metrics.truePositive} of ${s.metrics.truePositive + s.metrics.falseNegative})`,
        percent(s.metrics.f2),
        percent(s.metrics.accuracy),
        `${s.metrics.byRules} (${s.metrics.ruleWrong})`,
        String(s.metrics.byModel),
        String(s.metrics.unsorted),
      ]),
    ),
    "",
  );
  for (const s of sections) {
    out.push(`## ${s.title}`, "");
    if (s.failure)
      out.push(
        `Some messages could not be sorted: ${s.failure}. They count as "needs you", as on screen.`,
        "",
      );
    const wrong = s.rows.filter((row) => row.result.verdict !== row.item.label);
    out.push("### Disagreements", "");
    if (wrong.length === 0) out.push("None.", "");
    else {
      for (const row of wrong) {
        out.push(
          `- **${row.item.id}** “${cell(row.item.subject)}”: labelled ${verdictWord(row.item.label)}, got ${verdictWord(row.result.verdict)} ${row.result.confidence === 0 ? "as unsorted" : `by ${row.result.by}`}. Its reason: “${cell(row.result.reason)}” The label's reason: “${cell(row.item.why)}”`,
        );
      }
      out.push("");
    }
    out.push(
      "### Every verdict",
      "",
      ...markdownTable(
        ["id", "label", "verdict", "by", "reason"],
        s.rows.map((row) => [
          row.item.id,
          verdictWord(row.item.label),
          verdictWord(row.result.verdict),
          row.result.confidence === 0 ? "unsorted" : row.result.by,
          row.result.reason,
        ]),
      ),
      "",
    );
  }
  return out.join("\n");
}
