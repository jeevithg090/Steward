/**
 * `show_chart`: bar, line and pie charts drawn as plain SVG, with no chart library.
 *
 * Accessibility comes first. The picture is an image with a sentence that says what it shows; the
 * numbers are always one press away as a real table; the chart takes focus and the arrow keys walk
 * through it with the same readout a pointer gets; identity is never colour alone (legends, and the
 * table). Marks follow the house specs: thin bars with a rounded data end, 2px lines, end dots with
 * a surface ring, hairline grid.
 */
import { type KeyboardEvent, type PointerEvent, useId, useLayoutEffect, useRef, useState } from "react";
import "./chart.css";
import { cn } from "@/lib/utils.ts";
import {
  type ChartData,
  describeChart,
  drawable,
  formatValue,
  niceTicks,
  pieSlices,
  readChart,
  valueExtent,
} from "./chart.ts";
import { CardFrame, Quiet } from "./kit.tsx";

const colour = (index: number) => `var(--chart-${(index % 8) + 1})`;

export function Chart(props: { args?: Record<string, unknown> }) {
  const chart = readChart(props.args);
  if (!chart) {
    return (
      <CardFrame title={typeof props.args?.title === "string" ? props.args.title : "Chart"}>
        <Quiet>Drawing the chart…</Quiet>
      </CardFrame>
    );
  }
  const canDraw = drawable(chart);
  return (
    <CardFrame title={chart.title} caption={chart.caption}>
      {canDraw ? (
        <ChartFigure chart={chart} />
      ) : (
        <Quiet>This data can't be drawn as a pie chart, so here are the numbers.</Quiet>
      )}
      <details className="mt-3" open={!canDraw || undefined}>
        <summary className="inline-flex min-h-target cursor-pointer items-center text-sub font-medium text-accent">
          Show the numbers
        </summary>
        <ChartTable chart={chart} />
      </details>
    </CardFrame>
  );
}

/** The chart as a table: one row per label, one column per series. Always complete. */
export function ChartTable({ chart }: { chart: ChartData }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sub">
        <caption className="sr-only">{chart.title}, as a table</caption>
        <thead className="text-caption text-ink-2">
          <tr>
            <th scope="col" className="border-b border-hair py-2 pr-4 font-medium">
              {chart.kind === "pie" ? "Part" : "Label"}
            </th>
            {chart.series.map((series) => (
              <th
                key={series.name}
                scope="col"
                className="border-b border-hair py-2 pr-4 text-right font-medium"
              >
                {series.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.labels.map((label, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; position is the identity.
            <tr key={row} className="border-b border-hair-2 last:border-b-0">
              <th scope="row" className="py-2 pr-4 font-normal">
                {label || "—"}
              </th>
              {chart.series.map((series) => (
                <td key={series.name} className="py-2 pr-4 text-right tabular-nums">
                  {formatValue(series.values[row] ?? null, chart.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tracks an element's width, so the SVG is drawn at its real size and its text never shrinks. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Readout {
  title: string;
  rows: { name: string; value: string; colour: string }[];
}

function ChartFigure({ chart }: { chart: ChartData }) {
  const [ref, width] = useWidth(520);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const descId = useId();
  const slices = chart.kind === "pie" ? pieSlices(chart) : [];
  const count = chart.kind === "pie" ? slices.length : chart.labels.length;
  const summary = describeChart(chart);

  const readout = (index: number): Readout => {
    if (chart.kind === "pie") {
      const total = slices.reduce((sum, slice) => sum + slice.value, 0);
      const slice = slices[index]!;
      return {
        title: slice.label,
        rows: [
          {
            name: `${Math.round((slice.value / total) * 100)}% of the whole`,
            value: formatValue(slice.value, chart.unit),
            colour: colour(index),
          },
        ],
      };
    }
    return {
      title: chart.labels[index] ?? "",
      rows: chart.series.map((series, s) => ({
        name: series.name,
        value: formatValue(series.values[index] ?? null, chart.unit),
        colour: colour(s),
      })),
    };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(count - 1);
    else if (event.key === "Escape") setActive(null);
    else if (step !== 0)
      setActive((current) =>
        current === null ? (step > 0 ? 0 : count - 1) : (current + step + count) % count,
      );
    else return;
    event.preventDefault();
  };

  const current = active !== null && active < count ? readout(active) : null;

  return (
    <div className="st-chart relative" data-active={active !== null ? "" : undefined}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer and keyboard exploration of a chart whose numbers are also a table. */}
      <div
        ref={ref}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys walk the chart's values; this is its one tab stop.
        tabIndex={0}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="rounded-tile"
      >
        <svg
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          width={width}
          height={chart.kind === "pie" ? pieHeight(width) : chart.kind === "bar" ? barHeight(chart) : 240}
          className="block max-w-full overflow-visible"
        >
          <title id={titleId}>{chart.title}</title>
          <desc id={descId}>
            {summary} Use the arrow keys to hear each value, or show the numbers as a table.
          </desc>
          {chart.kind === "bar" ? (
            <Bars chart={chart} width={width} active={active} onActive={setActive} />
          ) : null}
          {chart.kind === "line" ? (
            <Lines chart={chart} width={width} active={active} onActive={setActive} />
          ) : null}
          {chart.kind === "pie" ? (
            <Pie slices={slices} width={width} active={active} onActive={setActive} />
          ) : null}
        </svg>
      </div>
      <p aria-live="polite" className="sr-only">
        {current
          ? `${current.title}: ${current.rows.map((row) => `${row.name} ${row.value}`).join(", ")}`
          : ""}
      </p>
      {current ? (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1 right-1 min-w-36 rounded-tile border border-hair bg-card px-3 py-2 shadow-float"
        >
          <p className="m-0 text-caption text-ink-2">{current.title}</p>
          {current.rows.map((row) => (
            <p key={row.name} className="m-0 flex items-center gap-2 text-sub">
              <span
                className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: row.colour }}
              />
              <strong className="font-semibold text-ink tabular-nums">{row.value}</strong>
              <span className="truncate text-caption text-ink-3">{row.name}</span>
            </p>
          ))}
        </div>
      ) : null}
      <Legend chart={chart} slices={slices} />
    </div>
  );
}

function Legend({ chart, slices }: { chart: ChartData; slices: { label: string; value: number }[] }) {
  if (chart.kind === "pie") {
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    return (
      <ul aria-label="Legend" className="m-0 mt-3 grid list-none gap-1 p-0 text-sub sm:grid-cols-2">
        {slices.map((slice, index) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: colour(index) }}
            />
            <span className="truncate text-ink">{slice.label}</span>
            <span className="ml-auto text-ink-2 tabular-nums">
              {formatValue(slice.value, chart.unit)} · {Math.round((slice.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (chart.series.length < 2) return null;
  return (
    <ul
      aria-label="Legend"
      className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-2"
    >
      {chart.series.map((series, index) => (
        <li key={series.name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "inline-block shrink-0",
              chart.kind === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-sm",
            )}
            style={{ background: colour(index) }}
          />
          {series.name}
        </li>
      ))}
    </ul>
  );
}

// ── Bars ────────────────────────────────────────────────────────────────────────────────────────

const BAR_TOP = 4;
const BAR_AXIS = 24;
const GROUP_GAP = 12;

function barThickness(series: number): number {
  return series === 1 ? 20 : Math.max(8, Math.min(14, Math.floor(40 / series)));
}

function groupHeight(series: number): number {
  return series * barThickness(series) + (series - 1) * 2;
}

function barHeight(chart: ChartData): number {
  const n = chart.series.length;
  return BAR_TOP + chart.labels.length * (groupHeight(n) + GROUP_GAP) - GROUP_GAP + BAR_AXIS;
}

/** A bar whose data end is rounded and whose baseline end is square. */
function barPath(from: number, to: number, y: number, height: number): string {
  const left = Math.min(from, to);
  const right = Math.max(from, to);
  const length = right - left;
  const r = Math.min(4, length / 2, height / 2);
  if (length <= 0) return "";
  if (to >= from) {
    return `M${left},${y}H${right - r}Q${right},${y} ${right},${y + r}V${y + height - r}Q${right},${y + height} ${right - r},${y + height}H${left}Z`;
  }
  return `M${right},${y}H${left + r}Q${left},${y} ${left},${y + r}V${y + height - r}Q${left},${y + height} ${left + r},${y + height}H${right}Z`;
}

interface PlotProps {
  chart: ChartData;
  width: number;
  active: number | null;
  onActive: (index: number | null) => void;
}

function Bars({ chart, width, active, onActive }: PlotProps) {
  const n = chart.series.length;
  const longest = Math.max(...chart.labels.map((label) => label.length));
  const labelWidth = Math.min(Math.max(longest * 7 + 12, 56), Math.round(width * 0.36));
  const valueRoom = n === 1 ? 64 : 12;
  const x0 = labelWidth;
  const x1 = Math.max(x0 + 40, width - valueRoom);
  const [min, max] = valueExtent(chart, true);
  const ticks = niceTicks(min, max, width < 360 ? 3 : 4);
  const t0 = ticks[0] ?? 0;
  const tN = ticks[ticks.length - 1] ?? 1;
  const x = (value: number) => x0 + ((value - t0) / (tN - t0 || 1)) * (x1 - x0);
  const thickness = barThickness(n);
  const group = groupHeight(n);
  const bottom = barHeight(chart) - BAR_AXIS;

  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={x(tick)}
            x2={x(tick)}
            y1={BAR_TOP}
            y2={bottom}
            stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
          />
          <text x={x(tick)} y={bottom + 16} textAnchor="middle" className="fill-ink-3 text-[0.75rem]">
            {formatValue(tick, chart.unit, true)}
          </text>
        </g>
      ))}
      {chart.labels.map((label, index) => {
        const top = BAR_TOP + index * (group + GROUP_GAP);
        const on = active === index;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; position is the identity.
          <g key={index} onPointerEnter={() => onActive(index)}>
            <rect x={0} y={top - GROUP_GAP / 2} width={width} height={group + GROUP_GAP} fill="transparent" />
            <text
              x={x0 - 8}
              y={top + group / 2}
              dominantBaseline="middle"
              textAnchor="end"
              className="fill-ink-2 text-[0.8125rem]"
            >
              {clip(label, Math.floor((labelWidth - 12) / 7))}
            </text>
            {chart.series.map((series, s) => {
              const value = series.values[index];
              if (value === null || value === undefined) return null;
              const y = top + s * (thickness + 2);
              return (
                <path
                  key={series.name}
                  d={barPath(x(0), x(value), y, thickness)}
                  fill={colour(s)}
                  data-mark=""
                  data-active-mark={on ? "" : undefined}
                />
              );
            })}
            {n === 1 && series0(chart, index) !== null ? (
              <text
                x={x(series0(chart, index) ?? 0) + ((series0(chart, index) ?? 0) < 0 ? -6 : 6)}
                y={top + group / 2}
                dominantBaseline="middle"
                textAnchor={(series0(chart, index) ?? 0) < 0 ? "end" : "start"}
                className="fill-ink-2 text-[0.8125rem] tabular-nums"
              >
                {formatValue(series0(chart, index), chart.unit, true)}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function series0(chart: ChartData, index: number): number | null {
  return chart.series[0]?.values[index] ?? null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

// ── Lines ───────────────────────────────────────────────────────────────────────────────────────

function Lines({ chart, width, active, onActive }: PlotProps) {
  const height = 240;
  const top = 12;
  const bottom = height - 28;
  const [min, max] = valueExtent(chart, false);
  const ticks = niceTicks(min, max, 4);
  const t0 = ticks[0] ?? 0;
  const tN = ticks[ticks.length - 1] ?? 1;
  const tickWidth = Math.max(...ticks.map((tick) => formatValue(tick, chart.unit, true).length)) * 7 + 8;
  const x0 = tickWidth;
  const x1 = width - 12;
  const count = chart.labels.length;
  const x = (index: number) => (count === 1 ? (x0 + x1) / 2 : x0 + (index / (count - 1)) * (x1 - x0));
  const y = (value: number) => bottom - ((value - t0) / (tN - t0 || 1)) * (bottom - top);
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor((x1 - x0) / 72))));

  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    onActive(Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1)))));
  };

  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={x0} x2={x1} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" />
          <text
            x={x0 - 8}
            y={y(tick)}
            dominantBaseline="middle"
            textAnchor="end"
            className="fill-ink-3 text-[0.75rem]"
          >
            {formatValue(tick, chart.unit, true)}
          </text>
        </g>
      ))}
      <line x1={x0} x2={x1} y1={bottom} y2={bottom} stroke="var(--chart-axis)" />
      {chart.labels.map((label, index) =>
        index % every === 0 || index === count - 1 ? (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; position is the identity.
            key={index}
            x={x(index)}
            y={bottom + 18}
            textAnchor={
              index === 0 && count > 1 ? "start" : index === count - 1 && count > 1 ? "end" : "middle"
            }
            className="fill-ink-3 text-[0.75rem]"
          >
            {clip(label, 14)}
          </text>
        ) : null,
      )}
      {active !== null ? (
        <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} stroke="var(--chart-axis)" />
      ) : null}
      {chart.series.map((series, s) => {
        const segments: string[] = [];
        let open = false;
        series.values.forEach((value, index) => {
          if (value === null) {
            open = false;
            return;
          }
          segments.push(`${open ? "L" : "M"}${x(index)},${y(value)}`);
          open = true;
        });
        const lastIndex = series.values.findLastIndex((value) => value !== null);
        const dotAt = active ?? lastIndex;
        const dotValue = series.values[dotAt];
        return (
          <g key={series.name}>
            <path
              d={segments.join("")}
              fill="none"
              stroke={colour(s)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              data-line=""
            />
            {dotValue !== null && dotValue !== undefined ? (
              <circle
                cx={x(dotAt)}
                cy={y(dotValue)}
                r={4}
                fill={colour(s)}
                stroke="var(--chart-surface)"
                strokeWidth={2}
                data-mark=""
                data-active-mark=""
              />
            ) : null}
          </g>
        );
      })}
      <rect
        x={x0}
        y={top}
        width={Math.max(0, x1 - x0)}
        height={Math.max(0, bottom - top)}
        fill="transparent"
        onPointerMove={onPointerMove}
      />
    </g>
  );
}

// ── Pie ─────────────────────────────────────────────────────────────────────────────────────────

function pieHeight(width: number): number {
  return Math.min(220, Math.max(160, width * 0.5));
}

function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep >= Math.PI * 2 - 1e-6) {
    // A full ring: two half arcs, since one arc cannot start and end at the same point.
    return `${arcPath(cx, cy, outer, inner, start, start + Math.PI)}${arcPath(cx, cy, outer, inner, start + Math.PI, end)}`;
  }
  const large = sweep > Math.PI ? 1 : 0;
  const point = (radius: number, angle: number) =>
    `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;
  return `M${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`;
}

function Pie({
  slices,
  width,
  active,
  onActive,
}: {
  slices: { label: string; value: number }[];
  width: number;
  active: number | null;
  onActive: (index: number | null) => void;
}) {
  const height = pieHeight(width);
  const outer = height / 2 - 4;
  const inner = outer * 0.6;
  const cx = width / 2;
  const cy = height / 2;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let angle = 0;
  return (
    <g>
      {slices.map((slice, index) => {
        const start = angle;
        angle += (slice.value / total) * Math.PI * 2;
        return (
          <path
            key={slice.label}
            d={arcPath(cx, cy, outer, inner, start, angle)}
            fill={colour(index)}
            stroke="var(--chart-surface)"
            strokeWidth={2}
            data-mark=""
            data-active-mark={active === index ? "" : undefined}
            onPointerEnter={() => onActive(index)}
          />
        );
      })}
    </g>
  );
}
