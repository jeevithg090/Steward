import { readFileSync } from "node:fs";
import { type PlistDict, type PlistValue, parsePlist, toXmlPlist } from "./plist.ts";

/**
 * Checks a workflow before it is signed. `shortcuts sign` crashes (exit 134) on input Apple's
 * migrator cannot read, and a file that signs can still fail on the phone, so this checks what can
 * be checked off the device: the XML parses back to the same values, every action is a known one,
 * every block that opens closes, and every variable points at an action that came before it.
 */

/** Actions Steward uses that Perspective Cuts' `actions.json` does not list, with where each was checked. */
export const EXTRA_ACTIONS: Record<string, string> = {
  "is.workflow.actions.conditional":
    "Tempo's build_shortcut.py and Perspective Cuts' compiler (control flow)",
  "is.workflow.actions.repeat.each": "Perspective Cuts' compiler (control flow)",
  "is.workflow.actions.choosefrommenu": "Perspective Cuts' compiler (control flow)",
  "is.workflow.actions.text.match.getgroup": "Tempo's build_shortcut.py",
};

const PREFIX = "is.workflow.actions.";
const BLOCKS = new Set([
  "is.workflow.actions.conditional",
  "is.workflow.actions.repeat.each",
  "is.workflow.actions.repeat.count",
  "is.workflow.actions.choosefrommenu",
]);

let known: Set<string> | undefined;

/** Identifiers from Perspective Cuts' MIT `actions.json` (reference data, iOS 26), plus `EXTRA_ACTIONS`. */
export function knownActions(): Set<string> {
  if (!known) {
    const file = new URL("../reference/perspective-cuts-actions.json", import.meta.url);
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      actions: Record<string, { identifier: string }>;
    };
    known = new Set([...Object.values(data.actions).map((a) => a.identifier), ...Object.keys(EXTRA_ACTIONS)]);
  }
  return known;
}

export interface Validation {
  ok: boolean;
  problems: string[];
  actions: number;
}

const isDict = (v: unknown): v is PlistDict =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  !(v instanceof Date) &&
  !(v instanceof Uint8Array);

function sameValue(a: PlistValue, b: PlistValue): boolean {
  if (a instanceof Date || b instanceof Date)
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return (
      a instanceof Uint8Array &&
      b instanceof Uint8Array &&
      a.length === b.length &&
      a.every((x, i) => x === b[i])
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]!))
    );
  }
  if (isDict(a) && isDict(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && sameValue(a[k]!, b[k]!));
  }
  return a === b;
}

/** Every `OutputUUID` mentioned anywhere under a value. */
function outputRefs(value: PlistValue, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) outputRefs(v, out);
  else if (isDict(value)) {
    if (value.Type === "ActionOutput" && typeof value.OutputUUID === "string") out.push(value.OutputUUID);
    for (const v of Object.values(value)) if (v !== undefined) outputRefs(v, out);
  }
  return out;
}

/** Validates a workflow given as values, or as XML text. */
export function validate(workflow: PlistDict | string): Validation {
  const problems: string[] = [];
  let value: PlistValue;
  try {
    if (typeof workflow === "string") value = parsePlist(workflow);
    else {
      value = workflow;
      const back = parsePlist(toXmlPlist(workflow));
      if (!sameValue(workflow, back))
        problems.push("The workflow does not survive a round trip through XML.");
    }
  } catch (err) {
    return { ok: false, problems: [`It is not a readable plist: ${(err as Error).message}`], actions: 0 };
  }
  if (!isDict(value)) return { ok: false, problems: ["The plist is not a dictionary."], actions: 0 };
  const actions = value.WFWorkflowActions;
  if (!Array.isArray(actions)) return { ok: false, problems: ["WFWorkflowActions is missing."], actions: 0 };
  for (const key of ["WFWorkflowClientVersion", "WFWorkflowMinimumClientVersion", "WFWorkflowIcon"]) {
    if (!(key in value)) problems.push(`${key} is missing.`);
  }

  const names = knownActions();
  const seen = new Set<string>();
  const open: { id: string; grouping: string; at: number }[] = [];
  actions.forEach((raw, index) => {
    const at = `Action ${index + 1}`;
    if (!isDict(raw)) {
      problems.push(`${at} is not a dictionary.`);
      return;
    }
    const id = raw.WFWorkflowActionIdentifier;
    const params = raw.WFWorkflowActionParameters;
    if (typeof id !== "string" || !id.startsWith(PREFIX)) {
      problems.push(`${at} has no is.workflow.actions identifier.`);
      return;
    }
    if (!names.has(id)) problems.push(`${at} (${id}) is not a known action.`);
    if (!isDict(params)) {
      problems.push(`${at} (${id}) has no parameters dictionary.`);
      return;
    }
    for (const ref of outputRefs(params)) {
      if (!seen.has(ref))
        problems.push(`${at} (${id}) uses the output of an action that does not come before it.`);
    }
    if (typeof params.UUID === "string") {
      if (seen.has(params.UUID)) problems.push(`${at} repeats the UUID ${params.UUID}.`);
      seen.add(params.UUID);
    }
    if (BLOCKS.has(id)) {
      const grouping = params.GroupingIdentifier;
      const mode = params.WFControlFlowMode;
      if (typeof grouping !== "string") {
        problems.push(`${at} (${id}) has no GroupingIdentifier.`);
        return;
      }
      if (mode === 0) open.push({ id, grouping, at: index + 1 });
      else {
        const top = open.at(-1);
        if (!top || top.grouping !== grouping || top.id !== id) {
          problems.push(`${at} (${id}) closes or splits a block that is not the innermost open one.`);
        } else if (mode === 2) open.pop();
        else if (mode !== 1) problems.push(`${at} (${id}) has WFControlFlowMode ${String(mode)}.`);
      }
    }
  });
  for (const block of open) problems.push(`The ${block.id} block opened at action ${block.at} never closes.`);
  return { ok: problems.length === 0, problems, actions: actions.length };
}
