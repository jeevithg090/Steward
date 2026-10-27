import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataTable } from "./DataTable.tsx";
import { isNumericColumn, nextSort, numericValue, readTable, sortRows } from "./table.ts";

afterEach(cleanup);

describe("readTable", () => {
  it("accepts rows as arrays, as { cells }, and as objects keyed by column", () => {
    const columns = ["Team", "Hours"];
    expect(readTable({ title: "T", columns, rows: [["Design", 18]] })?.rows).toEqual([["Design", 18]]);
    expect(readTable({ title: "T", columns, rows: [{ cells: ["Design", 18] }] })?.rows).toEqual([
      ["Design", 18],
    ]);
    expect(readTable({ title: "T", columns, rows: [{ Team: "Design", Hours: 18 }] })?.rows).toEqual([
      ["Design", 18],
    ]);
  });

  it("pads short rows, tells duplicate headings apart, and waits for columns", () => {
    expect(readTable({ columns: ["A", "B"], rows: [["x"]] })?.rows).toEqual([["x", null]]);
    expect(readTable({ columns: ["Price", "Price"], rows: [] })?.columns).toEqual(["Price", "Price (2)"]);
    expect(readTable({ title: "Nothing yet" })).toBeUndefined();
  });
});

describe("sortRows", () => {
  const rows = [
    ["Product", 24, "£1,200"],
    ["Engineering", 72, "£950"],
    ["Design", 18, ""],
    ["Item 10", 5, "£3"],
    ["Item 2", 5, "£40"],
  ];

  it("sorts numbers numerically, both ways", () => {
    expect(sortRows(rows, { column: 1, ascending: true }).map((r) => r[1])).toEqual([5, 5, 18, 24, 72]);
    expect(sortRows(rows, { column: 1, ascending: false }).map((r) => r[1])).toEqual([72, 24, 18, 5, 5]);
  });

  it("keeps the original order for equal values", () => {
    expect(
      sortRows(rows, { column: 1, ascending: true })
        .slice(0, 2)
        .map((r) => r[0]),
    ).toEqual(["Item 10", "Item 2"]);
  });

  it("sorts formatted amounts as numbers and puts empty cells last", () => {
    expect(sortRows(rows, { column: 2, ascending: true }).map((r) => r[2])).toEqual([
      "£3",
      "£40",
      "£950",
      "£1,200",
      "",
    ]);
    expect(sortRows(rows, { column: 2, ascending: false }).map((r) => r[2])).toEqual([
      "£1,200",
      "£950",
      "£40",
      "£3",
      "",
    ]);
  });

  it("sorts words with numbers in them naturally", () => {
    expect(sortRows(rows, { column: 0, ascending: true }).map((r) => r[0])).toEqual([
      "Design",
      "Engineering",
      "Item 2",
      "Item 10",
      "Product",
    ]);
  });

  it("leaves the order alone with no sort, and does not change its input", () => {
    const copy = rows.map((r) => [...r]);
    expect(sortRows(rows, null)).toEqual(rows);
    sortRows(rows, { column: 0, ascending: false });
    expect(rows).toEqual(copy);
  });

  it("reads numbers out of formatted cells, and not out of words", () => {
    expect(numericValue("12%")).toBe(12);
    expect(numericValue("-4")).toBe(-4);
    expect(numericValue("$3.50")).toBe(3.5);
    expect(numericValue("2.5k")).toBe(2500);
    expect(numericValue("Q3")).toBeUndefined();
    expect(numericValue("2026-10-27")).toBeUndefined();
    expect(isNumericColumn(rows, 2)).toBe(true);
    expect(isNumericColumn(rows, 0)).toBe(false);
  });

  it("toggles direction on the same column and starts ascending on a new one", () => {
    expect(nextSort(null, 1)).toEqual({ column: 1, ascending: true });
    expect(nextSort({ column: 1, ascending: true }, 1)).toEqual({ column: 1, ascending: false });
    expect(nextSort({ column: 1, ascending: false }, 0)).toEqual({ column: 0, ascending: true });
  });
});

describe("DataTable", () => {
  const args = {
    title: "Team capacity",
    columns: ["Team", "Available hours"],
    rows: [
      ["Product", 24],
      ["Engineering", 72],
      ["Design", 18],
    ],
  };

  const firstColumn = () =>
    within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0]?.textContent);

  it("is a named region holding a real table", () => {
    render(<DataTable args={args} />);
    expect(screen.getByRole("region", { name: "Team capacity" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Team",
      "Available hours",
    ]);
    expect(firstColumn()).toEqual(["Product", "Engineering", "Design"]);
  });

  it("sorts when a heading is pressed, and says so", () => {
    render(<DataTable args={args} />);
    const hours = screen.getByRole("button", { name: /Available hours/ });
    fireEvent.click(hours);
    expect(firstColumn()).toEqual(["Design", "Product", "Engineering"]);
    expect(screen.getByRole("columnheader", { name: /Available hours/ }).getAttribute("aria-sort")).toBe(
      "ascending",
    );
    expect(screen.getByText("Sorted by Available hours, ascending.")).toBeTruthy();

    fireEvent.click(hours);
    expect(firstColumn()).toEqual(["Engineering", "Product", "Design"]);
    expect(screen.getByRole("columnheader", { name: /Available hours/ }).getAttribute("aria-sort")).toBe(
      "descending",
    );
  });

  it("waits politely for its data", () => {
    render(<DataTable args={{ title: "Soon" }} />);
    expect(screen.getByText("Putting the table together…")).toBeTruthy();
  });
});
