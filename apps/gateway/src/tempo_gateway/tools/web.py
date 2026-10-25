"""Web tools: read a page, look up an encyclopedia entry, and (with a key) search the open web.
Without a key, open-web search comes from the DuckDuckGo add-on (addons/tools.yaml)."""

from __future__ import annotations

import asyncio
import ipaddress
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote, urljoin, urlparse

from .base import TIMEOUT, USER_AGENT, Context, Refused, Result, Source, Tool, need, text

MAX_PAGE_BYTES = 1_500_000
MAX_PAGE_TEXT = 6000
MAX_REDIRECTS = 3
MAX_RESULTS = 6


def public_url(url: str) -> str:
    """The URL if it is one Tempo may fetch: http(s), ports 80/443, a host name. Raises Refused."""
    parts = urlparse(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise Refused("only http and https web addresses can be read")
    if parts.port not in (None, 80, 443):
        raise Refused("only the usual web ports can be read")
    if parts.username or parts.password:
        raise Refused("addresses with a login in them are not read")
    return parts.geturl()


async def public_host(host: str) -> None:
    """Every address the host resolves to must be public (no loopback, private, link-local …)."""
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None)
        addresses = [ipaddress.ip_address(info[4][0]) for info in infos]
    for address in addresses:
        if not address.is_global or address.is_multicast:
            raise Refused("that address is not on the public web")


class _Text(HTMLParser):
    """A page's readable text and title; scripts, styles and page furniture are dropped."""

    SKIP = frozenset(
        {"script", "style", "noscript", "svg", "nav", "footer", "header", "form", "template"}
    )
    BREAK = frozenset({"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "section", "article"})

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP:
            self._skip += 1
        elif tag == "title" and not self._skip and not self.title:
            self._in_title = True  # the page's own title, never an icon's inside an <svg>
        elif tag in self.BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def page_text(html: str) -> tuple[str, str]:
    """(title, text) of an HTML page, whitespace tidied, the text capped."""
    parser = _Text()
    parser.feed(html)
    lines = (" ".join(line.split()) for line in "".join(parser.parts).splitlines())
    body = "\n".join(line for line in lines if line)
    return " ".join(parser.title.split()), body[:MAX_PAGE_TEXT]


async def read_web_page(ctx: Context, args: dict[str, str]) -> Result:
    """A public web page's title and text; each redirect is followed by hand and checked."""
    current = public_url(need(args, "url", "which web address", 2000))
    for _ in range(MAX_REDIRECTS + 1):
        await public_host(urlparse(current).hostname or "")
        async with ctx.http.stream(
            "GET",
            current,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain"},
            timeout=TIMEOUT,
            follow_redirects=False,
        ) as response:
            if response.is_redirect:
                current = public_url(urljoin(current, response.headers.get("location", "")))
                continue
            response.raise_for_status()
            kind = response.headers.get("content-type", "")
            if not kind.startswith(("text/html", "text/plain", "application/xhtml")):
                raise Refused("that address is not a web page Tempo can read")
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > MAX_PAGE_BYTES:
                    raise Refused("that page is too big to read")
            html = body.decode(response.encoding or "utf-8", errors="replace")
            title, words = page_text(html) if "html" in kind else ("", html[:MAX_PAGE_TEXT])
            return {"url": current, "title": title, "text": words}, [
                Source(title or current, current)
            ]
    raise Refused("that address redirects too many times")


async def encyclopedia(ctx: Context, args: dict[str, str]) -> Result:
    """Wikipedia's summary of a topic (the best match for the words given)."""
    topic = need(args, "topic", "which topic")
    found = await ctx.get_json(
        "https://en.wikipedia.org/w/api.php",
        params={
            "action": "query",
            "list": "search",
            "srsearch": topic,
            "srlimit": 1,
            "format": "json",
        },
    )
    hits = found.get("query", {}).get("search", [])
    if not hits:
        raise Refused(f"Wikipedia has nothing on {topic!r}")
    title = hits[0]["title"]
    page = await ctx.get_json(
        f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}"
    )
    url = page.get("content_urls", {}).get("desktop", {}).get("page", "")
    summary = {"title": page.get("title", title), "summary": page.get("extract", ""), "url": url}
    return summary, [Source(f"Wikipedia: {summary['title']}", url)] if url else []


async def web_search(ctx: Context, args: dict[str, str]) -> Result:
    """The open web through a search API key (Tavily, else Brave)."""
    query = need(args, "query", "what to search for", 300)
    results: list[dict[str, Any]]
    if tavily := ctx.keys.get("tavily"):
        response = await ctx.http.post(
            "https://api.tavily.com/search",
            timeout=TIMEOUT,
            json={
                "api_key": tavily,
                "query": query,
                "max_results": MAX_RESULTS,
                "include_answer": True,
            },
        )
        response.raise_for_status()
        body = response.json()
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", "")[:400],
            }
            for r in body.get("results", [])[:MAX_RESULTS]
        ]
        found: dict[str, Any] = {
            "provider": "tavily",
            "answer": body.get("answer"),
            "results": results,
        }
    else:
        body = await ctx.get_json(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": MAX_RESULTS},
            headers={"X-Subscription-Token": ctx.keys["brave"], "Accept": "application/json"},
        )
        results = [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("description", "")[:400],
            }
            for r in body.get("web", {}).get("results", [])[:MAX_RESULTS]
        ]
        found = {"provider": "brave", "results": results}
    sources = [Source(r["title"] or r["url"], r["url"]) for r in results if r.get("url")]
    return found, sources[:4]


READ_PAGE = Tool(
    "read_web_page",
    "Read a web page the person gave you (a public http or https link).",
    {"url": text("the page's address")},
    ("url",),
    read_web_page,
    lambda a: "Read the web page",
    "the page itself",
)
ENCYCLOPEDIA = Tool(
    "encyclopedia",
    "Look up a person, place, event or idea in Wikipedia.",
    {"topic": text("what to look up")},
    ("topic",),
    encyclopedia,
    lambda a: f"Looked up “{a.get('topic', '')}” on Wikipedia",
    "wikipedia",
)
WEB_SEARCH = Tool(
    "web_search",
    "Search the web for facts, news, prices, opening times or how to do something.",
    {"query": text("a short search query")},
    ("query",),
    web_search,
    lambda a: f"Searched the web for “{a.get('query', '')}”",
    "search",
)
