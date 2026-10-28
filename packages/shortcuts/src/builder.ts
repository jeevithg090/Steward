// Ported from Tempo's apps/shortcuts/build_shortcut.py (the same team's code), with control flow
// encodings checked against Perspective Cuts' compiler (MIT, Copyright (c) 2026 Taylor Arndt).
/**
 * Builds a Shortcuts workflow as plist values: actions, text with variables in it, dictionaries,
 * and the control flow blocks (if, repeat, menu) that open and close with a shared grouping id.
 *
 * Identifiers and parameter keys come from `reference/perspective-cuts-actions.json`; anything not
 * listed there is named in `EXTRA_ACTIONS` with where it was checked. Apple renames actions between
 * iOS releases, so the shipped file is re-made and re-signed per release, not typed from memory.
 */
import type { PlistDict } from "./plist.ts";

export type Token = PlistDict;
export interface Action extends PlistDict {
  WFWorkflowActionIdentifier: string;
  WFWorkflowActionParameters: PlistDict;
}

/** WFCondition codes for `conditional`. */
export const Condition = {
  equals: 4,
  notEquals: 5,
  contains: 99,
  greaterThan: 2,
  lessThan: 3,
  hasAnyValue: 100,
  hasNoValue: 101,
} as const;

let counter = 0;
/** Upper-case UUIDs, as Shortcuts writes them. Deterministic in tests through `resetIds`. */
let makeId: () => string = () => crypto.randomUUID().toUpperCase();

export function resetIds(deterministic: boolean): void {
  counter = 0;
  makeId = deterministic
    ? () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`
    : () => crypto.randomUUID().toUpperCase();
}

export function newId(): string {
  return makeId();
}

// ── Values that point at other values ──────────────────────────────────────────────────────

/** The output of an earlier action, by its UUID and the name Shortcuts shows for it. */
export const output = (uuid: string, name: string): Token => ({
  Type: "ActionOutput",
  OutputUUID: uuid,
  OutputName: name,
});

/** A named variable set with `setvariable`, or a magic one such as `Repeat Item`. */
export const variable = (name: string): Token => ({ Type: "Variable", VariableName: name });

/** What the shortcut was run with: share sheet content, a `run-shortcut` text, or a launcher's text. */
export const SHORTCUT_INPUT: Token = { Type: "ExtensionInput" };
export const REPEAT_ITEM: Token = variable("Repeat Item");

/** A single variable as a whole parameter. */
export const attachment = (value: Token): PlistDict => ({
  Value: value,
  WFSerializationType: "WFTextTokenAttachment",
});

/** Text with variables in it. U+FFFC marks each variable; ranges count UTF-16 code units. */
export function text(...parts: (string | Token)[]): PlistDict {
  let string = "";
  const attachments: PlistDict = {};
  for (const part of parts) {
    if (typeof part === "string") string += part;
    else {
      attachments[`{${string.length}, 1}`] = part;
      string += "￼";
    }
  }
  return {
    Value: { string, attachmentsByRange: attachments },
    WFSerializationType: "WFTextTokenString",
  };
}

/** A dictionary editor (Dictionary action, JSON body, headers). Every value is text. */
export function fields(items: [string, PlistDict][]): PlistDict {
  return {
    Value: {
      WFDictionaryFieldValueItems: items.map(([key, value]) => ({
        WFItemType: 0,
        WFKey: text(key),
        WFValue: value,
      })),
    },
    WFSerializationType: "WFDictionaryFieldValue",
  };
}

export function act(identifier: string, parameters: PlistDict = {}): Action {
  return {
    WFWorkflowActionIdentifier: `is.workflow.actions.${identifier}`,
    WFWorkflowActionParameters: parameters,
  };
}

/** A condition's left-hand side: a variable wrapped the way `conditional` wants it. */
const conditionInput = (value: Token): PlistDict => ({ Type: "Variable", Variable: attachment(value) });

// ── The builder ────────────────────────────────────────────────────────────────────────────

export class Builder {
  readonly actions: Action[] = [];

  /** Adds an action that has an output, and returns its UUID. */
  add(identifier: string, parameters: PlistDict = {}): string {
    const uuid = newId();
    this.actions.push(act(identifier, { UUID: uuid, ...parameters }));
    return uuid;
  }

  /** Adds an action whose output nothing uses. */
  run(identifier: string, parameters: PlistDict = {}): void {
    this.actions.push(act(identifier, parameters));
  }

  comment(words: string): void {
    this.run("comment", { WFCommentActionText: words });
  }

  /** Text from parts, as an action, returning its output token. */
  text(...parts: (string | Token)[]): Token {
    return output(this.add("gettext", { WFTextActionText: text(...parts) }), "Text");
  }

  set(name: string, value: Token): void {
    this.run("setvariable", { WFVariableName: name, WFInput: attachment(value) });
  }

  /** `Get Dictionary from Input`. */
  dictionary(value: Token): Token {
    return output(this.add("detect.dictionary", { WFInput: attachment(value) }), "Dictionary");
  }

  /** `Get Dictionary Value` for one key. */
  valueFor(dictionary: Token, key: string): Token {
    return output(
      this.add("getvalueforkey", {
        WFInput: attachment(dictionary),
        WFGetDictionaryValueType: "Value",
        WFDictionaryKey: text(key),
      }),
      "Dictionary Value",
    );
  }

  /** `Match Text` with an ICU pattern. Its output is the list of matches. */
  match(input: Token, pattern: string, caseSensitive = true): Token {
    return output(
      this.add("text.match", {
        WFMatchTextPattern: pattern,
        WFMatchTextCaseSensitive: caseSensitive,
        text: text(input),
      }),
      "Matches",
    );
  }

  group(matches: Token, index: number): Token {
    return output(
      this.add("text.match.getgroup", {
        matches: attachment(matches),
        WFGetGroupType: "Group At Index",
        WFGroupIndex: index,
      }),
      "Group",
    );
  }

  replace(input: Token, find: string, replacement: string): Token {
    return output(
      this.add("text.replace", {
        WFInput: text(input),
        WFReplaceTextFind: find,
        WFReplaceTextReplace: replacement,
        WFReplaceTextRegularExpression: false,
        WFReplaceTextCaseSensitive: true,
      }),
      "Updated Text",
    );
  }

  /** Opens an If block and returns its grouping id. `compareTo` may be text or another value. */
  if(value: Token, condition: number, compareTo?: string | Token): string {
    const grouping = newId();
    this.run("conditional", {
      GroupingIdentifier: grouping,
      WFControlFlowMode: 0,
      WFCondition: condition,
      WFInput: conditionInput(value),
      ...(compareTo !== undefined ? { WFConditionalActionString: text(compareTo) } : {}),
    });
    return grouping;
  }

  otherwise(grouping: string): void {
    this.run("conditional", { GroupingIdentifier: grouping, WFControlFlowMode: 1 });
  }

  endIf(grouping: string): void {
    this.add("conditional", { GroupingIdentifier: grouping, WFControlFlowMode: 2 });
  }

  /** `Repeat with Each`. Inside, `REPEAT_ITEM` is the current item. Returns the grouping id. */
  repeatEach(list: Token): string {
    const grouping = newId();
    this.run("repeat.each", {
      GroupingIdentifier: grouping,
      WFControlFlowMode: 0,
      WFInput: attachment(list),
    });
    return grouping;
  }

  /** Closes a repeat; its output is the list of what each pass ended with. */
  endRepeat(grouping: string): Token {
    return output(
      this.add("repeat.each", { GroupingIdentifier: grouping, WFControlFlowMode: 2 }),
      "Repeat Results",
    );
  }

  /** `Choose from Menu` with fixed items. Call `item(label)` before each case's actions, then `end()`. */
  menu(prompt: PlistDict, labels: string[]): { item(label: string): void; end(): void } {
    const grouping = newId();
    this.run("choosefrommenu", {
      GroupingIdentifier: grouping,
      WFControlFlowMode: 0,
      WFMenuPrompt: prompt,
      WFMenuItems: labels,
    });
    return {
      item: (label) => {
        if (!labels.includes(label)) throw new Error(`"${label}" is not one of this menu's items.`);
        this.run("choosefrommenu", {
          GroupingIdentifier: grouping,
          WFControlFlowMode: 1,
          WFMenuItemTitle: label,
        });
      },
      end: () => {
        this.add("choosefrommenu", { GroupingIdentifier: grouping, WFControlFlowMode: 2 });
      },
    };
  }

  /** Stops when `value` has no value (or any value), with words shown first. */
  stopIf(value: Token, condition: number, ...words: (string | Token)[]): void {
    const grouping = this.if(value, condition);
    if (words.length > 0) this.show(...words);
    this.exit();
    this.otherwise(grouping);
    this.endIf(grouping);
  }

  /** `Show Result`: shown on screen, and read aloud when Siri ran the shortcut. */
  show(...parts: (string | Token)[]): void {
    this.run("showresult", { Text: text(...parts) });
  }

  exit(): void {
    this.run("exit");
  }
}
