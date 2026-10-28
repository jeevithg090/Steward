import { providerLabel } from "./labels.ts";

/**
 * The token usage a `run.finished` entry in the record carries: one entry per provider and model
 * the run spoke to, as the agent reported it (AG-UI `RUN_FINISHED.usage`), with the counts under
 * `input`, `output` and `total` (the record hides any key named like a token). Read defensively:
 * the detail is JSON the server wrote, and a count a provider did not report is absent, not zero.
 */
export interface RunUsageEntry {
  provider?: string;
  model?: string;
  input?: number;
  output?: number;
  total: number;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The usage entries in a record detail, or none. */
export function runUsage(detail: Record<string, unknown> | undefined): RunUsageEntry[] {
  const raw = detail?.usage;
  if (!Array.isArray(raw)) return [];
  const entries: RunUsageEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const input = count(r.input);
    const output = count(r.output);
    const total =
      count(r.total) ??
      (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined);
    if (total === undefined) continue;
    const provider = text(r.provider);
    const model = text(r.model);
    entries.push({
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      total,
    });
  }
  return entries;
}

const number = new Intl.NumberFormat("en-GB");

/** One entry in words: "1,234 tokens · xAI grok-4.7 (820 in, 414 out)". */
export function usageLine(entry: RunUsageEntry): string {
  const who = [entry.provider ? providerLabel(entry.provider) : undefined, entry.model]
    .filter(Boolean)
    .join(" ");
  const parts: string[] = [];
  if (entry.input !== undefined) parts.push(`${number.format(entry.input)} in`);
  if (entry.output !== undefined) parts.push(`${number.format(entry.output)} out`);
  const split = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${number.format(entry.total)} ${entry.total === 1 ? "token" : "tokens"}${who ? ` · ${who}` : ""}${split}`;
}

/** Every entry on one line, or an honest note that nothing was counted. */
export function usageSummary(detail: Record<string, unknown> | undefined): string {
  const entries = runUsage(detail);
  if (entries.length === 0) return "No token count was reported.";
  return entries.map(usageLine).join("; ");
}
