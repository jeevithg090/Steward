import { TOOLS } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { humanise, runningLabel, toolName } from "./tool-labels.ts";

describe("toolName", () => {
  it("names browser steps by what they touch", () => {
    expect(runningLabel("browser_navigate", { url: "https://www.news.ycombinator.com/news" })).toBe(
      "Opening news.ycombinator.com",
    );
    expect(toolName("browser_navigate", { url: "https://example.com" }).label).toBe("Opened example.com");
    expect(toolName("browser_click", { ref: "e12", element: "Search button" }).label).toBe(
      "Clicked Search button",
    );
    expect(toolName("browser_click", { ref: "e12" }).label).toBe("Clicked an element");
  });

  it("says what Steward is doing with mail in plain words", () => {
    expect(runningLabel("mail_list")).toBe("Reading your mail");
    expect(runningLabel("brief_today")).toBe("Reading your mail and calendar");
    expect(toolName("mail_send", { to: [{ name: "Sam", email: "sam@example.com" }] }, "running").label).toBe(
      "Writing to Sam <sam@example.com>",
    );
  });

  it("has words for every built-in tool, never the raw id", () => {
    for (const name of Object.keys(TOOLS)) {
      for (const phase of ["running", "done"] as const) {
        const { label } = toolName(name, {}, phase);
        expect(label).not.toContain("_");
        expect(label.length).toBeGreaterThan(3);
      }
    }
  });

  it("humanises MCP tools and names the server unless the label already does", () => {
    expect(toolName("mcp__google-drive__list_files")).toEqual({
      label: "List files",
      detail: "Google Drive",
    });
    expect(toolName("mcp__notes__search_notes")).toEqual({ label: "Search notes" });
    expect(toolName("mcp__routines__create_routine")).toEqual({ label: "Create routine" });
  });

  it("humanises any other name", () => {
    expect(humanise("fetchWeatherForecast")).toBe("Fetch weather forecast");
    expect(toolName("some_new_tool").label).toBe("Some new tool");
  });
});
