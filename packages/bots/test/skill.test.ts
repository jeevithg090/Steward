import { describe, expect, it } from "vitest";
import { parseSkillMd, SkillMdError, serializeSkillMd } from "../src/skill.ts";

const FULL = `---
name: find-rentals
description: Finds rentals in a budget and flags the ones that look like scams.
license: MIT
compatibility: Needs a browser and web search.
metadata:
  author: sam
  version: "2"
allowed-tools: web_search browser_navigate browser_snapshot
---

# Find rentals

1. Search the usual sites.
2. Flag anything that asks for a deposit before a viewing.
`;

function fails(text: string, field: string, message: RegExp): void {
  let caught: unknown;
  try {
    parseSkillMd(text);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SkillMdError);
  expect((caught as SkillMdError).field).toBe(field);
  expect((caught as SkillMdError).message).toMatch(message);
}

describe("SKILL.md", () => {
  it("reads every frontmatter field and the body, and writes the same text back", () => {
    const skill = parseSkillMd(FULL);
    expect(skill).toEqual({
      name: "find-rentals",
      description: "Finds rentals in a budget and flags the ones that look like scams.",
      body: "# Find rentals\n\n1. Search the usual sites.\n2. Flag anything that asks for a deposit before a viewing.",
      license: "MIT",
      compatibility: "Needs a browser and web search.",
      metadata: { author: "sam", version: "2" },
      allowedTools: ["web_search", "browser_navigate", "browser_snapshot"],
    });
    expect(serializeSkillMd(skill)).toBe(FULL);
    expect(parseSkillMd(serializeSkillMd(skill))).toEqual(skill);
  });

  it("needs only a name, a description and a body", () => {
    const skill = parseSkillMd("---\nname: tidy\ndescription: Tidies up.\n---\nDo the tidying.\n");
    expect(skill).toEqual({ name: "tidy", description: "Tidies up.", body: "Do the tidying." });
    expect(serializeSkillMd(skill)).toBe(
      "---\nname: tidy\ndescription: Tidies up.\n---\n\nDo the tidying.\n",
    );
    expect(parseSkillMd(serializeSkillMd(skill))).toEqual(skill);
  });

  it("copes with a byte order mark and Windows line endings", () => {
    const skill = parseSkillMd("﻿---\r\nname: tidy\r\ndescription: Tidies up.\r\n---\r\n\r\nDo it.\r\n");
    expect(skill).toEqual({ name: "tidy", description: "Tidies up.", body: "Do it." });
  });

  it("keeps a description that needs quoting", () => {
    const skill = parseSkillMd(FULL);
    const tricky = { ...skill, description: 'Says "yes: maybe" #not a comment', metadata: { "a key": "x" } };
    expect(parseSkillMd(serializeSkillMd(tricky))).toEqual(tricky);
  });

  it("names the field in every error", () => {
    fails("Just text, no frontmatter.", "frontmatter", /must start with a --- block/);
    fails("---\nname: [\n---\nbody\n", "frontmatter", /not valid YAML/);
    fails("---\n---\nbody\n", "frontmatter", /empty/);
    fails("---\n- a\n- b\n---\nbody\n", "frontmatter", /map of fields/);
    fails("---\ndescription: x\n---\nbody\n", "name", /name: is required/);
    fails(
      "---\nname: Find Rentals\ndescription: x\n---\nbody\n",
      "name",
      /lowercase letters, digits and single hyphens/,
    );
    fails("---\nname: find--rentals\ndescription: x\n---\nbody\n", "name", /single hyphens/);
    fails("---\nname: -rentals\ndescription: x\n---\nbody\n", "name", /single hyphens/);
    fails(`---\nname: ${"a".repeat(65)}\ndescription: x\n---\nbody\n`, "name", /at most 64 characters/);
    fails("---\nname: 7\ndescription: x\n---\nbody\n", "name", /must be text/);
    fails("---\nname: tidy\n---\nbody\n", "description", /description: is required/);
    fails("---\nname: tidy\ndescription: ''\n---\nbody\n", "description", /must not be empty/);
    fails(`---\nname: tidy\ndescription: ${"x".repeat(1025)}\n---\nbody\n`, "description", /at most 1024/);
    fails("---\nname: tidy\ndescription: x\nlicense: 5\n---\nbody\n", "license", /must be text/);
    fails(
      `---\nname: tidy\ndescription: x\ncompatibility: ${"y".repeat(501)}\n---\nbody\n`,
      "compatibility",
      /at most 500/,
    );
    fails("---\nname: tidy\ndescription: x\nmetadata:\n  - a\n---\nbody\n", "metadata", /map of text values/);
    fails(
      "---\nname: tidy\ndescription: x\nmetadata:\n  version: 2\n---\nbody\n",
      "metadata.version",
      /must be text/,
    );
    fails(
      "---\nname: tidy\ndescription: x\nallowed-tools:\n  - web_search\n---\nbody\n",
      "allowed-tools",
      /tool names separated by spaces/,
    );
    fails("---\nname: tidy\ndescription: x\ntools: web_search\n---\nbody\n", "tools", /not a SKILL.md field/);
    fails("---\nname: tidy\ndescription: x\n---\n\n\n", "body", /needs instructions/);
    fails("---\nname: tidy\ndescription: x\n---", "body", /needs instructions/);
  });
});
