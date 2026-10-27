/**
 * HTML to readable text for a model: the words a person would read, with headings marked `#`, list
 * items `-`, table cells split by `|`, and links kept as `[text](url)` so the model can follow them.
 * Scripts, styles, navigation and the document head are dropped.
 *
 * Deliberately a small tokenizer rather than a DOM: it runs on untrusted pages and email bodies, has
 * no dependencies, and degrades to "more text than ideal" on broken markup rather than throwing.
 */

export interface HtmlToTextOptions {
  /** Resolves relative links. Without it, relative links keep only their text. */
  baseUrl?: string;
  /** Keep links as `[text](url)`. Default true. */
  links?: boolean;
}

export interface HtmlText {
  title: string;
  text: string;
}

/** Elements dropped with everything inside them. Raw-text elements are removed before tokenizing. */
const RAW_DROP =
  /<(title|script|style|noscript|template|svg|math|iframe|object|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
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

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;

export function htmlToText(html: string, opts: HtmlToTextOptions = {}): HtmlText {
  const keepLinks = opts.links ?? true;
  const title = extractTitle(html);
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(RAW_DROP, " ");

  let out = "";
  let skipName: string | undefined;
  let skipDepth = 0;
  let preDepth = 0;
  const links: { href?: string; start: number }[] = [];
  const lists: { ordered: boolean; n: number }[] = [];

  const trimTrailingSpaces = () => {
    out = out.replace(/[ \t]+$/, "");
  };
  const newline = (count: 1 | 2) => {
    // A block that opens right after a list marker or heading mark belongs on the same line.
    if (/(?:^|\n)[ \t]*(?:-|\d+\.|#{1,6}) $/.test(out)) return;
    trimTrailingSpaces();
    if (out === "") return;
    const have = /\n*$/.exec(out)?.[0].length ?? 0;
    if (have < count) out += "\n".repeat(count - have);
  };
  /** Removes a list marker or heading mark that never got any text. */
  const dropEmptyMarker = () => {
    out = out.replace(/(^|\n)[ \t]*(?:-|\d+\.|#{1,6}) $/, "$1");
  };
  const append = (raw: string) => {
    if (preDepth > 0) {
      out += raw;
      return;
    }
    let text = raw.replace(/\s+/g, " ");
    if (out === "" || out.endsWith("\n") || out.endsWith(" ")) text = text.replace(/^ /, "");
    out += text;
  };

  for (const m of source.matchAll(TOKEN)) {
    const whole = m[0];
    const name = m[2]?.toLowerCase();

    if (skipName) {
      // `</head>` is optional in HTML; a body tag ends the head whether or not it was closed.
      if (skipName === "head" && name === "body" && !m[1]) {
        skipName = undefined;
        skipDepth = 0;
        continue;
      }
      if (name === skipName) {
        if (m[1]) skipDepth--;
        else if (!whole.endsWith("/>")) skipDepth++;
        if (skipDepth === 0) skipName = undefined;
      }
      continue;
    }

    if (!name) {
      if (whole.startsWith("<!") || whole.startsWith("<?")) continue;
      append(decodeEntities(whole));
      continue;
    }

    const closing = m[1] === "/";
    const attrs = m[3] ?? "";

    if (!closing && SKIP.has(name)) {
      if (!whole.endsWith("/>")) {
        skipName = name;
        skipDepth = 1;
      }
      continue;
    }

    if (/^h[1-6]$/.test(name)) {
      if (closing) dropEmptyMarker();
      newline(2);
      if (!closing) out += `${"#".repeat(Number(name[1]))} `;
      continue;
    }

    switch (name) {
      case "br":
        trimTrailingSpaces();
        out += "\n";
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
          dropEmptyMarker();
          lists.pop();
          newline(lists.length > 0 ? 1 : 2);
        } else {
          newline(lists.length > 0 ? 1 : 2);
          lists.push({ ordered: name === "ol", n: 0 });
        }
        continue;
      case "li": {
        dropEmptyMarker();
        newline(1);
        if (!closing) {
          const list = lists.at(-1);
          const indent = "  ".repeat(Math.max(0, lists.length - 1));
          if (list?.ordered) out += `${indent}${++list.n}. `;
          else out += `${indent}- `;
        }
        continue;
      }
      case "tr":
        newline(1);
        continue;
      case "td":
      case "th":
        if (closing) out += " | ";
        continue;
      case "a": {
        if (!keepLinks) continue;
        if (!closing) {
          links.push({ href: linkTarget(attrs, opts.baseUrl), start: out.length });
          continue;
        }
        const link = links.pop();
        if (!link) continue;
        const text = out.slice(link.start).replace(/\s+/g, " ").trim();
        if (!link.href || !text) continue;
        const lead = out.slice(link.start).match(/^\s*/)?.[0] ?? "";
        out =
          out.slice(0, link.start) +
          lead +
          (text === link.href || `mailto:${text}` === link.href ? link.href : `[${text}](${link.href})`);
        continue;
      }
      case "img": {
        // Only an image that is a link's whole content says anything: a logo link would otherwise vanish.
        const alt = attr(attrs, "alt");
        const link = links.at(-1);
        if (alt && link && out.slice(link.start).trim() === "") append(decodeEntities(alt));
        continue;
      }
    }

    if (BLOCK.has(name))
      newline(lists.length > 0 || name === "div" || name === "dd" || name === "dt" ? 1 : 2);
    else if (VOID.has(name)) continue;
  }

  const text = out
    .replace(/[ \t]*\|[ \t]*(?=\n|$)/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .filter((line) => !/^[ \t]*(?:-|\d+\.|#{1,6})$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title || firstHeading(text), text };
}

function extractTitle(html: string): string {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  if (title?.trim()) return clean(title);
  const og =
    /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:title["']/i.exec(html)?.[1];
  return og ? clean(og) : "";
}

function firstHeading(text: string): string {
  return /^#{1,6} (.+)$/m.exec(text)?.[1]?.trim() ?? "";
}

function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  const value = m?.[1] ?? m?.[2] ?? m?.[3];
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
