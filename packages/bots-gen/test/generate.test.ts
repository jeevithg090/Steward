import { ONLY_TIGHTEN, validatePack } from "@steward/bots";
import { CelEngine, CONTEXT_SCHEMA, neutralContext } from "@steward/gateway";
import { BotPackSchema, type TextModel, TOOLS } from "@steward/shared";
import { describe, expect, it } from "vitest";

const validateRuleLocally = (when: string) => new CelEngine(CONTEXT_SCHEMA, neutralContext).validate(when);

import { assembleCandidate, generateBot, REFERRAL, templatePack, toolsForJob } from "../src/generate.ts";
import { parseJsonObject, repairTrailingCommas } from "../src/json.ts";
import { buildGenerateSystem, isPackTool, RULE_MENU, ruleMenuEntry } from "../src/prompt.ts";
import { displayName, distinctName, nameFromJob, slugify } from "../src/text.ts";

const CTX = {
  tools: Object.keys(TOOLS),
  validateRule: validateRuleLocally,
  now: () => new Date("2026-10-28T09:00:00Z"),
};

function fakeModel(answers: string[]): TextModel & { calls: { system: string; prompt: string }[] } {
  const calls: { system: string; prompt: string }[] = [];
  return {
    label: "fake/model",
    calls,
    async complete({ system, prompt }) {
      calls.push({ system, prompt });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (answer === undefined) throw new Error("no answer scripted");
      return answer;
    },
  };
}

const GOOD_JSON = `Here is the pack:
\`\`\`json
{
  "name": "Invoice chaser",
  "pitch": "Finds the invoice that is overdue and drafts a polite reminder for you to send.",
  "category": "money",
  "needs": { "tools": ["mail_list", "mail_read", "mail_send"], "connectors": ["mail"], "model": "any" },
  "instructions": "Help one person chase an unpaid invoice.\\n\\n1. Find the invoice in their mail. If there is none, say so and ask for the number.\\n2. Work out how late it is from the due date on the invoice. Never guess a date.\\n3. Draft a short, polite reminder and call mail_send; the person decides on the approval card.\\n\\nNever call the person by a name they did not give.",
  "starters": ["Chase the invoice that is 30 days late.", "Which invoices are overdue?",],
  "examples": [{ "ask": "Chase invoice 42 (a made-up example).", "does": "Finds it, works out it is 31 days late, drafts the reminder.", },],
  "skills": [],
  "rules": [{ "name": "Ask before sending", "effect": "ask", "when": "tool.kind == \\"send\\"", "description": "Every reminder is shown first.", }],
  "readme": "# Invoice chaser\\n\\nChases one overdue invoice at a time.\\n\\n## What it needs\\n\\nMail.",
}
\`\`\``;

describe("parseJsonObject", () => {
  it("strips fences, prose and trailing commas", () => {
    const raw = parseJsonObject(GOOD_JSON);
    expect(raw.name).toBe("Invoice chaser");
    expect((raw.starters as string[]).length).toBe(2);
  });

  it("leaves commas inside strings alone", () => {
    expect(repairTrailingCommas('{"a": "x, }", "b": [1, 2, ], }')).toBe('{"a": "x, }", "b": [1, 2 ] }');
  });

  it("refuses an answer with no object", () => {
    expect(() => parseJsonObject("sorry, no")).toThrow(/no JSON object/);
  });
});

describe("templatePack", () => {
  it("yields a valid, deterministic pack from the job text", async () => {
    const result = await generateBot({ job: "chase the invoice that is 30 days late" }, CTX);
    expect(result.madeBy).toBe("template");
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    const pack = result.pack;
    expect(BotPackSchema.safeParse(pack).success).toBe(true);
    expect(validatePack(pack, CTX).ok).toBe(true);
    expect(pack.name).toBe("Invoice chaser");
    expect(pack.id).toBe("invoice-chaser");
    expect(pack.category).toBe("money");
    expect(pack.author).toEqual({ kind: "ai", model: "template", generated: "2026-10-28" });
    expect(pack.needs.tools).toContain("mail_read");
    expect(pack.needs.connectors).toEqual(["mail"]);
    expect(pack.starters).toHaveLength(2);
    expect(pack.examples).toHaveLength(1);
    expect(pack.pitch).toBe("Chase the invoice that is 30 days late.");
    expect(templatePack({ job: "chase the invoice that is 30 days late" }, CTX)).toEqual(pack);
  });

  it("uses the given name and category, and the hinted tools", () => {
    const pack = templatePack(
      { job: "plan a week of dinners for four", name: "Dinner planner", category: "food" },
      { ...CTX, hints: { tools: ["web_search", "make_page", "show_table"], connectors: [] } },
    );
    expect(pack.name).toBe("Dinner planner");
    expect(pack.category).toBe("food");
    expect(pack.needs.tools).toEqual(["web_search", "make_page", "show_table"]);
  });

  it("never asks for the secret box or display-only tools", () => {
    for (const tool of Object.keys(TOOLS)) {
      const picked = toolsForJob(`use ${tool} to ${tool.replace(/_/g, " ")}`, [tool]);
      if (!isPackTool(tool)) expect(picked.tools).not.toContain(tool);
    }
    expect(isPackTool("request_secret")).toBe(false);
    expect(isPackTool("show_chart")).toBe(false);
    expect(isPackTool("show_table")).toBe(true);
  });
});

describe("generateBot with a model", () => {
  it("parses fenced JSON with trailing commas into a valid pack", async () => {
    const model = fakeModel([GOOD_JSON]);
    const result = await generateBot({ job: "chase the invoice that is 30 days late" }, { ...CTX, model });
    expect(result.madeBy).toBe("model");
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.pack.name).toBe("Invoice chaser");
    expect(result.pack.author).toEqual({ kind: "ai", model: "fake/model", generated: "2026-10-28" });
    expect(result.pack.version).toBe(1);
    expect(result.pack.licence).toBe("MIT");
    expect(result.pack.rules[0]?.effect).toBe("ask");
    expect(validatePack(result.pack, CTX).ok).toBe(true);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.system).toContain("mail_send");
    expect(model.calls[0]?.system).not.toContain("request_secret");
  });

  it("refuses an allow rule, retries with the problem, then falls back to the template", async () => {
    const bad = GOOD_JSON.replace('"effect": "ask"', '"effect": "allow"');
    const model = fakeModel([bad, bad]);
    const result = await generateBot({ job: "chase the invoice that is 30 days late" }, { ...CTX, model });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain(ONLY_TIGHTEN);
    expect(result.madeBy).toBe("template");
    expect(result.problems.some((p) => p.message === ONLY_TIGHTEN)).toBe(true);
    expect(
      result.problems.some((p) => p.severity === "warn" && /template pack was made/.test(p.message)),
    ).toBe(true);
    expect(validatePack(result.pack, CTX).ok).toBe(true);
  });

  it("takes the corrected answer on the retry", async () => {
    const bad = GOOD_JSON.replace('"effect": "ask"', '"effect": "allow"');
    const model = fakeModel([bad, GOOD_JSON]);
    const result = await generateBot({ job: "chase the invoice that is 30 days late" }, { ...CTX, model });
    expect(result.madeBy).toBe("model");
    expect(model.calls).toHaveLength(2);
  });

  it("flags a tool a pack may not use", async () => {
    const bad = GOOD_JSON.replace('"mail_send"', '"request_secret"');
    const model = fakeModel([bad, bad]);
    const result = await generateBot({ job: "chase the invoice that is 30 days late" }, { ...CTX, model });
    expect(result.madeBy).toBe("template");
    expect(result.problems.some((p) => /request_secret/.test(p.message))).toBe(true);
  });

  it("falls back to the template when the model cannot be reached", async () => {
    const model: TextModel = {
      label: "down",
      complete: async () => {
        throw new Error("The model endpoint answered 503.");
      },
    };
    const result = await generateBot({ job: "plan a week of dinners for four" }, { ...CTX, model });
    expect(result.madeBy).toBe("template");
    expect(result.problems.some((p) => /503/.test(p.message))).toBe(true);
  });
});

describe("rules", () => {
  const assemble = (tools: string[], rules: unknown[]) =>
    assembleCandidate({ needs: { tools }, rules }, { job: "plan a dinner party" }, CTX) as {
      rules: { name: string; effect: string; when: string; description: string }[];
    };

  it("names each rule from the menu, so its name says what its condition does", () => {
    const { rules } = assemble(
      ["web_search", "calendar_create", "mail_send"],
      [
        {
          name: "check availability",
          effect: "ask",
          when: "tool.name == 'calendar_create'",
          description: "x",
        },
        {
          name: "no medical advice",
          effect: "deny",
          when: 'tool.kind  ==  "pay"',
          description: "Never diagnose.",
        },
      ],
    );
    expect(rules).toEqual([
      {
        name: "Ask before adding to the calendar",
        effect: "ask",
        when: 'tool.name == "calendar_create"',
        description: "Asks you before it adds anything to your calendar.",
      },
      {
        name: "Never pay",
        effect: "deny",
        when: 'tool.kind == "pay"',
        description: "Refuses to pay for anything.",
      },
    ]);
  });

  it("drops a rule off the menu, one for a tool the bot lacks, and the same rule twice", () => {
    const { rules } = assemble(
      ["web_search", "make_page", "browser_navigate", "browser_snapshot"],
      [
        { name: "no medical advice", effect: "ask", when: 'tool.name == "web_search"' },
        { name: "check availability", effect: "ask", when: 'tool.kind == "calendar_create"' },
        { name: "ask before sending", effect: "ask", when: 'tool.kind == "send"' },
        { name: "ask before paying", effect: "ask", when: 'tool.kind == "pay"' },
        { name: "remember", effect: "deny", when: 'tool.name == "memory_remember"' },
        { name: "Drafts only", effect: "deny", when: 'tool.kind == "send"' },
        { name: "Drafts only again", effect: "deny", when: "tool.kind == 'send'" },
      ],
    );
    // Reading pages cannot send or pay; a deny on sending stays, as a promise.
    expect(rules.map((r) => r.name)).toEqual(["Never send"]);
    // A click the gateway raises to pay is something to ask about.
    expect(assemble(["browser_click"], [{ effect: "ask", when: 'tool.kind == "pay"' }]).rules).toHaveLength(
      1,
    );
  });

  it("keeps an allow rule so the validator refuses it", () => {
    const { rules } = assemble(
      ["mail_send"],
      [{ name: "Let it send", effect: "allow", when: 'tool.kind == "send"' }],
    );
    expect(rules).toMatchObject([{ effect: "allow" }]);
  });

  it("knows a menu entry whatever its quotes and spacing", () => {
    expect(ruleMenuEntry("tool.surface=='browser'&&tool.kind=='write'")?.ask.name).toBe(
      "Ask before clicking or typing",
    );
    expect(ruleMenuEntry('tool.name == "web_search"')).toBeUndefined();
  });

  it("tells the model what a rule cannot do and what health and money bots must say", () => {
    const system = buildGenerateSystem(Object.keys(TOOLS));
    expect(system).toContain("A rule only decides whether a tool may run");
    expect(system).toContain("not a doctor or a financial adviser");
    expect(system).toContain("no quote marks around them and no [placeholders]");
  });

  it("gives a template health or money bot a line that sends the person to someone qualified", () => {
    for (const category of ["health", "money", "investing"] as const) {
      const pack = templatePack({ job: "track my blood pressure readings", category }, CTX);
      expect(pack.instructions).toContain(REFERRAL[category]);
      expect(validatePack(pack, CTX).problems.filter((p) => /never tells the agent/.test(p.message))).toEqual(
        [],
      );
    }
    expect(templatePack({ job: "plan a dinner", category: "food" }, CTX).instructions).not.toContain(
      "not a doctor",
    );
  });

  it("accepts every entry of the rule menu and refuses what it does not know", () => {
    for (const rule of RULE_MENU) expect(() => validateRuleLocally(rule.when)).not.toThrow();
    // The gateway's own engine decides the wording; here only the refusal matters.
    for (const bad of ["", 'secret == "x"', 'tool.kind == "send" && (', "tool.kind == `send`"]) {
      expect(() => validateRuleLocally(bad), bad).toThrow();
    }
  });
});

describe("text helpers", () => {
  it("makes ids and names", () => {
    expect(slugify("  Rent Scout!! ")).toBe("rent-scout");
    expect(slugify("--a--b--")).toBe("a-b");
    expect(nameFromJob("find me a flat I can afford")).toBe("Flat finder");
    expect(nameFromJob("plan a week of dinners for four")).toBe("Week dinners planner");
  });

  it("puts listing names in sentence case without touching the rest", () => {
    expect(displayName("cc flagger")).toBe("CC flagger");
    expect(displayName("wifi security")).toBe("Wi-Fi security");
    expect(displayName("rest stop finder")).toBe("Rest stop finder");
    expect(displayName("  welcome dm   sequence ")).toBe("Welcome DM sequence");
    expect(displayName("k8s health endpoints")).toBe("K8s health endpoints");
    expect(displayName("iPhone helper")).toBe("iPhone helper");
    expect(displayName("Rent scout")).toBe("Rent scout");
  });

  it("never gives a new bot a name already on the shelf", () => {
    const taken = new Set(["meal planner", "flat finder"]);
    expect(distinctName("Gift scout", "find a gift under twenty dollars", taken)).toBe("Gift scout");
    expect(distinctName("Meal planner", "plan meals for a houseguest with allergies", taken)).not.toMatch(
      /^Meal planner$/i,
    );
    expect(distinctName("Flat finder", "find me a flat I can afford", taken)).toBe("Flat finder 2");
    expect(distinctName("Flat finder", "find me a flat", new Set([...taken, "flat finder 2"]))).toBe(
      "Flat finder 3",
    );
  });
});
