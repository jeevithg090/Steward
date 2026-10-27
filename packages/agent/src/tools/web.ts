import { builtin } from "./define.ts";
import { int, object, readOptionalNumber, readString, str } from "./schema.ts";
import { urlTarget } from "./target.ts";
import type { StewardTool } from "./types.ts";

/** Enough for an article; past this the result says it was cut. */
const FETCH_MAX_CHARS = 20_000;

export const webFetch = builtin("web_fetch", {
  description:
    "Read a public web page as plain text, without opening it on your computer. Quicker than the browser for reading an article or documentation. Use the browser instead when you need to click, sign in or fill in a form.",
  parameters: object({ url: str("The full web address, such as https://example.com/page.") }, ["url"]),
  toGateCall: async (args) => ({ target: urlTarget(readString(args, "url")) }),
  execute: async (args, ctx) => {
    const target = urlTarget(readString(args, "url"));
    if (!target.host) throw new Error("That is not a web address I can read.");
    return ctx.services.web.fetch(target.url ?? "", { signal: ctx.signal, maxChars: FETCH_MAX_CHARS });
  },
});

export const webSearch = builtin("web_search", {
  description:
    "Search the web. Returns titles, links and short snippets. A snippet is not the page: read the page with web_fetch before you rely on it, and say which page an answer came from.",
  parameters: object(
    {
      query: str("What to search for."),
      limit: int("How many results, at most 10. Defaults to 5.", { minimum: 1, maximum: 10 }),
    },
    ["query"],
  ),
  toGateCall: async () => ({ target: {} }),
  execute: async (args, ctx) =>
    ctx.services.web.search(readString(args, "query", { max: 500 }), {
      signal: ctx.signal,
      limit: readOptionalNumber(args, "limit", { min: 1, max: 10 }) ?? 5,
    }),
});

export const WEB_TOOLS: StewardTool[] = [webFetch, webSearch];
