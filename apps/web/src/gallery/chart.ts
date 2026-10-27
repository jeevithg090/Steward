/**
 * The data behind `show_chart`: reading what the model sent, scales, and the sentence a screen
 * reader hears in place of the picture.
 *
 * Accepted shapes, so a model that phrases it a little differently still gets a chart:
 * - one series: `points` / `data` as `[{ label, value }]`, or `labels` + `values`;
 * - several: `labels` + `series: [{ name, values }]`.
 * The kind is `type` / `kind` / `chart`: bar (or column), line (or area), pie (or donut).
 */

export type ChartKind = "bar" | "line" | "pie";

export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

export interface ChartData {
  kind: ChartKind;
  title: string;
  caption?: string;
  /** Put before or after numbers: "£", "%", "ms". */
  unit?: string;
  labels: string[];
  series: ChartSeries[];
}

/** Categorical colours come in a fixed order and never cycle; more series than this fold away. */
export const MAX_SERIES = 8;
export const MAX_LABELS = 60;
/** A pie with more slices than this folds the smallest into "Other". */
export const MAX_SLICES = 6;

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function label(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function kindOf(value: unknown): ChartKind {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text === "line" || text === "area") return "line";
  if (text === "pie" || text === "donut" || text === "doughnut") return "pie";
  return "bar";
}

/** Reads `show_chart` arguments. Undefined until there is at least one value to draw. */
export function readChart(args: Record<string, unknown> | undefined): ChartData | undefined {
  if (!args) return undefined;
  const kind = kindOf(args.type ?? args.kind ?? args.chart);
  const title = typeof args.title === "string" && args.title.trim() !== "" ? args.title : "Chart";
  const caption = typeof args.caption === "string" && args.caption.trim() !== "" ? args.caption : undefined;
  const unit = typeof args.unit === "string" && args.unit.trim() !== "" ? args.unit.trim() : undefined;

  let labels: string[] = [];
  let series: ChartSeries[] = [];

  const points = Array.isArray(args.points) ? args.points : Array.isArray(args.data) ? args.data : undefined;
  if (Array.isArray(args.series) && args.series.length > 0) {
    labels = Array.isArray(args.labels) ? args.labels.map(label) : [];
    series = args.series
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry, index) => ({
        name: label(entry.name ?? entry.label) || `Series ${index + 1}`,
        values: (Array.isArray(entry.values)
          ? entry.values
          : Array.isArray(entry.data)
            ? entry.data
            : []
        ).map(num),
      }));
    const longest = Math.max(0, ...series.map((entry) => entry.values.length));
    while (labels.length < longest) labels.push(String(labels.length + 1));
  } else if (points) {
    const rows = points.filter(
      (point): point is Record<string, unknown> => typeof point === "object" && point !== null,
    );
    labels = rows.map((point) => label(point.label ?? point.name ?? point.x));
    series = [
      { name: label(args.seriesName) || title, values: rows.map((point) => num(point.value ?? point.y)) },
    ];
  } else if (Array.isArray(args.labels) && Array.isArray(args.values)) {
    labels = args.labels.map(label);
    series = [{ name: label(args.seriesName) || title, values: args.values.map(num) }];
  }

  labels = labels.slice(0, MAX_LABELS);
  series = series.slice(0, MAX_SERIES).map((entry) => ({
    name: entry.name,
    values: labels.map((_, index) => entry.values[index] ?? null),
  }));
  if (labels.length === 0 || !series.some((entry) => entry.values.some((value) => value !== null)))
    return undefined;

  return { kind, title, ...(caption ? { caption } : {}), ...(unit ? { unit } : {}), labels, series };
}

/** Whether the data can be drawn as its kind. A pie needs one series of values that are not negative. */
export function drawable(chart: ChartData): boolean {
  if (chart.kind !== "pie") return true;
  const values = chart.series[0]?.values ?? [];
  return values.every((value) => value === null || value >= 0) && values.some((value) => (value ?? 0) > 0);
}

/** Pie slices: the largest first, the smallest folded into "Other" past `MAX_SLICES`. */
export function pieSlices(chart: ChartData): { label: string; value: number }[] {
  const values = chart.series[0]?.values ?? [];
  const slices = chart.labels
    .map((name, index) => ({ label: name, value: values[index] ?? 0 }))
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value);
  if (slices.length <= MAX_SLICES) return slices;
  const kept = slices.slice(0, MAX_SLICES - 1);
  const other = slices.slice(MAX_SLICES - 1).reduce((sum, slice) => sum + slice.value, 0);
  return [...kept, { label: "Other", value: other }];
}

/** Round axis ticks covering `min..max`, always including zero for bars. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    if (min === 0) return [0, 1];
    return min > 0 ? niceTicks(0, max, count) : niceTicks(min, 0, count);
  }
  const span = max - min;
  const rough = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ??
    10 * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

/** The extent of every value, widened to include zero (bars grow from a zero baseline). */
export function valueExtent(chart: ChartData, includeZero: boolean): [number, number] {
  const values = chart.series
    .flatMap((entry) => entry.values)
    .filter((value): value is number => value !== null);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  return [min, max];
}

/** A number as people write it, compact from ten thousand up, with the chart's unit. */
export function formatValue(value: number | null, unit?: string, compact = false): string {
  if (value === null) return "no value";
  const text =
    compact && Math.abs(value) >= 10_000
      ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  if (!unit) return text;
  return /^[£$€¥₹]$/.test(unit)
    ? `${value < 0 ? "-" : ""}${unit}${text.replace(/^-/, "")}`
    : `${text}${unit === "%" ? "" : " "}${unit}`;
}

const KIND_WORDS: Record<ChartKind, string> = { bar: "Bar chart", line: "Line chart", pie: "Pie chart" };

/**
 * One or two sentences that say what the chart shows: its kind and title, then the highest and
 * lowest values for one series, or the series names for several.
 */
export function describeChart(chart: ChartData): string {
  const head = `${KIND_WORDS[chart.kind]}: ${chart.title}.`;
  if (chart.series.length === 1) {
    const values = chart.series[0]!.values;
    let high = -1;
    let low = -1;
    values.forEach((value, index) => {
      if (value === null) return;
      if (high < 0 || value > (values[high] ?? 0)) high = index;
      if (low < 0 || value < (values[low] ?? 0)) low = index;
    });
    const count = values.filter((value) => value !== null).length;
    if (high < 0) return head;
    const highest = `highest ${chart.labels[high]} at ${formatValue(values[high] ?? null, chart.unit)}`;
    const lowest = `lowest ${chart.labels[low]} at ${formatValue(values[low] ?? null, chart.unit)}`;
    return `${head} ${count} ${count === 1 ? "value" : "values"}; ${count > 1 ? `${highest}, ${lowest}` : highest}.`;
  }
  return `${head} ${chart.series.length} series (${chart.series.map((entry) => entry.name).join(", ")}) across ${chart.labels.length} points.`;
}
