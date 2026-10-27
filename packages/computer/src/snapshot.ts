/**
 * Adapted from openbot/agent-computer/src/aria-snapshot.ts and secret-masking.ts (MIT, CopilotKit).
 *
 * Turns Playwright's AI snapshot (`page.ariaSnapshotJSON({ mode: "ai" })`) into the compact text
 * the model reads, with `[ref=eN]` on everything it can act on.
 *
 * Two things differ from the raw Playwright output, both on purpose:
 *
 * - **Refs are Steward's, not Playwright's.** Playwright numbers refs per document, so after a
 *   navigation `e5` names a different element. A model holding an old `e5` would click the wrong
 *   thing. Steward hands out refs that are unique for the life of the computer and keeps the map to
 *   Playwright's own, so an old ref is simply unknown: a clear "stale ref" instead of a wrong click.
 * - **Field values are masked** when the field is a password, one-time code or card field, or one
 *   the secret box filled. Playwright reports those values in clear text.
 */

export const SECRET_ATTRIBUTE = "data-steward-secret";
export const MASKED_VALUE = "[hidden: sensitive field]";
export const SENSITIVE_FIELD_SELECTOR = [
  "input[type=password]",
  'input[autocomplete~="one-time-code"]',
  'input[autocomplete~="current-password"]',
  'input[autocomplete~="new-password"]',
  'input[autocomplete~="cc-number"]',
  'input[autocomplete~="cc-csc"]',
  'input[autocomplete~="cc-exp"]',
  `[${SECRET_ATTRIBUTE}]`,
].join(", ");

/** Default size of the text the model gets. About 3k tokens. */
export const SNAPSHOT_CHAR_LIMIT = 12_000;

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);
/** Roles whose `text` is a value the person or the page typed, so it may need masking. */
export const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const WRAPPER_ROLES = new Set(["generic", "none", "presentation"]);

const NAME_LIMIT = 200;
const TEXT_LIMIT = 400;
const URL_LIMIT = 120;
const OPTION_LIMIT = 25;

export interface AriaNode {
  role: string;
  name?: string;
  ref?: string;
  text?: string;
  url?: string;
  placeholder?: string;
  cursor?: string;
  checked?: boolean | "mixed";
  disabled?: boolean;
  selected?: boolean;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  level?: number;
  /** Has keyboard focus. Playwright marks the focused element and every frame and body above it. */
  active?: boolean;
  box?: { x: number; y: number; width: number; height: number };
  children?: AriaItem[];
}
export type AriaItem = AriaNode | string;

/** What Steward remembers about one ref it handed out. */
export interface RefEntry {
  /** Playwright's ref for the element, used with `page.getByRef`. */
  pwRef: string;
  role: string;
  name: string;
  /**
   * A password, one-time code or card field (by type or autocomplete, whatever its label says), one
   * the secret box filled, or a field that could not be checked. Typing into it is credential entry.
   */
  sensitive: boolean;
}

export interface RenderedSnapshot {
  text: string;
  truncated: boolean;
  entries: Map<string, RefEntry>;
}

/**
 * Steward's refs. Within one document a Playwright ref keeps its Steward ref, so an element that
 * did not change keeps the same ref across snapshots. `newDocument` forgets the mapping, so every
 * element of the next page gets a ref never used before.
 */
export class RefBook {
  private counter = 0;
  private byPlaywright = new Map<string, string>();

  newDocument(): void {
    this.byPlaywright = new Map();
  }

  refFor(pwRef: string): string {
    let ref = this.byPlaywright.get(pwRef);
    if (!ref) {
      this.counter += 1;
      ref = `e${this.counter}`;
      this.byPlaywright.set(pwRef, ref);
    }
    return ref;
  }
}

// ── Parsing ────────────────────────────────────────────────────────────────────────────────────

/** Validates Playwright's JSON defensively: its declared type is just `Serializable`. */
export function toAriaItems(json: unknown): AriaItem[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object" ? [json] : [];
  const out: AriaItem[] = [];
  for (const item of list) {
    const parsed = toAriaItem(item);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

function toAriaItem(value: unknown): AriaItem | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.role !== "string") return undefined;
  const node: AriaNode = { role: v.role };
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  node.name = str("name");
  node.ref = str("ref");
  node.text = str("text");
  node.url = str("url");
  node.placeholder = str("placeholder");
  node.cursor = str("cursor");
  if (v.checked === true || v.checked === "mixed") node.checked = v.checked;
  if (v.pressed === true || v.pressed === "mixed") node.pressed = v.pressed;
  if (v.disabled === true) node.disabled = true;
  if (v.selected === true) node.selected = true;
  if (v.active === true) node.active = true;
  if (typeof v.expanded === "boolean") node.expanded = v.expanded;
  if (typeof v.level === "number") node.level = v.level;
  const box = v.box as Record<string, unknown> | undefined;
  if (box && typeof box.y === "number" && typeof box.height === "number") {
    node.box = { x: Number(box.x) || 0, y: box.y, width: Number(box.width) || 0, height: box.height };
  }
  if (Array.isArray(v.children)) node.children = toAriaItems(v.children);
  return node;
}

function* walk(items: readonly AriaItem[]): Generator<AriaNode> {
  for (const item of items) {
    if (typeof item === "string") continue;
    yield item;
    if (item.children) yield* walk(item.children);
  }
}

/** Playwright ref → role and name, for every element in a snapshot. Used to re-check a ref before acting. */
export function indexRefs(items: readonly AriaItem[]): Map<string, { role: string; name: string }> {
  const out = new Map<string, { role: string; name: string }>();
  for (const node of walk(items)) {
    if (node.ref) out.set(node.ref, { role: node.role, name: node.name ?? "" });
  }
  return out;
}

/**
 * Playwright refs of every field, which must be checked for secrets: a filled one for masking, an
 * empty one too, because typing into a password field is credential entry whatever its label says.
 */
export function fieldRefs(items: readonly AriaItem[]): string[] {
  const out: string[] = [];
  for (const node of walk(items)) {
    if (node.ref && FIELD_ROLES.has(node.role)) out.push(node.ref);
  }
  return out;
}

/**
 * The node with keyboard focus: the deepest one marked active. `"none"` when only a top-level node
 * is, which is the page's body: nothing has focus. `"unknown"` when no node is, because what has
 * focus is something the snapshot leaves out (hidden, or role `none`).
 */
export function focusedNode(items: readonly AriaItem[]): AriaNode | "none" | "unknown" {
  let found: AriaNode | undefined;
  for (const node of walk(items)) if (node.active) found = node;
  if (!found) return "unknown";
  return items.includes(found) ? "none" : found;
}

/** The frame part of a Playwright ref: `f2` for `f2e7`, empty for the main frame's `e7`. */
export function refFrame(pwRef: string): string {
  return /^f\d+(?=e)/.exec(pwRef)?.[0] ?? "";
}

/** Playwright ref → role and name of every button in one frame, the candidates for a form's default button. */
export function buttonRefs(
  items: readonly AriaItem[],
  frame: string,
): Map<string, { role: string; name: string }> {
  const out = new Map<string, { role: string; name: string }>();
  for (const node of walk(items)) {
    if (node.ref && node.role === "button" && refFrame(node.ref) === frame)
      out.set(node.ref, { role: node.role, name: node.name ?? "" });
  }
  return out;
}

// ── Rendering ──────────────────────────────────────────────────────────────────────────────────

/** Cuts text at a UTF-16 boundary that never splits a surrogate pair. */
export function cutAtCodeUnits(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let s = text.slice(0, limit);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return `${s}…`;
}

function oneLine(text: string, limit: number): string {
  return cutAtCodeUnits(text.replace(/\s+/g, " ").trim(), limit);
}

function shouldShowRef(node: AriaNode): boolean {
  if (!node.ref) return false;
  return (
    INTERACTIVE_ROLES.has(node.role) || node.cursor === "pointer" || (node.role === "generic" && !!node.name)
  );
}

interface Line {
  text: string;
  /** Top of the element relative to the viewport, when known. Drives the scroll-aware cut. */
  y: number | undefined;
}

export interface RenderOptions {
  refFor: (pwRef: string) => string;
  /** Playwright refs of secret fields: their value is hidden and their entry marked sensitive. */
  masked: ReadonlySet<string>;
  charLimit?: number;
}

export function renderSnapshot(items: readonly AriaItem[], opts: RenderOptions): RenderedSnapshot {
  const lines: Line[] = [];
  const entries = new Map<string, RefEntry>();

  /** Visits siblings together, so a label's text next to the field it names is not said twice. */
  const visitAll = (children: readonly AriaItem[], depth: number, parentY: number | undefined) => {
    const named = new Set<string>();
    for (const child of children) {
      if (typeof child !== "string" && child.name && shouldShowRef(child))
        named.add(oneLine(child.name, NAME_LIMIT));
    }
    for (const child of children) {
      if (typeof child === "string" && named.has(oneLine(child, NAME_LIMIT))) continue;
      visit(child, depth, parentY);
    }
  };

  const visit = (item: AriaItem, depth: number, parentY: number | undefined) => {
    const indent = "  ".repeat(depth);
    if (typeof item === "string") {
      const text = oneLine(item, TEXT_LIMIT);
      if (text) lines.push({ text: `${indent}- text: ${text}`, y: parentY });
      return;
    }
    const node = item;
    const y = node.box ? node.box.y : parentY;
    const showRef = shouldShowRef(node);
    if (!showRef && WRAPPER_ROLES.has(node.role) && !node.name) {
      if (node.text) {
        const text = oneLine(node.text, TEXT_LIMIT);
        if (text) lines.push({ text: `${indent}- text: ${text}`, y });
      }
      visitAll(node.children ?? [], depth, y);
      return;
    }
    // An empty leaf (a blank paragraph, an unnamed image) tells the model nothing.
    if (!showRef && !node.name && !node.text && !node.url && (node.children?.length ?? 0) === 0) return;

    let head = `${indent}- ${node.role}`;
    if (node.name) head += ` ${JSON.stringify(oneLine(node.name, NAME_LIMIT))}`;
    if (node.checked === true) head += " [checked]";
    if (node.checked === "mixed") head += " [checked=mixed]";
    if (node.pressed === true) head += " [pressed]";
    if (node.pressed === "mixed") head += " [pressed=mixed]";
    if (node.selected) head += " [selected]";
    if (node.expanded === true) head += " [expanded]";
    if (node.expanded === false) head += " [expanded=false]";
    if (node.disabled) head += " [disabled]";
    if (node.level !== undefined) head += ` [level=${node.level}]`;
    if (node.placeholder && !node.name)
      head += ` [placeholder=${JSON.stringify(oneLine(node.placeholder, 80))}]`;
    if (showRef && node.ref) {
      const ref = opts.refFor(node.ref);
      entries.set(ref, {
        pwRef: node.ref,
        role: node.role,
        name: node.name ?? "",
        sensitive: opts.masked.has(node.ref),
      });
      head += ` [ref=${ref}]`;
    }
    if (node.url) head += ` [url=${oneLine(node.url, URL_LIMIT)}]`;

    let children = node.children ?? [];
    let value: string | undefined;
    if (node.role === "combobox" || node.role === "listbox") {
      const options = children.filter(
        (c): c is AriaNode => typeof c !== "string" && c.role === "option" && !c.ref,
      );
      if (options.length > 0) {
        const names = options.slice(0, OPTION_LIMIT).map((o) => oneLine(o.name ?? "", 60));
        const more = options.length > OPTION_LIMIT ? ` | … ${options.length - OPTION_LIMIT} more` : "";
        head += ` [options: ${names.join(" | ")}${more}]`;
        const chosen = options.find((o) => o.selected)?.name;
        if (!node.text && chosen) value = oneLine(chosen, TEXT_LIMIT);
        children = children.filter((c) => !options.includes(c as AriaNode));
      }
    }
    if (node.text) {
      // A field without a ref could not be checked, so its value is hidden too: fail closed.
      const hide = FIELD_ROLES.has(node.role) && (!node.ref || opts.masked.has(node.ref));
      value = hide ? MASKED_VALUE : oneLine(node.text, TEXT_LIMIT);
    }
    lines.push({ text: value ? `${head}: ${value}` : head, y });
    visitAll(children, depth + 1, y);
  };

  visitAll(items, 0, undefined);
  return { ...cutToFit(lines, opts.charLimit ?? SNAPSHOT_CHAR_LIMIT), entries };
}

/**
 * Keeps the snapshot under the limit. When the page is too long, the kept window starts at the
 * first element on screen, so scrolling really does show the model more of the page.
 */
function cutToFit(lines: readonly Line[], limit: number): { text: string; truncated: boolean } {
  const total = lines.reduce((n, l) => n + l.text.length + 1, 0);
  if (total <= limit) return { text: lines.map((l) => l.text).join("\n"), truncated: false };

  const budget = Math.max(200, limit - 160);
  let anchor = lines.findIndex((l) => l.y !== undefined && l.y >= 0);
  if (anchor < 0) anchor = 0;
  let used = 0;
  let end = anchor;
  while (end < lines.length && used + (lines[end]?.text.length ?? 0) + 1 <= budget) {
    used += (lines[end]?.text.length ?? 0) + 1;
    end++;
  }
  let start = anchor;
  while (start > 0 && used + (lines[start - 1]?.text.length ?? 0) + 1 <= budget) {
    start--;
    used += (lines[start]?.text.length ?? 0) + 1;
  }
  const out: string[] = [];
  if (start > 0) out.push(`[${start} lines above are not shown. Scroll up to see them.]`);
  for (let i = start; i < end; i++) out.push(lines[i]?.text ?? "");
  if (end < lines.length)
    out.push(`[${lines.length - end} more lines below are not shown. Scroll down to see them.]`);
  return { text: out.join("\n"), truncated: true };
}
