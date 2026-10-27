/**
 * The decision: one pure function from a call and the rules to allow, ask or deny.
 *
 * Precedence (PLAN §4.6), first match wins:
 *   1. deny rules
 *   2. the safety floor: payments and credential entry always ask, never "Always allow"
 *   3. taint: after reading untrusted content, send/pay/sign/delete/shell always ask
 *   4. the outbound check: any finding asks, with the findings on the card
 *   5. ask rules
 *   6. allow rules (presets, tenant, person, always)
 *   7. defaults by kind
 * A rule that cannot be evaluated refuses the call and names itself. Any other error refuses.
 */
import type { Decision, GateCall, OutboundFinding, Rule, Target, ToolKind } from "@steward/shared";
import { type CelEngine, RuleEvaluationError } from "./cel.ts";
import { buildContext } from "./context.ts";
import { messageOf } from "./errors.ts";
import { escalateKind } from "./escalate.ts";
import { describeFindings, scanOutbound } from "./outbound.ts";
import { completeTarget, stricterKind, toolInfo } from "./target.ts";

/** A call as the gateway judges it: catalogue kind, escalation applied, target completed. */
export interface PreparedCall extends GateCall {
  /** The kind before escalation, when an element's name raised it. */
  escalatedFrom?: ToolKind;
  /** Arguments that are secrets for this call and never shown or recorded (`text` typed into a password field). */
  hiddenArgs: ReadonlySet<string>;
  /** Arguments that look secret by name but are not, for this tool (`key` for `browser_press`). */
  keptArgs: ReadonlySet<string>;
  /** Entering a password, code or card number. Part of the safety floor. */
  credentialEntry: boolean;
}

/** Field names that mean "this is a secret": typing into one is credential entry. */
const CREDENTIAL_FIELD =
  /pass(word|code|phrase)|passwd|\bpin\b|one[- ]?time|\botp\b|\b2fa\b|two[- ]?factor|verification code|security code|auth(entication)? code|\bcvv\b|\bcvc\b|\bcsc\b|card number|card no|credit card|debit card|expiry|expiration|\biban\b|account number|sort code|routing number|social security|\bssn\b/i;

const SECRET_TOOLS = new Set(["request_secret"]);

/**
 * Typing into a secret field: one the computer judged secret by its type or autocomplete (so a
 * "Passwort" or unlabelled password box counts), or one named like a secret.
 */
export function typesIntoSecret(toolName: string, element: Target["element"] | undefined): boolean {
  if (toolName !== "browser_type") return false;
  if (element?.sensitive === true) return true;
  return typeof element?.name === "string" && CREDENTIAL_FIELD.test(element.name);
}

export function prepareCall(call: GateCall): PreparedCall {
  const args = call.args && typeof call.args === "object" ? call.args : {};
  const tool = toolInfo(call.tool?.name ?? "", call.tool);
  const target = completeTarget(tool.name, args, call.target);
  const escalated = escalateKind(tool.name, args, target.element);
  const kind = escalated ? stricterKind(tool.kind, escalated) : tool.kind;

  const typingIntoSecret = typesIntoSecret(tool.name, target.element);
  const credentialEntry = SECRET_TOOLS.has(tool.name) || typingIntoSecret;
  const hiddenArgs = new Set<string>();
  if (SECRET_TOOLS.has(tool.name)) hiddenArgs.add("value");
  if (typingIntoSecret) {
    hiddenArgs.add("text");
    hiddenArgs.add("value");
  }
  const keptArgs = new Set<string>(tool.name === "browser_press" ? ["key"] : []);

  return {
    ...call,
    args,
    tool: { ...tool, kind },
    target,
    initiator: call.initiator ?? { kind: "person", id: call.actorId ?? "" },
    tainted: call.tainted === true,
    ...(kind !== tool.kind ? { escalatedFrom: tool.kind } : {}),
    hiddenArgs,
    keptArgs,
    credentialEntry,
  };
}

/** A built-in step of the decision, named so the record and the rules page can say which. */
export interface BuiltinRule {
  id: string;
  name: string;
  reason: string;
}

export const BUILTIN = {
  floorPay: {
    id: "default:floor-pay",
    name: "Payments always ask",
    reason: "Paying for anything always needs your answer, every time",
  },
  floorCredential: {
    id: "default:floor-credential",
    name: "Passwords and secrets always ask",
    reason: "Entering a password, code or card number always needs your answer, every time",
  },
  taint: {
    id: "default:taint",
    name: "Untrusted content asks",
    reason:
      "This conversation has read web pages, mail or other content that could carry someone else's instructions, so anything that sends, pays, signs, deletes or runs a command needs your answer",
  },
  taintPersists: {
    id: "default:taint-persists",
    name: "Untrusted content asks before anything lasting",
    reason:
      "This conversation has read content that could carry someone else's instructions, so saving a memory or a routine that would shape later work needs your answer",
  },
  outbound: {
    id: "default:outbound-check",
    name: "Sensitive details ask",
    reason: "",
  },
  readRuns: { id: "default:read-runs", name: "Reads run", reason: "Reading does not change anything" },
  uiRuns: {
    id: "default:ui-runs",
    name: "Showing things runs",
    reason: "Showing something on screen changes nothing",
  },
  writeRuns: {
    id: "default:write-runs",
    name: "Work on Steward's own computer runs",
    reason: "Changes to Steward's own browser, files, memory and tasks run without asking",
  },
  writeAsks: {
    id: "default:write-asks",
    name: "Changes elsewhere ask",
    reason: "Changes to your calendar, mail or connected services ask first",
  },
  sendAsks: { id: "default:send-asks", name: "Sending asks", reason: "Sending anything asks first" },
  signAsks: { id: "default:sign-asks", name: "Signing asks", reason: "Signing anything asks first" },
  deleteAsks: { id: "default:delete-asks", name: "Deleting asks", reason: "Deleting anything asks first" },
  shellAsks: { id: "default:shell-asks", name: "Commands ask", reason: "Running a command asks first" },
  payAsks: { id: "default:pay-asks", name: "Payments ask", reason: "Paying asks first" },
  error: {
    id: "default:error",
    name: "Could not check",
    reason: "Steward could not check this call safely, so it was refused",
  },
  answerOnce: { id: "default:answer-once", name: "You allowed it", reason: "You allowed this once" },
  answerRefused: { id: "default:answer-refused", name: "You refused it", reason: "You refused this" },
  answerCheck: {
    id: "default:answer-check",
    name: "Answers act once",
    reason: "An answer acts once, on the exact call it was given for",
  },
} as const satisfies Record<string, BuiltinRule>;

/** Surfaces where a write is Steward's own business: its browser, its files, its memory, its tasks. */
const OWN_SURFACES = new Set(["browser", "file", "memory", "task"]);
const TAINT_KINDS = new Set<ToolKind>(["send", "pay", "sign", "delete", "shell"]);
/**
 * Tools whose effect outlives the conversation: injected text saved as a memory or a routine would
 * reach every later run. After untrusted content they ask too.
 */
const TAINT_PERSISTS = new Set(["memory_remember", "routine_create"]);

/** The outcome of deciding: the decision itself, plus what the approval layer needs. */
export interface Verdict {
  decision: Decision;
  /** Whether "Always allow" may be offered if this asks. */
  canAlways: boolean;
  call: PreparedCall;
}

/** A built-in step as a decision's `rule`. The person's own answers carry source `person`. */
export function builtinRef(
  b: BuiltinRule,
  source: "preset" | "person" = "preset",
): NonNullable<Decision["rule"]> {
  return { id: b.id, name: b.name, source };
}

function ruleRef(r: Rule): NonNullable<Decision["rule"]> {
  return { id: r.id, name: r.name, source: r.source };
}

/** Ends a reason without a trailing full stop, so messages can add their own punctuation. */
export function bare(reason: string): string {
  return reason.trim().replace(/[.\s]+$/, "");
}

const SOURCE_ORDER: Record<Rule["source"], number> = { preset: 0, tenant: 1, person: 2, always: 3 };

/** Rules in the order they are tried within a step: presets, tenant, person, always, oldest first. */
export function orderRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort(
    (a, b) =>
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

type RuleMatch = { rule: Rule; matched: true } | { rule: Rule; matched: false; error: string } | undefined;

/** The first rule of `effect` that matches or cannot be evaluated. */
function firstRule(
  engine: CelEngine,
  rules: readonly Rule[],
  effect: Rule["effect"],
  context: Record<string, unknown>,
): RuleMatch {
  for (const rule of rules) {
    if (!rule.enabled || rule.effect !== effect) continue;
    try {
      if (engine.test(rule.when, context)) return { rule, matched: true };
    } catch (err) {
      const why = err instanceof RuleEvaluationError ? err.message : "it could not be evaluated";
      return { rule, matched: false, error: why };
    }
  }
  return undefined;
}

function brokenRule(rule: Rule, error: string, findings: OutboundFinding[]): Decision {
  return {
    effect: "deny",
    rule: ruleRef(rule),
    reason: `The rule '${rule.name}' could not be checked (${bare(error)}), so this was refused to be safe`,
    findings,
  };
}

function defaultFor(call: PreparedCall): BuiltinRule & { effect: "allow" | "ask" } {
  switch (call.tool.kind) {
    case "read":
      return { ...BUILTIN.readRuns, effect: "allow" };
    case "ui":
      return { ...BUILTIN.uiRuns, effect: "allow" };
    case "send":
      return { ...BUILTIN.sendAsks, effect: "ask" };
    case "sign":
      return { ...BUILTIN.signAsks, effect: "ask" };
    case "delete":
      return { ...BUILTIN.deleteAsks, effect: "ask" };
    case "shell":
      return { ...BUILTIN.shellAsks, effect: "ask" };
    case "pay":
      return { ...BUILTIN.payAsks, effect: "ask" };
    default:
      return OWN_SURFACES.has(call.tool.surface)
        ? { ...BUILTIN.writeRuns, effect: "allow" }
        : { ...BUILTIN.writeAsks, effect: "ask" };
  }
}

function denyDecision(match: NonNullable<RuleMatch>, findings: OutboundFinding[]): Decision {
  if (!match.matched) return brokenRule(match.rule, match.error, findings);
  return {
    effect: "deny",
    rule: ruleRef(match.rule),
    reason: bare(match.rule.description) || `The rule '${match.rule.name}' does not allow this`,
    findings,
  };
}

/** Deny rules only. Run again just before a resumed call acts, in case a rule was added since it asked. */
export function denyCheck(
  engine: CelEngine,
  rules: readonly Rule[],
  call: PreparedCall,
  findings: OutboundFinding[],
): Decision | undefined {
  const context = buildContext(call, findings, { hide: call.hiddenArgs, keep: call.keptArgs });
  const deny = firstRule(engine, orderRules(rules), "deny", context);
  return deny ? denyDecision(deny, findings) : undefined;
}

/** Decides a prepared call. Never throws: an error is a refusal. */
export function decidePrepared(engine: CelEngine, rules: readonly Rule[], call: PreparedCall): Verdict {
  let findings: OutboundFinding[] = [];
  try {
    findings = scanOutbound(call);
  } catch (err) {
    return {
      call,
      canAlways: false,
      decision: {
        effect: "deny",
        rule: builtinRef(BUILTIN.error),
        reason: `What this would send could not be checked (${bare(messageOf(err))}), so it was refused to be safe`,
        findings: [],
      },
    };
  }

  try {
    const ordered = orderRules(rules);
    const context = buildContext(call, findings, { hide: call.hiddenArgs, keep: call.keptArgs });

    // 1. Deny rules.
    const deny = firstRule(engine, ordered, "deny", context);
    if (deny) return { call, canAlways: false, decision: denyDecision(deny, findings) };

    const ask = (b: BuiltinRule, reason = b.reason): Verdict => ({
      call,
      canAlways: false,
      decision: { effect: "ask", rule: builtinRef(b), reason, findings },
    });

    // 2. The safety floor.
    if (call.tool.kind === "pay") return ask(BUILTIN.floorPay);
    if (call.credentialEntry) return ask(BUILTIN.floorCredential);

    // 3. Taint.
    if (call.tainted && TAINT_KINDS.has(call.tool.kind)) return ask(BUILTIN.taint);
    if (call.tainted && TAINT_PERSISTS.has(call.tool.name)) return ask(BUILTIN.taintPersists);

    // 4. What leaves.
    if (findings.length > 0) {
      return ask(
        BUILTIN.outbound,
        `This would send ${describeFindings(findings)} out of Steward. Check it before it goes`,
      );
    }

    // 5. Ask rules. An Always allow could never lift them (they outrank allow rules), so it is not offered.
    const asked = firstRule(engine, ordered, "ask", context);
    if (asked) {
      if (!asked.matched)
        return { call, canAlways: false, decision: brokenRule(asked.rule, asked.error, findings) };
      return {
        call,
        canAlways: false,
        decision: {
          effect: "ask",
          rule: ruleRef(asked.rule),
          reason: bare(asked.rule.description) || `The rule '${asked.rule.name}' asks first`,
          findings,
        },
      };
    }

    // 6. Allow rules.
    const allowed = firstRule(engine, ordered, "allow", context);
    if (allowed) {
      if (!allowed.matched) {
        return { call, canAlways: false, decision: brokenRule(allowed.rule, allowed.error, findings) };
      }
      return {
        call,
        canAlways: false,
        decision: {
          effect: "allow",
          rule: ruleRef(allowed.rule),
          reason: bare(allowed.rule.description) || `Allowed by the rule '${allowed.rule.name}'`,
          findings,
        },
      };
    }

    // 7. Defaults by kind.
    const d = defaultFor(call);
    return {
      call,
      canAlways: d.effect === "ask",
      decision: { effect: d.effect, rule: builtinRef(d), reason: d.reason, findings },
    };
  } catch (err) {
    return {
      call,
      canAlways: false,
      decision: {
        effect: "deny",
        rule: builtinRef(BUILTIN.error),
        reason: `${BUILTIN.error.reason} (${bare(messageOf(err))})`,
        findings,
      },
    };
  }
}

/** Prepares and decides. Never throws. */
export function decide(engine: CelEngine, rules: readonly Rule[], call: GateCall): Verdict {
  let prepared: PreparedCall;
  try {
    prepared = prepareCall(call);
  } catch (err) {
    const fallback = {
      ...call,
      args: {},
      target: {},
      hiddenArgs: new Set<string>(),
      keptArgs: new Set<string>(),
      credentialEntry: false,
    } as PreparedCall;
    return {
      call: fallback,
      canAlways: false,
      decision: {
        effect: "deny",
        rule: builtinRef(BUILTIN.error),
        reason: `${BUILTIN.error.reason} (${bare(messageOf(err))})`,
        findings: [],
      },
    };
  }
  return decidePrepared(engine, rules, prepared);
}
