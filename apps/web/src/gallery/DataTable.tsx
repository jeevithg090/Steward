/**
 * `show_table`: a real table whose column headings sort it. Native table semantics stay intact, so
 * a screen reader announces headers with every cell, and the sort order is announced as it changes.
 *
 * Adapted from OpenBot's app/src/components/gallery/table.tsx (MIT, CopilotKit).
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils.ts";
import { CardFrame, Quiet } from "./kit.tsx";
import { type Cell, isNumericColumn, nextSort, readTable, type SortState, sortRows } from "./table.ts";

export function DataTable(props: { args?: Record<string, unknown> }) {
  const [sort, setSort] = useState<SortState | null>(null);
  const table = readTable(props.args);
  if (!table) {
    return (
      <CardFrame title="Table">
        <Quiet>Putting the table together…</Quiet>
      </CardFrame>
    );
  }
  const { title, caption, columns, rows } = table;
  const ordered = sortRows(rows, sort);
  const numeric = columns.map((_, index) => isNumericColumn(rows, index));
  const sortedBy = sort ? columns[sort.column] : undefined;

  return (
    <CardFrame
      title={title}
      caption={caption}
      action={
        <span className="text-caption text-ink-3">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
      }
    >
      <section
        aria-label={`${title}, scroll for more`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region needs focus so keyboard users can scroll it; it is named.
        tabIndex={0}
        className="-mx-4 -my-3 max-h-[28rem] overflow-auto"
      >
        <table className="w-full border-collapse text-left text-sub">
          <caption className="sr-only">{title}. Choose a column heading to sort by it.</caption>
          <thead className="sticky top-0 bg-tile text-caption text-ink-2">
            <tr>
              {columns.map((column, index) => {
                const active = sort?.column === index;
                return (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={active ? (sort.ascending ? "ascending" : "descending") : undefined}
                    className="border-b border-hair p-0 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => setSort((current) => nextSort(current, index))}
                      className={cn(
                        "flex min-h-target w-full items-center gap-2 whitespace-nowrap px-4 hover:bg-hair-2",
                        numeric[index] ? "justify-end text-right" : "justify-between text-left",
                      )}
                    >
                      {column}
                      <span aria-hidden className="text-ink-3">
                        {active ? (
                          sort.ascending ? (
                            <ArrowUp className="size-3.5" />
                          ) : (
                            <ArrowDown className="size-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3.5" />
                        )}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordered.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own.
              <tr key={rowIndex} className="border-b border-hair-2 last:border-b-0">
                {columns.map((column, index) => (
                  <td
                    key={column}
                    className={cn(
                      "max-w-xs break-words px-4 py-2.5 align-top",
                      numeric[index] && "text-right tabular-nums",
                    )}
                  >
                    <CellText cell={row[index] ?? null} />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-ink-2">
                  No rows to show.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      {rows.length > 1 ? (
        <p aria-live="polite" className="m-0 mt-4 text-caption text-ink-3">
          {sortedBy && sort
            ? `Sorted by ${sortedBy}, ${sort.ascending ? "ascending" : "descending"}.`
            : "Choose a column heading to sort."}
        </p>
      ) : null}
    </CardFrame>
  );
}

function CellText({ cell }: { cell: Cell }) {
  if (cell === null || (typeof cell === "string" && cell.trim() === "")) {
    return (
      <>
        <span aria-hidden className="text-ink-3">
          —
        </span>
        <span className="sr-only">Empty</span>
      </>
    );
  }
  return <>{typeof cell === "number" ? cell.toLocaleString() : cell}</>;
}
