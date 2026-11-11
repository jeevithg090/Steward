import { buildContext, CelEngine, CONTEXT_SCHEMA, neutralContext, prepareCall } from "@steward/gateway";
import { type GateCall, type TenantPackage, TOOLS, type ToolKind } from "@steward/shared";

/**
 * The checks a tenant's `rules.yaml` gets at load time, before the gateway sees it:
 *
 * - every condition compiles, so a typo stops start-up with the file and the rule named instead of
 *   refusing every call later;
 * - names are unique, because the gateway matches tenant rules by name on every start;
 * - an allow rule never lets Steward send, pay, sign, delete or run a command without asking. A
 *   package can be stricter than Steward, never looser. One that plainly would (it matches such a
 *   call whatever the arguments) is refused with a plain sentence, and every allow rule is limited
 *   to reads and writes, so one that would only for some arguments (`args.to == "boss@acme.example"`)
 *   still never covers a send.
 */

type TenantRule = TenantPackage["rules"][number];

/** The kinds that ask by default and that no allow rule from a package may lift. */
const ASKING_KINDS: ReadonlySet<ToolKind> = new Set(["send", "pay", "sign", "delete", "shell"]);

/** Put in front of every tenant allow rule: it can match reads, display and writes, nothing else. */
export const TENANT_ALLOW_GUARD = 'tool.kind in ["read", "ui", "write"]';

/** The longest condition the gateway stores. */
const MAX_WHEN = 2000;

/** Words for what each asking kind does, for the error message. */
const KIND_WORDS: Record<string, string> = {
  send: "send",
  pay: "pay",
  sign: "sign",
  delete: "delete",
  shell: "run a command",
};

interface Probe {
  call: GateCall;
  /** What the probe stands for, in the error: "mail_send", "a click on Send". */
  label: string;
}

function probeCall(
  tool: { name: string; kind?: ToolKind; surface?: string; source?: string },
  extra: Partial<GateCall> = {},
): GateCall {
  return {
    toolCallId: "probe",
    runId: "probe",
    threadId: "probe",
    agentId: "",
    actorId: "local",
    initiator: { kind: "person", id: "local" },
    tool: tool as GateCall["tool"],
    args: {},
    target: {},
    tainted: false,
    ...extra,
  };
}

/** Calls of every asking kind, the way the gateway will see them. */
function askingProbes(): Probe[] {
  const probes: Probe[] = [];
  for (const kind of ASKING_KINDS) {
    for (const [name, entry] of Object.entries(TOOLS)) {
      if (entry.kind === kind) probes.push({ call: probeCall({ name }), label: name });
    }
  }
  // A click, a key press or typing with submit on a button named like Send counts as sending.
  const buttons: [string, string][] = [
    ["Send", "send"],
    ["Pay now", "pay"],
    ["Sign", "sign"],
    ["Delete", "delete"],
  ];
  for (const [button] of buttons) {
    const element = { ref: "e1", role: "button", name: button };
    probes.push(
      {
        call: probeCall({ name: "browser_click" }, { args: { ref: "e1" }, target: { element } }),
        label: `a click on "${button}"`,
      },
      {
        call: probeCall(
          { name: "browser_press" },
          { args: { ref: "e1", key: "Enter" }, target: { element } },
        ),
        label: `pressing Enter on "${button}"`,
      },
    );
  }
  // A connected app's tool and an external coding agent's command can be of any kind.
  for (const kind of ASKING_KINDS) {
    probes.push(
      {
        call: probeCall({ name: "mcp__app__tool", kind, surface: "mcp", source: "mcp:app" }),
        label: `a connected app's tool that would ${KIND_WORDS[kind]}`,
      },
      {
        call: probeCall({ name: "tool", kind, surface: "system", source: "harness:probe" }),
        label: `a coding agent's request to ${KIND_WORDS[kind]}`,
      },
    );
  }
  return probes;
}

let cachedProbes: Probe[] | undefined;

/** The first asking call an allow rule would let through, whoever started it and whichever agent runs it. */
function firstLoosened(engine: CelEngine, when: string, agentIds: readonly string[]): Probe | undefined {
  cachedProbes ??= askingProbes();
  for (const probe of cachedProbes) {
    const prepared = prepareCall(probe.call);
    if (!ASKING_KINDS.has(prepared.tool.kind)) continue;
    for (const initiator of ["person", "routine"] as const) {
      for (const agentId of ["", ...agentIds]) {
        const context = buildContext(
          {
            ...prepared,
            agentId,
            initiator: { kind: initiator, id: initiator === "person" ? "local" : "probe" },
          },
          [],
          { hide: prepared.hiddenArgs, keep: prepared.keptArgs },
        );
        let matched = false;
        try {
          matched = engine.test(when, context);
        } catch {
          // A rule that cannot be evaluated for a call refuses that call: not looser.
        }
        if (matched) return probe;
      }
    }
  }
  return undefined;
}

/** Why a condition cannot be used, without the gateway's own "This rule cannot be used:" opening. */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^This rule cannot be used:\s*/, "").replace(/\.$/, "");
}

/**
 * Checks the rules from `rules.yaml` and returns them as the gateway should store them. Calls
 * `fail` with where the problem is (`rules[1] "Calendar runs"`) and a plain sentence when one
 * cannot be used.
 */
export function checkTenantRules(
  rules: readonly TenantRule[],
  agentIds: readonly string[],
  fail: (path: PropertyKey[], where: string, message: string) => never,
): TenantRule[] {
  const engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
  const names = new Set<string>();
  return rules.map((rule, i) => {
    const name = rule.name.trim();
    const where = `rules[${i}] "${name}"`;
    if (!name) fail(["rules", i, "name"], `rules[${i}].name`, "needs some text");
    if (names.has(name)) fail(["rules", i, "name"], `rules[${i}].name`, `"${name}" is used twice`);
    names.add(name);

    try {
      engine.validate(rule.when);
    } catch (error) {
      fail(["rules", i, "when"], where, reasonOf(error));
    }
    if (rule.effect !== "allow") return { ...rule, name };

    const loosened = firstLoosened(engine, rule.when, agentIds);
    if (loosened) {
      fail(
        ["rules", i, "effect"],
        where,
        `an allow rule cannot let Steward send, pay, sign, delete or run a command without asking you, and this one would allow ${loosened.label}. Use effect: ask or deny for those, or narrow "when", for example with tool.kind == "write"`,
      );
    }
    // The closing bracket goes on its own line, so a `//` comment at the end cannot swallow it.
    const when = `${TENANT_ALLOW_GUARD} && (${rule.when}\n)`;
    if (when.length > MAX_WHEN) {
      fail(
        ["rules", i, "when"],
        `rules[${i}].when`,
        `an allow rule's condition can be at most ${MAX_WHEN - TENANT_ALLOW_GUARD.length - 7} characters`,
      );
    }
    return { ...rule, name, when };
  });
}
