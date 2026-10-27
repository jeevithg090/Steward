// Descriptions adapted from openbot/app/src/lib/copilot/computer-tools.tsx and shared/bot-prompt.ts (MIT, CopilotKit)
import type { Target } from "@steward/shared";
import { builtin } from "./define.ts";
import {
  bool,
  INTENT,
  int,
  object,
  oneOf,
  readEnum,
  readOptionalBoolean,
  readOptionalNumber,
  readString,
  str,
} from "./schema.ts";
import { pageTarget, urlTarget } from "./target.ts";
import type { StewardTool, ToolArgs, ToolContext } from "./types.ts";

const REF = str("The ref of the element, such as e12, from your most recent snapshot. Never invent one.");

async function computer(ctx: ToolContext) {
  return ctx.services.computers.get(ctx.agentId);
}

function currentPage(ctx: ToolContext): Target {
  return pageTarget(ctx.services.computers.status(ctx.agentId).url);
}

/** The page plus the element a ref names, read from the computer's own snapshot, never from the model. */
async function elementTarget(args: ToolArgs, ctx: ToolContext): Promise<Target> {
  const ref = readString(args, "ref");
  const described = await (await computer(ctx)).describe(ref);
  return {
    ...currentPage(ctx),
    element: {
      ref,
      ...(described?.role ? { role: described.role } : {}),
      ...(described?.name ? { name: described.name } : {}),
    },
  };
}

export const browserNavigate = builtin("browser_navigate", {
  description:
    "Open a web page on your own computer, where the person can watch. Use it when asked to open, visit or read a particular site. It is not a search engine: to look something up, use web_search. Returns the page's title and a snapshot of what is on it, with a ref such as [ref=e12] on everything you can act on. Answer from what comes back rather than telling the person to go and look.",
  parameters: object({ url: str("The full web address, such as https://example.com."), intent: INTENT }, [
    "url",
  ]),
  toGateCall: async (args) => ({ target: urlTarget(readString(args, "url")) }),
  execute: async (args, ctx) => {
    const target = urlTarget(readString(args, "url"));
    if (!target.host) throw new Error("That is not a web address I can open.");
    return (await computer(ctx)).navigate(target.url ?? "");
  },
});

export const browserSnapshot = builtin("browser_snapshot", {
  description:
    "Look at the page open on your computer right now: its text, fields, buttons and links, with a ref such as [ref=e12] on everything you can act on. Call this before clicking or typing, and again whenever the page has changed, then use the new refs. Values in password and card fields are hidden.",
  parameters: object({}),
  toGateCall: async (_args, ctx) => ({ target: currentPage(ctx) }),
  execute: async (_args, ctx) => (await computer(ctx)).snapshot(),
});

export const browserClick = builtin("browser_click", {
  description:
    "Click something on the page: a button, a link, a checkbox or an option. Give its ref from your most recent snapshot. Clicking a button that sends, pays, buys, signs or deletes asks the person first. Returns a fresh snapshot; use its refs for your next action.",
  parameters: object({ ref: REF, intent: INTENT }, ["ref"]),
  toGateCall: async (args, ctx) => ({ target: await elementTarget(args, ctx) }),
  execute: async (args, ctx) => (await computer(ctx)).click(readString(args, "ref")),
});

export const browserType = builtin("browser_type", {
  description:
    "Type text into a field on the page, replacing what is in it. Give the field's ref from your most recent snapshot. Set submit to true to press Enter afterwards. Never type a password, a one-time code or a card number with this: use request_secret, so the value never passes through you.",
  parameters: object(
    {
      ref: REF,
      text: str("The text to enter. For a drop-down, the label of the option to choose."),
      submit: bool("Press Enter after typing, to submit a one-field form such as a search box."),
      intent: INTENT,
    },
    ["ref", "text"],
  ),
  toGateCall: async (args, ctx) => ({
    target: await elementTarget(args, ctx),
    outbound: readString(args, "text"),
  }),
  execute: async (args, ctx) => {
    const submit = readOptionalBoolean(args, "submit") ?? false;
    return (await computer(ctx)).type(readString(args, "ref"), readString(args, "text"), { submit });
  },
});

export const browserPress = builtin("browser_press", {
  description:
    "Press one key on the page, such as Enter, Tab, Escape, ArrowDown or PageDown. Pressing Enter in a form can submit it, just like clicking its button.",
  parameters: object({ key: str("The key name, such as Enter, Tab or Escape."), intent: INTENT }, ["key"]),
  toGateCall: async (_args, ctx) => ({ target: currentPage(ctx) }),
  execute: async (args, ctx) => (await computer(ctx)).press(readString(args, "key", { max: 40 })),
});

export const browserScroll = builtin("browser_scroll", {
  description:
    "Scroll the page up or down to bring more of a long page into view. Returns a fresh snapshot of what is now on screen.",
  parameters: object(
    {
      direction: oneOf(["up", "down"], "Which way to scroll."),
      amount: int("Optional. Leave it out to scroll about one screen.", { minimum: 1 }),
    },
    ["direction"],
  ),
  toGateCall: async (_args, ctx) => ({ target: currentPage(ctx) }),
  execute: async (args, ctx) => {
    const direction = readEnum(args, "direction", ["up", "down"] as const);
    return (await computer(ctx)).scroll(direction, readOptionalNumber(args, "amount"));
  },
});

export const browserBack = builtin("browser_back", {
  description: "Go back to the previous page, like the browser's Back button. Returns a fresh snapshot.",
  parameters: object({}),
  toGateCall: async (_args, ctx) => ({ target: currentPage(ctx) }),
  execute: async (_args, ctx) => (await computer(ctx)).back(),
});

export const requestHelp = builtin("request_help", {
  description:
    "Ask the person to take the wheel of your computer and do something you must not or cannot do yourself: sign in, enter a one-time code, or get past a CAPTCHA or any other check that you are human. Never try to solve a CAPTCHA yourself. Say in one sentence exactly what you need done. They drive the browser themselves and hand it back; then take a new snapshot and carry on. Until you call this, nobody is looking at the page, so writing that you need help hands nothing over. Use it instead of giving up.",
  parameters: object(
    {
      reason: str(
        "What you need the person to do, in one sentence, such as 'This page wants a code sent to your phone.'",
      ),
    },
    ["reason"],
  ),
  toGateCall: async (_args, ctx) => ({ target: currentPage(ctx) }),
  execute: async (args, ctx) => {
    const reason = readString(args, "reason", { max: 300 });
    const { released } = await (await computer(ctx)).requestHelp(reason, { signal: ctx.signal });
    return released
      ? { released: true, next: "The person handed control back. Take a new snapshot to see the page now." }
      : { released: false, next: "The person did not take over. Say what you needed, and stop." };
  },
});

export const requestSecret = builtin("request_secret", {
  description:
    "Ask the person for one value you must never see: a password, a one-time code or a card number. Give the ref of the field from your most recent snapshot and a short label, such as 'Password for example.com'. They type it into a masked box that fills the field directly, and you are told only that it was filled. Never ask for a password or a code in the chat, and never type one yourself. If the form then needs submitting, click its button yourself.",
  parameters: object(
    {
      ref: REF,
      label: str("What the value is, in a few words, such as 'the code sent to your phone'."),
    },
    ["ref", "label"],
  ),
  toGateCall: async (args, ctx) => ({ target: await elementTarget(args, ctx) }),
  execute: async (args, ctx) => {
    const label = readString(args, "label", { max: 120 });
    const result = await (await computer(ctx)).requestSecret(readString(args, "ref"), label, {
      signal: ctx.signal,
    });
    return result.filled
      ? {
          filled: true,
          characters: result.length,
          next: `The person entered ${label}. You were not told what it is.`,
        }
      : { filled: false, next: `Nobody entered ${label}. Do not ask for it any other way.` };
  },
});

export const BROWSER_TOOLS: StewardTool[] = [
  browserNavigate,
  browserSnapshot,
  browserClick,
  browserType,
  browserPress,
  browserScroll,
  browserBack,
  requestHelp,
  requestSecret,
];
