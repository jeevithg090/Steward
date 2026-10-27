/**
 * Escalation: a click is not always just a click.
 *
 * Browser actions are writes, and writes on the agent's own browser run freely. But clicking a
 * button named "Place order" pays, "Send" sends and "Delete account" deletes. Before deciding, the
 * gateway reads the name of the element the action touches (from the computer's own snapshot,
 * never from the model) and raises the kind to match. The list lives here, in one place, with tests.
 */
import type { ToolKind } from "@steward/shared";
import { stricterKind } from "./target.ts";

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

/**
 * Keys that activate what has focus: Enter submits a form and presses a focused button; Space
 * presses a focused button. A combination counts by its last key, so "Control+Enter" (send in
 * many mail and chat apps) commits too.
 */
const COMMIT_KEYS = new Set(["enter", "numpadenter", "return", " ", "space", "spacebar"]);

function isCommitKey(key: unknown): boolean {
  if (typeof key !== "string" || key === "") return false;
  // A combination ending in "+" ("Shift++") is the plus key, not a separator.
  const last = key.endsWith("+") ? "+" : (key.split("+").pop() ?? "");
  return COMMIT_KEYS.has(last.toLowerCase());
}

/** The browser actions that can commit something, and when. */
function commits(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === "browser_click") return true;
  if (toolName === "browser_press") return isCommitKey(args.key);
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

/** What escalation reads of the element: its name, and for a key press the control it activates. */
export interface EscalationElement {
  name?: string;
  submitter?: { name?: string };
}

function usable(name: unknown): name is string {
  return typeof name === "string" && name.trim() !== "";
}

function kindOf(name: unknown): EscalationPattern["kind"] | undefined {
  return usable(name) ? kindForElementName(name) : undefined;
}

/**
 * The kind a browser action really has, given the element it touches. Returns undefined when the
 * action does not commit anything or the element's name says nothing more.
 *
 * - `browser_click` on an element named like Send / Pay / Delete / Sign.
 * - `browser_press` of Enter or Space (alone or with modifiers), and `browser_type` with
 *   `submit: true`: judged by the control the key activates (`element.submitter`, which the
 *   computer reports) and by the focused or typed-into element itself; the stricter wins. When the
 *   computer named neither, nobody knows what the key will do, so it is at least a send: it asks by
 *   default and always after untrusted content.
 */
export function escalateKind(
  toolName: string,
  args: Record<string, unknown>,
  element: EscalationElement | undefined,
): EscalationPattern["kind"] | undefined {
  if (!commits(toolName, args)) return undefined;
  if (toolName === "browser_click") return kindOf(element?.name);
  const submitterName = element?.submitter?.name;
  if (!usable(submitterName) && !usable(element?.name)) return "send";
  const bySubmitter = kindOf(submitterName);
  const byElement = kindOf(element?.name);
  if (!bySubmitter || !byElement) return bySubmitter ?? byElement;
  return stricterKind(bySubmitter, byElement) as EscalationPattern["kind"];
}
