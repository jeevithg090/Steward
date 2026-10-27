import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Chart } from "./Chart.tsx";
import { describeChart, drawable, formatValue, niceTicks, pieSlices, readChart } from "./chart.ts";

afterEach(cleanup);

const monthly = {
  type: "bar",
  title: "Orders by month",
  points: [
    { label: "July", value: 12 },
    { label: "August", value: 42 },
    { label: "September", value: 30 },
  ],
};

describe("readChart", () => {
  it("reads one series from points or from labels and values", () => {
    const chart = readChart(monthly);
    expect(chart?.kind).toBe("bar");
    expect(chart?.labels).toEqual(["July", "August", "September"]);
    expect(chart?.series[0]?.values).toEqual([12, 42, 30]);
    expect(
      readChart({ kind: "line", title: "T", labels: ["a", "b"], values: [1, 2] })?.series[0]?.values,
    ).toEqual([1, 2]);
  });

  it("reads several series and lines them up with the labels", () => {
    const chart = readChart({
      type: "line",
      title: "Visits",
      labels: ["Mon", "Tue", "Wed"],
      series: [
        { name: "Web", values: [3, 5, 4] },
        { name: "App", values: [1, 2] },
      ],
    });
    expect(chart?.series.map((s) => s.values)).toEqual([
      [3, 5, 4],
      [1, 2, null],
    ]);
  });

  it("waits until there is a value to draw", () => {
    expect(readChart({ title: "Soon" })).toBeUndefined();
    expect(readChart({ title: "Soon", points: [{ label: "a" }] })).toBeUndefined();
  });

  it("folds a pie's smallest slices into Other and refuses negative pies", () => {
    const pie = readChart({
      type: "pie",
      title: "Share",
      labels: ["a", "b", "c", "d", "e", "f", "g", "h"],
      values: [40, 20, 10, 8, 7, 6, 5, 4],
    })!;
    const slices = pieSlices(pie);
    expect(slices).toHaveLength(6);
    expect(slices[5]).toEqual({ label: "Other", value: 15 });
    expect(drawable(readChart({ type: "pie", title: "x", labels: ["a", "b"], values: [3, -1] })!)).toBe(
      false,
    );
  });

  it("picks round ticks and says what the chart shows", () => {
    expect(niceTicks(0, 42, 4)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(-5, 18, 4)).toEqual([-10, 0, 10, 20]);
    expect(formatValue(1200, "£")).toBe("£1,200");
    expect(formatValue(12, "%")).toBe("12%");
    expect(describeChart(readChart(monthly)!)).toBe(
      "Bar chart: Orders by month. 3 values; highest August at 42, lowest July at 12.",
    );
  });
});

describe("Chart", () => {
  it("draws an image with a summary, and keeps every number in a table", () => {
    render(<Chart args={monthly} />);
    const image = screen.getByRole("img", { name: /Orders by month/ });
    expect(image.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText(/highest August at 42, lowest July at 12/)).toBeTruthy();

    fireEvent.click(screen.getByText("Show the numbers"));
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(["July12", "August42", "September30"]);
  });

  it("falls back to the table, already open, when the data cannot be drawn as asked", () => {
    render(<Chart args={{ type: "pie", title: "Balance", labels: ["In", "Out"], values: [30, -12] }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/can't be drawn as a pie chart/)).toBeTruthy();
    const details = screen.getByText("Show the numbers").closest("details");
    expect(details?.open).toBe(true);
    expect(within(screen.getByRole("table")).getByText("-12")).toBeTruthy();
  });

  it("walks the values with the arrow keys and reads each one out", () => {
    render(<Chart args={monthly} />);
    const explorer = screen.getByRole("img").parentElement!;
    fireEvent.keyDown(explorer, { key: "ArrowRight" });
    expect(screen.getByText("July: Orders by month 12")).toBeTruthy();
    fireEvent.keyDown(explorer, { key: "End" });
    expect(screen.getByText("September: Orders by month 30")).toBeTruthy();
  });

  it("names every series in a legend when there is more than one", () => {
    render(
      <Chart
        args={{
          type: "bar",
          title: "Visits",
          labels: ["Mon", "Tue"],
          series: [
            { name: "Web", values: [3, 5] },
            { name: "App", values: [1, 2] },
          ],
        }}
      />,
    );
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Web", "App"]);
  });
});
