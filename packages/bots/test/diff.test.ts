import { type BotPack, BotPackSchema } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { diffPacks } from "../src/diff.ts";

const V1: BotPack = BotPackSchema.parse({
  id: "rent-scout",
  name: "Rent Scout",
  pitch: "Finds rentals in your budget.",
  category: "home",
  version: 1,
  author: { kind: "ai", model: "m", generated: "2026-10-28" },
  licence: "MIT",
  needs: { tools: ["web_search", "web_fetch"], connectors: [], model: "any" },
  instructions: "Help one person find a place to rent. Say what you could not check.",
  skills: [{ name: "find-rentals", description: "Finds rentals.", body: "Search the usual sites." }],
  rules: [{ name: "Never pay", effect: "deny", when: 'tool.kind == "pay"' }],
  routines: [{ title: "Morning rentals", prompt: "Look for new rentals.", schedule: "0 8 * * *" }],
  readme: "# Rent Scout",
});

describe("diffPacks", () => {
  it("says nothing when only the version moves", () => {
    expect(diffPacks(V1, { ...V1, version: 2 })).toEqual([]);
  });

  it("puts what widens the bot first: new tools, split by whether they ask, and new connections", () => {
    const v2: BotPack = {
      ...V1,
      version: 2,
      needs: {
        ...V1.needs,
        tools: ["web_search", "mail_list", "browser_type", "mail_send"],
        connectors: ["mail"],
      },
    };
    expect(diffPacks(V1, v2, { runsWithoutAsking: new Set(["mail_list", "browser_type"]) })).toEqual([
      "New: it may read your mail, type into web pages without asking.",
      "New: it may send email, after asking you.",
      "Now needs your mail.",
      "No longer uses the tools to read web pages.",
    ]);
    expect(diffPacks(V1, v2)[0]).toBe("New tools: it may read your mail, type into web pages, send email.");
  });

  it("names rules dropped, added and changed", () => {
    const v2: BotPack = {
      ...V1,
      version: 2,
      rules: [
        { name: "Ask before booking", effect: "ask", when: 'tool.kind == "write"', description: "" },
        { name: "Old", effect: "deny", when: "false", description: "" },
      ],
    };
    const v3: BotPack = {
      ...v2,
      version: 3,
      rules: [
        { name: "Ask before booking", effect: "deny", when: 'tool.kind == "write"', description: "" },
        { name: "Old", effect: "deny", when: "true", description: "" },
      ],
    };
    expect(diffPacks(V1, v2)).toEqual([
      "Drops the rule “Never pay” (it refuses).",
      "Adds the rule “Ask before booking” (it asks first).",
      "Adds the rule “Old” (it refuses).",
    ]);
    expect(diffPacks(v2, v3)).toEqual([
      "Changes the rule “Ask before booking”: it refuses instead of asking first.",
      "Changes when the rule “Old” applies.",
    ]);
  });

  it("quotes a new sentence from changed instructions, and names skills, routines and who made it", () => {
    const v2: BotPack = {
      ...V1,
      version: 2,
      name: "Rent Finder",
      author: { kind: "person", handle: "sam", basedOnAi: true },
      instructions: "Help one person find a place to rent. Also email landlords for them.",
      skills: [
        { name: "find-rentals", description: "Finds rentals.", body: "Search every site you can." },
        { name: "email-landlord", description: "Writes to a landlord.", body: "Draft a short email." },
      ],
      routines: [{ title: "Morning rentals", prompt: "Look for new rentals.", schedule: "0 7 * * *" }],
      shortcuts: [
        {
          id: "find",
          title: "Find a flat",
          description: "",
          prompt: "{input}",
          action: { kind: "skill" },
          scopes: ["chat"],
          source: "bot",
        },
      ],
      readme: "# Rent Finder\n\nNow writes to landlords.",
    };
    expect(diffPacks(V1, v2)).toEqual([
      "Its instructions change, for example “Also email landlords for them.”",
      "Changes what /find-rentals does.",
      "Adds the skill /email-landlord: “Writes to a landlord.”",
      "Changes the routine “Morning rentals”. It is switched off again after the update.",
      "Adds phone shortcuts: “Find a flat”.",
      "Its name changes from “Rent Scout” to “Rent Finder”.",
      "It is now credited by sam.",
      "Its description changes.",
    ]);
  });
});
