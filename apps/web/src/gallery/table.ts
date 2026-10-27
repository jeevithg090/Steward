/**
 * The data behind `show_table`: reading what the model sent, and sorting it.
 *
 * The model may send rows as arrays of cells, as `{ cells: [...] }` (OpenBot's shape) or as objects
 * keyed by column. All three become arrays of cells, one per column.
 */

export type Cell = string | number | null;

export interface TableData {
  title: string;
  caption?: string;
  columns: string[];
  rows: Cell[][];
}

export interface SortState {
  column: number;
  ascending: boolean;
}

export const MAX_COLUMNS = 12;
export const MAX_ROWS = 200;

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}

/** Reads `show_table` arguments. Returns undefined until there is at least a column. */
export function readTable(args: Record<string, unknown> | undefined): TableData | undefined {
  if (!args) return undefined;
  const rawColumns = Array.isArray(args.columns)
    ? args.columns
    : Array.isArray(args.headers)
      ? args.headers
      : [];
  const columns = rawColumns
    .map((column) =>
      typeof column === "string"
        ? column
        : typeof column === "object" && column
          ? String((column as { label?: unknown }).label ?? "")
          : String(column),
    )
    .filter((column) => column.trim() !== "")
    .slice(0, MAX_COLUMNS);
  if (columns.length === 0) return undefined;
  // Headings name the columns, so two with the same words are told apart: "Price", "Price (2)".
  const seen = new Map<string, number>();
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i]!;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count > 1) columns[i] = `${name} (${count})`;
  }

  const rawRows = Array.isArray(args.rows) ? args.rows.slice(0, MAX_ROWS) : [];
  const rows = rawRows.map((row): Cell[] => {
    const cells: unknown[] = Array.isArray(row)
      ? row
      : row && typeof row === "object" && Array.isArray((row as { cells?: unknown }).cells)
        ? (row as { cells: unknown[] }).cells
        : row && typeof row === "object"
          ? columns.map((column) => (row as Record<string, unknown>)[column])
          : [row];
    return columns.map((_, index) => toCell(cells[index]));
  });

  const title = typeof args.title === "string" && args.title.trim() !== "" ? args.title : "Table";
  const caption = typeof args.caption === "string" && args.caption.trim() !== "" ? args.caption : undefined;
  return caption ? { title, caption, columns, rows } : { title, columns, rows };
}

/**
 * A number hidden in a formatted cell: "1,200", "£3.50", "12%", "-4". Undefined for text, so
 * "Q3" or "v2" still sort as words.
 */
export function numericValue(cell: Cell): number | undefined {
  if (typeof cell === "number") return cell;
  if (typeof cell !== "string") return undefined;
  const match = cell.trim().match(/^[-+−]?[£$€¥]?\s?[-+−]?\d[\d,]*(\.\d+)?\s?(%|[kKmMbB])?$/);
  if (!match) return undefined;
  const negative = /^[-−]|^[£$€¥]\s?[-−]/.test(cell.trim());
  const digits = cell.replace(/[^\d.]/g, "");
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return undefined;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return (negative ? -value : value) * scale;
}

function isEmpty(cell: Cell): boolean {
  return cell === null || (typeof cell === "string" && cell.trim() === "");
}

/**
 * Sorts rows by one column. Numbers (including formatted ones) sort numerically, everything else
 * as words with numbers inside them in order ("Item 2" before "Item 10"). Empty cells always go
 * last, and rows that compare equal keep their original order.
 */
export function sortRows(rows: readonly Cell[][], sort: SortState | null): Cell[][] {
  if (!sort) return rows.map((row) => [...row]);
  const indexed = rows.map((row, position) => ({ row, position }));
  indexed.sort((left, right) => {
    const a = left.row[sort.column] ?? null;
    const b = right.row[sort.column] ?? null;
    const aEmpty = isEmpty(a);
    const bEmpty = isEmpty(b);
    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return left.position - right.position;
      return aEmpty ? 1 : -1;
    }
    const an = numericValue(a);
    const bn = numericValue(b);
    const order =
      an !== undefined && bn !== undefined
        ? an - bn
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    return (sort.ascending ? order : -order) || left.position - right.position;
  });
  return indexed.map(({ row }) => [...row]);
}

/** The next sort after a heading is pressed: ascending first, then descending, on the same column. */
export function nextSort(current: SortState | null, column: number): SortState {
  return { column, ascending: current?.column === column ? !current.ascending : true };
}

/** Whether a column holds numbers, so it is right-aligned with tabular figures. */
export function isNumericColumn(rows: readonly Cell[][], column: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const cell = row[column] ?? null;
    if (isEmpty(cell)) continue;
    if (numericValue(cell) === undefined) return false;
    seen++;
  }
  return seen > 0;
}
