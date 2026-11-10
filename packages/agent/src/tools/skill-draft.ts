import { SkillBody } from "@steward/shared";
import { builtin } from "./define.ts";
import { ArgumentError, object, readString, str } from "./schema.ts";
import type { StewardTool } from "./types.ts";

/**
 * A skill written in the conversation, for the person to save. The tool only checks the draft and
 * shows it: the card in the chat saves it to /skills when the person presses Save skill, and never
 * before. A saved skill grants no tools; it is followed only when the person calls it by name.
 */
export const showSkill = builtin("show_skill", {
  description: [
    "Show a skill you have written for the person as a card with Save skill and Edit first, when they ask you to make, write or save a skill (instructions they can call later by typing /name in Chat).",
    "Write the instructions as the work of one request, in the imperative and in their words, without names, addresses or anything you only read in mail or on the web. Nothing is saved until they press Save skill, so never say it is saved.",
  ].join(" "),
  parameters: object(
    {
      name: str("Lowercase letters, numbers and dashes, such as weekly-review. They type /name to call it."),
      description: str("What it is for, in one short sentence."),
      instructions: str("What Steward should do each time it is called, in the imperative."),
    },
    ["name", "description", "instructions"],
  ),
  toGateCall: async () => ({ target: {} }),
  execute: async (args, ctx) => {
    const draft = {
      name: readString(args, "name", { max: 41 }).trim(),
      description: readString(args, "description", { max: 300 }).trim(),
      instructions: readString(args, "instructions", { max: 8000 }).trim(),
      tools: [],
    };
    if (!SkillBody.safeParse(draft).success) {
      throw new ArgumentError(
        `"${draft.name}" can't be a skill's name: use lowercase letters, numbers and dashes, such as weekly-review.`,
      );
    }
    if (ctx.services.stores.skills.get(draft.name)) {
      throw new ArgumentError(
        `There is already a skill called /${draft.name}. Pick another name, or tell the person they can change that one on the Skills page.`,
      );
    }
    return {
      shown: true,
      next: "The draft is on screen with Save skill. Nothing is saved until the person presses it, so do not say it is saved; add at most one sentence.",
    };
  },
});

export const SKILL_TOOLS: StewardTool[] = [showSkill];
