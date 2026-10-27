/**
 * Escalation: a click is not always just a click.
 *
 * Browser actions are writes, and writes on the agent's own browser run freely. But clicking a
 * button named "Place order" pays, "Send" sends and "Delete account" deletes. Before deciding, the
 * gateway reads the name of the element the action touches (from the computer's own snapshot,
 * never from the model) and raises the kind to match. The list lives here, in one place, with tests.
 */
import type { ToolKind } from "@steward/shared";

export interface EscalationPattern {
  kind: Extract<ToolKind, "pay" | "sign" | "delete" | "send">;
  pattern: RegExp;
  /** Plain words for the README and the rules page. */
  words: string;
}

/** Checked in this order; the first match wins, so "Submit payment" pays rather than sends. */
export const ESCALATIONS: readonly EscalationPattern[] = [
  {
    kind: "pay",
    pattern:
      /\b(pay|pay now|payment|make payment|buy|buy now|purchase|checkout|proceed to checkout|place (?:my |your |the )?order|complete (?:my |your |the )?(?:order|purchase)|confirm (?:and pay|payment|purchase|order)|subscribe|donate|transfer|send money)\b/i,
    words: "pay, buy, purchase, checkout, place order, subscribe, donate, transfer, send money",
  },
  {
    kind: "sign",
    // "Sign in", "Sign up", "Sign out" are not signatures.
    pattern: /\b(e-?sign|agree and sign|adopt and sign|sign(?![\s-]*(?:in|up|out|on|off)\b))\b/i,
    words: "sign, agree and sign, e-sign (not sign in, sign up or sign out)",
  },
  {
    kind: "delete",
    pattern:
      /\b(delete|remove|trash|move to trash|erase|destroy|deactivate|unsubscribe|cancel (?:my |your |the )?(?:subscription|membership|plan)|close (?:my |your |the )?account)\b/i,
    words: "delete, remove, trash, erase, deactivate, unsubscribe, cancel subscription, close account",
  },
  {
    kind: "send",
    pattern: /\b(send|submit|post|reply|reply all|publish)\b/i,
    words: "send, submit, post, reply, publish",
  },
];

const ENTER_KEYS = new Set(["enter", "numpadenter", "return"]);

/** The browser actions that can commit something, and when. */
function commits(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === "browser_click") return true;
  if (toolName === "browser_press")
    return typeof args.key === "string" && ENTER_KEYS.has(args.key.toLowerCase());
  // Typing with `submit: true` presses Enter in the field afterwards.
  if (toolName === "browser_type") return args.submit === true;
  return false;
}

/** The kind an element's name implies, if any. Exposed for tests and the rules page. */
export function kindForElementName(name: string): EscalationPattern["kind"] | undefined {
  const tidy = name.replace(/\s+/g, " ").trim();
  if (!tidy) return undefined;
  for (const e of ESCALATIONS) if (e.pattern.test(tidy)) return e.kind;
  return undefined;
}

/**
 * The kind a browser action really has, given the element it touches. Returns undefined when the
 * action does not commit anything or the element's name says nothing more.
 *
 * - `browser_click` on an element named like Send / Pay / Delete / Sign.
 * - `browser_press` of Enter, judged by the focused element the computer reports.
 * - `browser_type` with `submit: true`, judged by the field typed into.
 */
export function escalateKind(
  toolName: string,
  args: Record<string, unknown>,
  element: { name?: string } | undefined,
): EscalationPattern["kind"] | undefined {
  if (!commits(toolName, args)) return undefined;
  const name = element?.name;
  if (typeof name !== "string") return undefined;
  return kindForElementName(name);
}
