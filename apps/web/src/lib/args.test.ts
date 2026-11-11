import { describe, expect, it } from "vitest";
import { joinArgs, splitArgs } from "./args.ts";

describe("splitArgs", () => {
  it.each([
    ["-y @modelcontextprotocol/server-everything", ["-y", "@modelcontextprotocol/server-everything"]],
    [
      "-y\n@modelcontextprotocol/server-filesystem\n/tmp",
      ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    ],
    ['-y server-filesystem "/Users/me/My Notes"', ["-y", "server-filesystem", "/Users/me/My Notes"]],
    ["-y server-filesystem '/Users/me/My Notes'", ["-y", "server-filesystem", "/Users/me/My Notes"]],
    ["server-filesystem /Users/me/My\\ Notes", ["server-filesystem", "/Users/me/My Notes"]],
    ['--name="My Notes" --flag', ["--name=My Notes", "--flag"]],
    ['"say \\"hi\\""', ['say "hi"']],
    ["'it''s'", ["its"]],
    ['--empty ""', ["--empty", ""]],
    ["C:\\Users\\me\\notes", ["C:\\Users\\me\\notes"]],
    ["   ", []],
    ["", []],
  ])("%j → %j", (text, args) => {
    expect(splitArgs(text)).toEqual({ args });
  });

  it("says when a quote isn't closed, instead of guessing", () => {
    expect(splitArgs('-y "/Users/me/My Notes').error).toMatch(/double quote isn't closed/);
    expect(splitArgs("-y '/Users/me").error).toMatch(/single quote isn't closed/);
  });
});

describe("joinArgs", () => {
  it("shows an argument with a space or a quote in quotes, and reads back the same", () => {
    const cases = [
      ["-y", "server-filesystem", "/Users/me/My Notes"],
      ['say "hi"', "it's", ""],
      ["C:\\My Notes\\", "a\\\\b", "both \" and '"],
    ];
    for (const args of cases) expect(splitArgs(joinArgs(args)).args).toEqual(args);
    expect(joinArgs(["-y", "/Users/me/My Notes"])).toBe('-y "/Users/me/My Notes"');
  });
});
