import type { BotAuthor } from "@steward/shared";

/**
 * HTML for the browse site: escaping, a small Markdown renderer for listing text, the author line,
 * and the page frame. Everything a listing says is third-party text, so it is escaped first and
 * only then marked up; links keep `rel="nofollow ugc"` and images are shown as their alt text.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** An http(s) address, or nothing: `javascript:` and friends never reach an `href`. */
export function safeHref(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-28T10:04:20Z` → `28 Oct 2026`. A date that cannot be read is shown as given. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return esc(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
      const safe = safeHref(decodeEntities(href));
      return safe ? `<a href="${esc(safe)}" rel="nofollow noopener ugc">${label}</a>` : label;
    });
}

/** Headings, paragraphs, lists, quotes, fenced code and inline marks. Nothing else, and no raw HTML. */
export function renderMarkdown(markdown: string): string {
  const lines = esc(markdown.replace(/\r\n?/g, "\n")).split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++;
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      // The page already has an h1, so a README's own levels move down one.
      const level = Math.min((heading[1]?.length ?? 1) + 1, 4);
      out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(/^&gt;\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${inline(quoted.join(" "))}</p></blockquote>`);
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      i++;
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

/** Who made a bot, as the listing says it. */
export function authorHtml(author: BotAuthor, counts: { installs: number; usedBy: number }): string {
  if (author.kind === "ai") {
    const unused = counts.installs + counts.usedBy === 0 ? ", not yet used by anyone" : "";
    return `AI-made with <code>${esc(author.model)}</code> on ${formatDate(author.generated)}${unused}`;
  }
  const href = safeHref(author.url);
  const handle = `@${esc(author.handle)}`;
  const who = href ? `<a href="${esc(href)}" rel="nofollow noopener ugc">${handle}</a>` : handle;
  return `By ${who}${author.basedOnAi ? ", based on an AI-made draft" : ""}`;
}

export function authorText(author: BotAuthor): string {
  return author.kind === "ai"
    ? `AI-made with ${author.model} on ${author.generated}`
    : `@${author.handle}${author.basedOnAi ? " (based on an AI-made draft)" : ""}`;
}

export interface NavUser {
  login: string;
  url: string;
  isAdmin: boolean;
}

export interface PageOptions {
  title: string;
  description?: string;
  /** The request path, for the current link in the nav. */
  path: string;
  body: string;
  siteName: string;
  siteUrl: string;
  user?: NavUser;
  signIn: boolean;
  /** Pages about one person (admin, your submissions) are not for search engines. */
  noindex?: boolean;
  /** Where this directory's code lives, when the host says (`DIRECTORY_SOURCE_URL`). */
  sourceUrl?: string;
}

export const CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5a5f66;--line:#d9dde3;--card:#f6f7f9;--accent:#1f5fbf;--accent-fg:#fff;--warn:#8a5a00;--warn-bg:#fff6e0;--ok:#1f6f3f}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#ececec;--muted:#a3a9b1;--line:#30353c;--card:#1b1f24;--accent:#7fb0ff;--accent-fg:#0b1a33;--warn:#ffcf70;--warn-bg:#2a2410;--ok:#7fd49a}}
*{box-sizing:border-box}html{color-scheme:light dark}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
a{color:var(--accent)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-999px;top:8px;background:var(--accent);color:var(--accent-fg);padding:8px 12px;border-radius:6px}.skip:focus{left:8px;z-index:10}
header{border-bottom:1px solid var(--line)}nav{max-width:1040px;margin:0 auto;padding:12px 20px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
nav a{text-decoration:none}nav a[aria-current=page]{font-weight:600;text-decoration:underline}nav .brand{font-weight:700;color:var(--fg);margin-right:auto}
nav form{display:inline}nav button{background:none;border:0;color:var(--accent);cursor:pointer;font:inherit;padding:0;text-decoration:underline}
main{max-width:1040px;margin:0 auto;padding:24px 20px 48px}footer{border-top:1px solid var(--line);color:var(--muted);font-size:14px}footer div{max-width:1040px;margin:0 auto;padding:16px 20px}
h1{font-size:1.9rem;line-height:1.2;margin:0 0 8px}h2{font-size:1.3rem;margin:32px 0 10px}h3{font-size:1.05rem;margin:20px 0 6px}
p.lead{font-size:1.15rem;color:var(--muted);margin:0 0 20px;max-width:70ch}
.search{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 8px}.search input[type=search]{flex:1 1 280px;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
.search select{font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
button.primary,a.button{display:inline-block;font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);cursor:pointer;text-decoration:none}
button.quiet,a.quiet{display:inline-block;font:inherit;padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;text-decoration:none}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));list-style:none;padding:0;margin:12px 0}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--card);display:flex;flex-direction:column;gap:6px}.card h3{margin:0;font-size:1.05rem}.card p{margin:0;color:var(--fg)}
.meta{color:var(--muted);font-size:14px}.badge{display:inline-block;font-size:12px;padding:1px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);margin-right:6px}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:8px 0}.chips a{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--fg);background:var(--card)}.chips a[aria-current=true]{border-color:var(--accent);font-weight:600}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:12px 0}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0}
.notice{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn);border-radius:8px;padding:10px 14px;margin:12px 0}.ok{color:var(--ok)}
.readme{max-width:76ch}.readme pre,.instructions{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;white-space:pre-wrap;font-size:14px}
details{margin:10px 0}summary{cursor:pointer;font-weight:600}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
form.stack{display:grid;gap:12px;max-width:620px}label{display:grid;gap:4px;font-weight:600}label input,label textarea,label select{font:inherit;font-weight:400;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}label.check{grid-template-columns:auto 1fr;align-items:start;font-weight:400}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.pager{display:flex;gap:12px;margin:16px 0}
.sr-only{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
`;

export function page(opts: PageOptions): string {
  const link = (href: string, label: string) =>
    `<a href="${href}"${opts.path === href ? ' aria-current="page"' : ""}>${label}</a>`;
  const account = opts.user
    ? `<span class="meta">Signed in as <a href="${esc(opts.user.url)}" rel="noopener">@${esc(opts.user.login)}</a></span>` +
      `${opts.user.isAdmin ? link("/admin", "Review") : ""}` +
      `<form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>`
    : opts.signIn
      ? `<a href="/auth/github" rel="nofollow">Sign in with GitHub</a>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} · ${esc(opts.siteName)}</title>
${opts.description ? `<meta name="description" content="${esc(opts.description)}">` : ""}
${opts.noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="alternate" type="application/rss+xml" title="Newest bots" href="${esc(opts.siteUrl)}/feed.xml">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header><nav aria-label="Main">
<a class="brand" href="/">${esc(opts.siteName)}</a>
${link("/bots", "Browse")}
${link("/submit", "Submit a bot")}
${link("/privacy", "Privacy")}
<a href="/llms.txt">For agents</a>
${account}
</nav></header>
<main id="main">
${opts.body}
</main>
<footer><div>
<p>Every bot here is a pack you can read before you add it: what it does, what it needs, what it may do without asking, and who made it. Listing text is written by third parties. Packs are published under the MIT licence.</p>
<p><a href="${esc(opts.siteUrl)}/index.json">index.json</a> · <a href="${esc(opts.siteUrl)}/feed.xml">RSS</a> · <a href="${esc(opts.siteUrl)}/llms.txt">llms.txt</a> · MCP at <code>${esc(opts.siteUrl)}/mcp</code>${
    opts.sourceUrl ? ` · <a href="${esc(opts.sourceUrl)}" rel="noopener">Source</a>` : ""
  }</p>
</div></footer>
</body>
</html>
`;
}
