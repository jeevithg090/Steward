/**
 * HTML to readable text for a model: the words a person would read, with headings marked `#`, list
 * items `-`, table cells split by `|`, and links kept as `[text](url)` so the model can follow them.
 * Scripts, styles, navigation and the document head are dropped.
 *
 * Deliberately a small tokenizer rather than a DOM: it runs on untrusted pages and email bodies, has
 * no dependencies, and degrades to "more text than ideal" on broken markup rather than throwing.
 *
 * It also runs in time linear in its input, whatever the markup. It runs on the server's only thread,
 * so a long article, an unclosed quote or a page of empty paragraphs must not stall everything else:
 * nothing here rescans the text written so far, and nothing rescans the input after a failed match.
 */

export interface HtmlToTextOptions {
  /** Resolves relative links. Without it, relative links keep only their text. */
  baseUrl?: string;
  /** Keep links as `[text](url)`. Default true. */
  links?: boolean;
  /**
   * Cut the text to this many characters, and stop converting soon after: a caller that keeps only
   * the start of a page should not pay for the rest of it.
   */
  maxChars?: number;
}

export interface HtmlText {
  title: string;
  text: string;
  /** `maxChars` cut the text short. */
  truncated: boolean;
}

const RAW_NAMES = [
  "title",
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "math",
  "iframe",
  "object",
  "canvas",
];
/** Elements dropped with everything inside them. Raw-text elements are removed before tokenizing. */
const RAW_OPEN = new RegExp(`<(${RAW_NAMES.join("|")})\\b`, "gi");
const RAW_CLOSE = new Map(RAW_NAMES.map((name) => [name, new RegExp(`</${name}\\s*>`, "gi")]));
/** Elements whose content is skipped while tokenizing (they contain normal markup). */
const SKIP = new Set(["head", "nav", "select", "datalist", "dialog"]);
// biome-ignore format: a compact table reads better than one entry per line
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "body", "center", "dd", "details", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "header", "hgroup", "html", "main", "p",
  "section", "summary", "table", "tbody", "thead", "tfoot", "caption",
]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
/** Deeper lists indent no further, so a run of unclosed `<ul>`s can't make the text quadratic. */
const MAX_INDENT = 16;
/**
 * Open links kept at once. Closing a link rewrites everything inside it, nested links included, so the
 * depth bounds how often one character is rewritten. Past it the outermost is forgotten and stays text.
 */
const MAX_OPEN_LINKS = 8;

const TAB = 9;
const NL = 10;
const SPACE = 32;
const BANG = 33;
const DQ = 34;
const HASH = 35;
const SQ = 39;
const DASH = 45;
const DOT = 46;
const SLASH = 47;
const LT = 60;
const GT = 62;
const QUESTION = 63;
const BAR = 124;

export function htmlToText(html: string, opts: HtmlToTextOptions = {}): HtmlText {
  const keepLinks = opts.links ?? true;
  const maxChars =
    opts.maxChars !== undefined && Number.isFinite(opts.maxChars)
      ? Math.max(0, Math.floor(opts.maxChars))
      : undefined;
  // Read on well past the cut, so tidying up and a link still open there can't change what is kept.
  const stopAt = maxChars === undefined ? Number.POSITIVE_INFINITY : maxChars + Math.max(maxChars, 4096);
  const titleTag = extractTitle(html);
  const source = dropRawElements(dropComments(html));

  const out = new Output();
  let ogTitle: string | undefined;
  let skipName: string | undefined;
  let skipDepth = 0;
  let preDepth = 0;
  let stopped = false;
  const links: { href?: string; mark: Mark }[] = [];
  const lists: { ordered: boolean; n: number }[] = [];

  const newline = (count: 1 | 2) => {
    // A block that opens right after a list marker or heading mark belongs on the same line.
    if (out.bareMarker) return;
    out.trimSpaces();
    if (out.size === 0) return;
    const have = out.newlines;
    if (have < count) out.write("\n".repeat(count - have));
  };
  const append = (raw: string) => {
    if (preDepth > 0) {
      out.write(raw);
      return;
    }
    let text = raw.replace(/\s+/g, " ");
    if (out.atLineStart || out.endsWithSpace) text = text.replace(/^ /, "");
    out.write(text);
  };
  const closeLink = () => {
    const open = links.pop();
    if (!open) return;
    out.unwatch(open.mark);
    if (!open.href) return;
    const start = open.mark.start;
    const content = out.textFrom(start);
    const text = content.replace(/\s+/g, " ").trim();
    if (!text) return;
    const lead = /^\s*/.exec(content)?.[0] ?? "";
    const written =
      text === open.href || `mailto:${text}` === open.href ? open.href : `[${text}](${open.href})`;
    out.replaceFrom(start, lead + written, open.mark.stale ? undefined : open.mark.tail);
  };

  for (const token of tokenize(source)) {
    if (out.size >= stopAt) {
      stopped = true;
      break;
    }
    const name = token.name;
    if (name === "meta" && !token.closing && !titleTag) ogTitle ??= ogTitleOf(token.attrs);

    if (skipName) {
      // `</head>` is optional in HTML; a body tag ends the head whether or not it was closed.
      if (skipName === "head" && name === "body" && !token.closing) {
        skipName = undefined;
        skipDepth = 0;
        continue;
      }
      if (name === skipName) {
        if (token.closing) skipDepth--;
        else if (!token.selfClosing) skipDepth++;
        if (skipDepth === 0) skipName = undefined;
      }
      continue;
    }

    if (!name) {
      if (token.text !== undefined) append(decodeEntities(token.text));
      continue;
    }

    const closing = token.closing;
    const attrs = token.attrs;

    if (!closing && SKIP.has(name)) {
      if (!token.selfClosing) {
        skipName = name;
        skipDepth = 1;
      }
      continue;
    }

    if (/^h[1-6]$/.test(name)) {
      if (closing) out.dropBareMarker();
      newline(2);
      if (!closing) out.write(`${"#".repeat(Number(name[1]))} `);
      continue;
    }

    switch (name) {
      case "br":
        out.trimSpaces();
        out.write("\n");
        continue;
      case "hr":
        newline(2);
        continue;
      case "pre":
        newline(2);
        preDepth = Math.max(0, preDepth + (closing ? -1 : 1));
        continue;
      case "ul":
      case "ol":
        if (closing) {
          out.dropBareMarker();
          lists.pop();
          newline(lists.length > 0 ? 1 : 2);
        } else {
          newline(lists.length > 0 ? 1 : 2);
          lists.push({ ordered: name === "ol", n: 0 });
        }
        continue;
      case "li": {
        out.dropBareMarker();
        newline(1);
        if (!closing) {
          const list = lists.at(-1);
          const indent = "  ".repeat(Math.min(MAX_INDENT, Math.max(0, lists.length - 1)));
          if (list?.ordered) out.write(`${indent}${++list.n}. `);
          else out.write(`${indent}- `);
        }
        continue;
      }
      case "tr":
        newline(1);
        continue;
      case "td":
      case "th":
        if (closing) out.write(" | ");
        continue;
      case "a": {
        if (!keepLinks) continue;
        if (closing) {
          closeLink();
          continue;
        }
        const oldest = links.length >= MAX_OPEN_LINKS ? links.shift() : undefined;
        if (oldest) out.unwatch(oldest.mark);
        links.push({ href: linkTarget(attrs, opts.baseUrl), mark: out.watch() });
        continue;
      }
      case "img": {
        // Only an image that is a link's whole content says anything: a logo link would otherwise vanish.
        const alt = attr(attrs, "alt");
        const link = links.at(-1);
        if (alt && link && out.blankSince(link.mark)) append(decodeEntities(alt));
        continue;
      }
    }

    if (BLOCK.has(name))
      newline(lists.length > 0 || name === "div" || name === "dd" || name === "dt" ? 1 : 2);
    else if (VOID.has(name)) continue;
  }

  const tidied = tidy(out.toString());
  let text = tidied;
  let truncated = stopped;
  if (maxChars !== undefined && text.length > maxChars) {
    // Never split a surrogate pair.
    const code = text.charCodeAt(maxChars - 1);
    text = text.slice(0, code >= 0xd800 && code <= 0xdbff ? maxChars - 1 : maxChars);
    truncated = true;
  }
  return { title: titleTag || ogTitle || firstHeading(tidied), text, truncated };
}

interface Token {
  /** Text to show; undefined for tags and for comments, doctypes and other markup. */
  text?: string;
  /** Lower-case tag name, for tags. */
  name?: string;
  closing: boolean;
  /** Written as `<name ... />`. */
  selfClosing: boolean;
  attrs: string;
}

const MARKUP: Token = { closing: false, selfClosing: false, attrs: "" };

/**
 * Splits HTML into text, tags and other markup, the way the regex
 * `<!--…-->|<![CDATA[…]]>|<!…>|<?…>|<(/?)(name)(attrs)>|[^<]+|<` would, without its cost: that regex
 * walks to the end of the input from every `<` that never closes, which is quadratic on an unclosed
 * quote or a run of `<a ` with no `>`.
 */
function* tokenize(s: string): Generator<Token> {
  const n = s.length;
  const lastGt = s.lastIndexOf(">");
  const lastDq = s.lastIndexOf('"');
  const lastSq = s.lastIndexOf("'");
  let commentsEnd = true;
  let cdataEnds = true;
  /** Positions an attribute walk passed through and found no `>` from: any walk landing there fails. */
  let dead: Uint8Array | undefined;

  /** The `>` that ends a tag whose attributes start at `from`, skipping quoted values; -1 if none. */
  const tagEnd = (from: number): number => {
    let j = from;
    while (j <= lastGt && !dead?.[j]) {
      const c = s.charCodeAt(j);
      if (c === GT) return j;
      if (c === DQ || c === SQ) {
        if (j >= (c === DQ ? lastDq : lastSq)) break;
        j = s.indexOf(c === DQ ? '"' : "'", j + 1) + 1;
      } else j++;
    }
    // Walk the same path again, marking it, so a later `<` inside it fails at once.
    dead ??= new Uint8Array(n + 1);
    for (let k = from; k < j; ) {
      dead[k] = 1;
      const c = s.charCodeAt(k);
      k = c === DQ || c === SQ ? s.indexOf(c === DQ ? '"' : "'", k + 1) + 1 : k + 1;
    }
    if (j < n) dead[j] = 1;
    return -1;
  };

  let i = 0;
  while (i < n) {
    if (s.charCodeAt(i) !== LT) {
      const next = s.indexOf("<", i);
      const end = next < 0 ? n : next;
      yield { text: s.slice(i, end), closing: false, selfClosing: false, attrs: "" };
      i = end;
      continue;
    }
    const c1 = s.charCodeAt(i + 1);
    if (c1 === BANG || c1 === QUESTION) {
      let end = -1;
      if (c1 === BANG && commentsEnd && s.startsWith("<!--", i)) {
        const close = s.indexOf("-->", i + 4);
        if (close < 0) commentsEnd = false;
        else end = close + 3;
      }
      if (end < 0 && c1 === BANG && cdataEnds && s.startsWith("<![CDATA[", i)) {
        const close = s.indexOf("]]>", i + 9);
        if (close < 0) cdataEnds = false;
        else end = close + 3;
      }
      if (end < 0 && i + 2 <= lastGt) end = s.indexOf(">", i + 2) + 1;
      if (end > 0) {
        yield MARKUP;
        i = end;
        continue;
      }
    } else {
      const closing = c1 === SLASH;
      const start = closing ? i + 2 : i + 1;
      if (isLetter(s.charCodeAt(start))) {
        let k = start + 1;
        while (k < n && isNameChar(s.charCodeAt(k))) k++;
        const gt = tagEnd(k);
        if (gt >= 0) {
          yield {
            name: s.slice(start, k).toLowerCase(),
            closing,
            selfClosing: s.charCodeAt(gt - 1) === SLASH,
            attrs: s.slice(k, gt),
          };
          i = gt + 1;
          continue;
        }
      }
    }
    // A `<` that starts nothing is text.
    yield { text: "<", closing: false, selfClosing: false, attrs: "" };
    i++;
  }
}

function isLetter(c: number): boolean {
  const lower = c | 32;
  return lower >= 97 && lower <= 122;
}

function isNameChar(c: number): boolean {
  return isLetter(c) || (c >= 48 && c <= 57) || c === 58 || c === DASH;
}

/** Removes `<!--…-->` comments; one that never closes, and everything after it, stays. */
function dropComments(html: string): string {
  let open = html.indexOf("<!--");
  if (open < 0) return html;
  const parts: string[] = [];
  let from = 0;
  while (open >= 0) {
    const close = html.indexOf("-->", open + 4);
    if (close < 0) break;
    parts.push(html.slice(from, open));
    from = close + 3;
    open = html.indexOf("<!--", from);
  }
  parts.push(html.slice(from));
  return parts.join("");
}

/** Replaces each raw-text element (script, style, svg…) and its content with a space. */
function dropRawElements(html: string): string {
  const lastGt = html.lastIndexOf(">");
  /** Names with no end tag left: looking again would scan to the end each time. */
  const unclosed = new Set<string>();
  const parts: string[] = [];
  let from = 0;
  RAW_OPEN.lastIndex = 0;
  for (let m = RAW_OPEN.exec(html); m; m = RAW_OPEN.exec(html)) {
    const name = (m[1] as string).toLowerCase();
    if (unclosed.has(name)) continue;
    const afterName = m.index + m[0].length;
    if (afterName > lastGt) break;
    const close = RAW_CLOSE.get(name) as RegExp;
    close.lastIndex = html.indexOf(">", afterName) + 1;
    const end = close.exec(html);
    if (!end) {
      unclosed.add(name);
      continue;
    }
    parts.push(html.slice(from, m.index), " ");
    from = end.index + end[0].length;
    RAW_OPEN.lastIndex = from;
  }
  if (from === 0) return html;
  parts.push(html.slice(from));
  return parts.join("");
}

/** How the current line reads so far, leaving out trailing spaces: is it just a list or heading mark? */
const BLANK = 0;
const BULLET = 1;
const DIGITS = 2;
const NUMBERED = 3;
const WORDS = 4;
/** `#` to `######` are HASHES + 1 to HASHES + 6. */
const HASHES = 10;

function step(state: number, c: number): number {
  if (state === BLANK)
    return c === DASH ? BULLET : c === HASH ? HASHES + 1 : c >= 48 && c <= 57 ? DIGITS : WORDS;
  if (state === DIGITS) return c >= 48 && c <= 57 ? DIGITS : c === DOT ? NUMBERED : WORDS;
  if (state > HASHES && state < HASHES + 6 && c === HASH) return state + 1;
  return WORDS;
}

function isMark(state: number): boolean {
  return state === BULLET || state === NUMBERED || state > HASHES;
}

/** The end of the text, which is all the converter ever asks about. */
interface Tail {
  /** "\n"s that end the text once trailing spaces are left out, counted up to 2 (nothing asks for more). */
  newlines: number;
  /** `newlines` where the current line began, for when a bare marker line is dropped. */
  lineNewlines: number;
  /** Length of the current line, leaving out trailing spaces. */
  lineLength: number;
  /** How the current line reads, leaving out trailing spaces (see `step`). */
  line: number;
  /** Spaces and tabs at the very end, and the last of them. */
  spaces: number;
  lastSpace: number;
}

/** Where a link's text began, so its text can be rewritten as `[text](url)` when it closes. */
interface Mark {
  start: number;
  /** The end of the text as it stood at `start`. */
  tail: Tail;
  /** The text has since been cut back before `start`, so `tail` no longer describes it. */
  stale: boolean;
  /** A non-space character known to be at or after `start`, or -1. */
  textAt: number;
}

/**
 * The output, kept as pieces with its end tracked as it is written. Asking a regex about the end of a
 * growing string scans (and flattens) the whole string each time, which made long pages quadratic.
 */
class Output {
  private readonly parts: string[] = [];
  size = 0;
  private tail: Tail = { newlines: 0, lineNewlines: 0, lineLength: 0, line: BLANK, spaces: 0, lastSpace: 0 };
  /** Open links, so a cut back past one's start is noticed. */
  private readonly marks: Mark[] = [];

  write(s: string): void {
    if (s === "") return;
    this.parts.push(s);
    this.size += s.length;
    this.feed(s);
  }

  /** The text ends a line, or there is none yet. */
  get atLineStart(): boolean {
    return this.tail.spaces === 0 && this.tail.lineLength === 0;
  }

  get endsWithSpace(): boolean {
    return this.tail.spaces > 0 && this.tail.lastSpace === SPACE;
  }

  /** How many "\n"s end the text, up to 2. */
  get newlines(): number {
    return this.tail.spaces === 0 ? this.tail.newlines : 0;
  }

  /** The current line is only a list marker or heading mark and one space. */
  get bareMarker(): boolean {
    const t = this.tail;
    return t.spaces === 1 && t.lastSpace === SPACE && isMark(t.line);
  }

  trimSpaces(): void {
    this.cut(this.tail.spaces);
    this.tail.spaces = 0;
  }

  /** Removes a list marker or heading mark that never got any text. */
  dropBareMarker(): void {
    if (!this.bareMarker) return;
    const t = this.tail;
    this.cut(t.lineLength + t.spaces);
    t.newlines = t.lineNewlines;
    t.lineLength = 0;
    t.line = BLANK;
    t.spaces = 0;
  }

  /** Marks where a link's text starts. */
  watch(): Mark {
    const mark = { start: this.size, tail: { ...this.tail }, stale: false, textAt: -1 };
    this.marks.push(mark);
    return mark;
  }

  unwatch(mark: Mark): void {
    const i = this.marks.lastIndexOf(mark);
    if (i >= 0) this.marks.splice(i, 1);
  }

  textFrom(start: number): string {
    if (start >= this.size) return "";
    const pieces: string[] = [];
    let at = this.size;
    for (let i = this.parts.length - 1; at > start; i--) {
      const part = this.parts[i] as string;
      at -= part.length;
      pieces.push(at < start ? part.slice(start - at) : part);
    }
    return pieces.reverse().join("");
  }

  /** Replaces the text from `start` on. `tail` is the end as it stood at `start`, when still true. */
  replaceFrom(start: number, text: string, tail: Tail | undefined): void {
    this.cut(this.size - start);
    if (tail) this.tail = { ...tail };
    else this.rescan();
    this.write(text);
  }

  /** Whether nothing but whitespace has been written since `mark`. */
  blankSince(mark: Mark): boolean {
    if (mark.textAt >= mark.start && mark.textAt < this.size) return false;
    let at = this.size;
    for (let i = this.parts.length - 1; i >= 0 && at > mark.start; i--) {
      const part = this.parts[i] as string;
      at -= part.length;
      for (let k = part.length - 1; k >= 0 && at + k >= mark.start; k--) {
        if (!isWhitespace(part.charCodeAt(k))) {
          mark.textAt = at + k;
          return false;
        }
      }
    }
    return true;
  }

  toString(): string {
    return this.parts.join("");
  }

  private feed(s: string): void {
    const t = this.tail;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === SPACE || c === TAB) {
        t.spaces++;
        t.lastSpace = c;
      } else if (c === NL) {
        t.newlines = t.spaces > 0 || t.lineLength > 0 ? 1 : Math.min(2, t.newlines + 1);
        t.lineNewlines = t.newlines;
        t.lineLength = 0;
        t.line = BLANK;
        t.spaces = 0;
      } else {
        // A space after the mark ("- x") means the line is more than a mark.
        t.line = step(t.spaces > 0 && t.line !== BLANK ? WORDS : t.line, c);
        t.lineLength += t.spaces + 1;
        t.spaces = 0;
        t.newlines = 0;
      }
    }
  }

  /** Removes the last `count` characters. */
  private cut(count: number): void {
    if (count <= 0) return;
    const to = this.size - count;
    while (this.size > to) {
      const last = this.parts.pop() as string;
      this.size -= last.length;
      if (this.size < to) {
        this.parts.push(last.slice(0, to - this.size));
        this.size = to;
      }
    }
    for (const mark of this.marks) {
      if (to < mark.start) mark.stale = true;
      if (to <= mark.textAt) mark.textAt = -1;
    }
  }

  /**
   * Works the end out from the text itself, after a cut that no saved end describes. Only the last
   * line is read, and only text written since the cut can be on it.
   */
  private rescan(): void {
    const line: string[] = [];
    let i = this.parts.length - 1;
    let nl = -1;
    for (; i >= 0; i--) {
      const part = this.parts[i] as string;
      nl = part.lastIndexOf("\n");
      if (nl >= 0) {
        line.push(part.slice(nl + 1));
        break;
      }
      line.push(part);
    }
    let newlines = 0;
    for (let p = i, k = nl; p >= 0 && newlines < 2; ) {
      if (k < 0) {
        p--;
        k = (this.parts[p]?.length ?? 0) - 1;
        continue;
      }
      if ((this.parts[p] as string).charCodeAt(k) !== NL) break;
      newlines++;
      k--;
    }
    this.tail = { newlines, lineNewlines: newlines, lineLength: 0, line: BLANK, spaces: 0, lastSpace: 0 };
    this.feed(line.reverse().join(""));
  }
}

/** JavaScript's `\s`, the set `trim()` removes. */
function isWhitespace(c: number): boolean {
  return (
    (c >= 9 && c <= 13) ||
    c === 32 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

/**
 * Final tidying, line by line: a trailing table bar and trailing spaces go, lines that are only a
 * list marker or heading mark go, and blank lines collapse to one.
 */
function tidy(raw: string): string {
  const kept: string[] = [];
  for (const line of raw.split("\n")) {
    let end = line.length;
    while (end > 0 && isSpaceOrTab(line.charCodeAt(end - 1))) end--;
    if (end > 0 && line.charCodeAt(end - 1) === BAR) {
      end--;
      while (end > 0 && isSpaceOrTab(line.charCodeAt(end - 1))) end--;
    }
    const tidied = line.slice(0, end);
    if (!isMarkOnly(tidied)) kept.push(tidied);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isSpaceOrTab(c: number): boolean {
  return c === SPACE || c === TAB;
}

function isMarkOnly(line: string): boolean {
  let i = 0;
  while (i < line.length && isSpaceOrTab(line.charCodeAt(i))) i++;
  let state = BLANK;
  for (; i < line.length && state !== WORDS; i++) state = step(state, line.charCodeAt(i));
  return isMark(state);
}

/** The first `<title>`, through to its end tag. */
function extractTitle(html: string): string {
  const open = /<title\b/gi.exec(html);
  if (!open) return "";
  const gt = html.indexOf(">", open.index + open[0].length);
  if (gt < 0) return "";
  const close = /<\/title\s*>/gi;
  close.lastIndex = gt + 1;
  const end = close.exec(html);
  if (!end) return "";
  const title = html.slice(gt + 1, end.index);
  return title.trim() ? clean(title) : "";
}

/** The page title a `<meta property="og:title" content="…">` gives, if this tag is one. */
function ogTitleOf(attrs: string): string | undefined {
  if (rawAttr(attrs, "property")?.toLowerCase() !== "og:title") return undefined;
  const content = rawAttr(attrs, "content");
  return content === undefined ? undefined : clean(content);
}

function firstHeading(text: string): string {
  return /^#{1,6} (.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

function clean(s: string): string {
  return decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();
}

/** Drops `<…>` runs as `/<[^>]*>/g` would; a `<` with no `>` after it ends the search. */
function stripTags(s: string): string {
  const parts: string[] = [];
  let from = 0;
  for (let lt = s.indexOf("<"); lt >= 0; lt = s.indexOf("<", from)) {
    const gt = s.indexOf(">", lt + 1);
    if (gt < 0) break;
    parts.push(s.slice(from, lt));
    from = gt + 1;
  }
  parts.push(s.slice(from));
  return parts.join("");
}

function rawAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m?.[1] ?? m?.[2] ?? m?.[3];
}

function attr(attrs: string, name: string): string | undefined {
  const value = rawAttr(attrs, name);
  return value === undefined ? undefined : decodeEntities(value).trim();
}

function linkTarget(attrs: string, baseUrl: string | undefined): string | undefined {
  const href = attr(attrs, "href");
  if (!href || href.startsWith("#")) return undefined;
  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:")
      return url.toString();
  } catch {
    // Relative link without a base, or not a URL at all: keep the text only.
  }
  return undefined;
}

// biome-ignore format: a compact table reads better than one entry per line
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”",
  bdquo: "„", laquo: "«", raquo: "»", bull: "•", middot: "·", deg: "°", pound: "£", euro: "€",
  yen: "¥", cent: "¢", copy: "©", reg: "®", trade: "™", times: "×", divide: "÷", plusmn: "±",
  frac12: "½", frac14: "¼", frac34: "¾", sect: "§", para: "¶", dagger: "†", Dagger: "‡",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", check: "✓", zwj: "", zwnj: "", shy: "",
  eacute: "é", Eacute: "É", egrave: "è", ecirc: "ê", euml: "ë", aacute: "á", agrave: "à",
  acirc: "â", auml: "ä", aring: "å", atilde: "ã", ccedil: "ç", iacute: "í", iuml: "ï", ntilde: "ñ",
  oacute: "ó", ocirc: "ô", ouml: "ö", oslash: "ø", uacute: "ú", uuml: "ü", szlig: "ß", Auml: "Ä",
  Ouml: "Ö", Uuml: "Ü",
};

/** Decodes named (common), decimal and hex character references. Unknown names are left as written. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? Number.parseInt(ref.slice(2), 16)
          : Number.parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        return "�";
      return String.fromCodePoint(code);
    }
    const named = NAMED[ref] ?? NAMED[ref.toLowerCase()];
    return named ?? whole;
  });
}
