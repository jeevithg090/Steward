/**
 * A program's arguments as a person types them: separated by spaces or new lines, with "double" or
 * 'single' quotes around one that has spaces in it, or a backslash before a space. The quotes are
 * not part of the argument. Steward starts the program with the list itself, never through a shell,
 * so nothing here is ever run as shell code.
 */
export interface ParsedArgs {
  args: string[];
  /** Set when the text can't be read as arguments, in words for the form. */
  error?: string;
}

/** Outside quotes, a backslash only escapes these, so a Windows path keeps its backslashes. */
const ESCAPABLE = new Set([" ", "\t", "\n", '"', "'", "\\"]);

export function splitArgs(text: string): ParsedArgs {
  const args: string[] = [];
  let current = "";
  // An argument is open once anything belongs to it, even an empty pair of quotes.
  let open = false;
  let quote: '"' | "'" | undefined;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      const next = text[i + 1];
      if (ch === "\\" && (next === '"' || next === "\\")) {
        current += next;
        i++;
      } else if (ch === '"') quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      open = true;
    } else if (ch === "\\" && i + 1 < text.length && ESCAPABLE.has(text[i + 1]!)) {
      current += text[i + 1];
      open = true;
      i++;
    } else if (/\s/.test(ch)) {
      if (open) args.push(current);
      current = "";
      open = false;
    } else {
      current += ch;
      open = true;
    }
  }
  if (quote) {
    return {
      args,
      error: `A ${quote === '"' ? "double" : "single"} quote isn't closed. Close it, or take it out.`,
    };
  }
  if (open) args.push(current);
  return { args };
}

/** The arguments as they would be typed: one with a space or a quote in it is shown in quotes. */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((arg) => {
      // Plain unless it has a space or a quote, or a backslash that would escape something.
      if (arg !== "" && !/[\s"']|\\(?=[\s"'\\]|$)/.test(arg)) return arg;
      if (arg.includes('"') && !arg.includes("'")) return `'${arg}'`;
      // Inside double quotes only a backslash before a quote, another backslash or the end needs one more.
      return `"${arg.replace(/\\(?=["\\]|$)/g, "\\\\").replace(/"/g, '\\"')}"`;
    })
    .join(" ");
}
