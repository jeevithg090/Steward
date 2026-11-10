import { type BotPack, TOOLS } from "@steward/shared";
import { describe, expect, it } from "vitest";
import { checkContent } from "../src/content.ts";
import { validatePack } from "../src/validate.ts";

const CTX = { tools: Object.keys(TOOLS), validateRule: () => {} };

function pack(extra: Partial<BotPack>): BotPack {
  return {
    id: "recipe-finder",
    name: "Recipe finder",
    pitch: "Finds a recipe for what is in the fridge.",
    category: "food",
    version: 1,
    author: { kind: "ai", model: "test/model", generated: "2026-10-28" },
    licence: "MIT",
    needs: { tools: ["web_search", "browser_navigate"], connectors: [], model: "any" },
    instructions: "Search the web with web_search. Open the best page with browser_navigate.",
    starters: ["Find a dinner with leeks and rice."],
    examples: [],
    skills: [],
    rules: [],
    routines: [],
    shortcuts: [],
    readme: "",
    ...extra,
  };
}

const messages = (p: BotPack) => checkContent(p, CTX).map((x) => `${x.path}: ${x.message}`);

describe("content checks", () => {
  it("passes a bot whose text uses only its own tools", () => {
    expect(checkContent(pack({}), CTX)).toEqual([]);
  });

  it("names a tool the text uses that the bot does not hold, in the instructions and in skills", () => {
    const found = messages(
      pack({
        instructions: "Open the page with browser_navigate, then read it with `browser_snapshot`.",
        skills: [
          {
            name: "save",
            description: "Saves the list.",
            body: "1. List the files with file_list. 2. Save the recipe with file_write.",
          },
        ],
      }),
    );
    expect(found).toEqual([
      "instructions: names browser_snapshot, which is not in needs.tools, so the bot cannot use it; add the tool or change the text",
      "skills[0].body: names file_list and file_write, which are not in needs.tools, so the bot cannot use them; add the tool or change the text",
    ]);
  });

  it("leaves a tool name alone when it is only quoted, as a bot about bots does", () => {
    expect(
      messages(
        pack({ instructions: 'A rule such as tool.name == "calendar_create" asks first. Use web_search.' }),
      ),
    ).toEqual([]);
  });

  it("warns when memory_remember is used to look something up", () => {
    const lookups = [
      "Start by asking memory_remember to list every supplement the person takes.",
      "1. Check memory_remember for any past injuries.",
      "If memory_remember has no schedule, say so.",
      "Use memory_remember to list all past sleep entries.",
      "Retrieve the schedule from memory_remember key med_schedule.",
    ];
    for (const text of lookups) {
      const found = messages(
        pack({ needs: { tools: ["memory_remember"], connectors: [], model: "any" }, instructions: text }),
      );
      expect(found, text).toEqual([
        'instructions: uses memory_remember to look something up, but it only saves a fact. What the bot remembers is already in front of it: write "check what you remember about the person"',
      ]);
    }
    for (const text of [
      "Store each date with memory_remember.",
      "Read the plan, then save it in memory_remember.",
      "If memory_remember fails, tell the person.",
    ]) {
      expect(
        messages(
          pack({ needs: { tools: ["memory_remember"], connectors: [], model: "any" }, instructions: text }),
        ),
        text,
      ).toEqual([]);
    }
  });

  it("warns about starters in quote marks or with a placeholder", () => {
    expect(
      messages(
        pack({
          starters: [
            '"Plan my week of dinners."',
            "“Find a vegan lasagne.”",
            "Latest news about [topic]",
            'Is the mail from "Support <help@example.com>" safe?',
            "Find papers on <topic>",
            "Find a curry.",
          ],
        }),
      ),
    ).toEqual([
      "starters[0]: is wrapped in quote marks; write it as the person would type it",
      "starters[1]: is wrapped in quote marks; write it as the person would type it",
      "starters[2]: has a placeholder ([topic]); write a real example the person could send",
      "starters[4]: has a placeholder (<topic>); write a real example the person could send",
    ]);
  });

  it("wants a health bot to send the person to a doctor or other professional", () => {
    const health = pack({
      category: "health",
      instructions: "Plan a low-salt week of meals. Use web_search.",
    });
    expect(messages(health)).toEqual([
      "instructions: never tells the agent to send the person to a doctor, pharmacist or other health professional; a health bot should",
    ]);
    expect(
      messages({
        ...health,
        instructions: `${health.instructions} Suggest they check with their GP or a dietitian first.`,
      }),
    ).toEqual([]);
    // Only the readme saying so is not enough: the agent never reads it to the person.
    expect(messages({ ...health, readme: "Not medical advice. Ask your doctor." })).toHaveLength(1);
  });

  it("wants a money bot that touches advice to say so, but leaves a bill calendar alone", () => {
    const pension = pack({
      category: "money",
      pitch: "Works out what a pension pays at 67.",
      instructions: "Ask for the pot size. Use web_search for the annuity rates.",
    });
    expect(messages(pension)).toEqual([
      "instructions: never tells the agent to send the person to a qualified adviser, and to say it is not financial advice; a money bot should",
    ]);
    expect(
      messages({ ...pension, instructions: `${pension.instructions} Say this is not financial advice.` }),
    ).toEqual([]);
    expect(
      messages(
        pack({
          category: "money",
          pitch: "Puts each bill's due date in a list.",
          instructions: "Use web_search.",
        }),
      ),
    ).toEqual([]);
    // Investing always.
    expect(messages(pack({ category: "investing", instructions: "Use web_search." }))).toHaveLength(1);
  });

  it("only warns: a pack with content warnings still passes", () => {
    const result = validatePack(pack({ starters: ['"Find a curry."'], instructions: "Use web_fetch." }), CTX);
    expect(result.ok).toBe(true);
    expect(result.problems.filter((p) => p.severity === "warn").map((p) => p.path)).toEqual(
      expect.arrayContaining(["instructions", "starters[0]"]),
    );
  });
});
