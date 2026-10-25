"""The link sandbox (docs/scam-shield.md §3, tier 3): one isolated look behind a link, from the
Gateway, never from the phone.

`LiveSandbox.inspect` follows the link by hand (at most MAX_HOPS redirects, a short timeout, a
small read cap, a fixed user agent, no cookies, no JavaScript, never a private address), reads
the landing page for password and card forms and brand names with the standard library's HTML
parser, asks RDAP (rdap.org, an open bootstrap) how old the final domain is, and reports findings
the domain core judges (`tempo_core.scam.SandboxReport`). Trouble is a finding (`unreachable`,
`no_page`), never an exception: a scam page that will not load must not clear itself.

`ReplaySandbox` answers from recordings in fixtures/scam/sandbox/<host>.json (synthetic), so the
demo and CI run with no network.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import socket
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import httpx

from tempo_core.links import BRANDS, brand_in, fold, registrable
from tempo_core.scam import SandboxReport

MAX_HOPS = 5
MAX_BYTES = 256 * 1024
TIMEOUT = httpx.Timeout(5.0, connect=3.0)
USER_AGENT = "TempoScamShield/0.1 (+https://github.com/jeevithg090/Tempo; a safety check)"
RDAP = "https://rdap.org/domain/"
YOUNG_DAYS = 90  # report an age only when it is young enough to matter
_CARD = re.compile(
    r"card|cc[-_]?num|cvv|cvc|pan\b|expiry|exp[-_]?date|sort[-_]?code|account[-_]?number|iban", re.I
)
_OFFICIAL = frozenset(h for hosts in BRANDS.values() for h in hosts)


class _Page(HTMLParser):
    """Just enough of the page: its title, and what its forms ask for."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.password_form = False
        self.card_form = False
        self.text: list[str] = []
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        if tag == "input":
            fields = {k: (v or "") for k, v in attrs}
            kind = fields.get("type", "text").casefold()
            name = " ".join(
                fields.get(k, "") for k in ("name", "id", "autocomplete", "placeholder")
            )
            if kind == "password":
                self.password_form = True
            if _CARD.search(name) or "cc-" in fields.get("autocomplete", "").casefold():
                self.card_form = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif len(self.text) < 400:
            self.text.append(data.strip())


class LiveSandbox:
    def __init__(
        self, http: httpx.AsyncClient, *, rdap: bool = True, today: date | None = None
    ) -> None:
        self.http, self.rdap, self.today = http, rdap, today

    async def inspect(self, host: str, *, url: str | None = None) -> SandboxReport:
        start = url or f"http://{host}/"
        findings: list[str] = []
        final_host = host
        try:
            response, final_host = await self._follow(start)
        except _Blocked as blocked:
            return SandboxReport(host, (f"blocked:{blocked}",), official=False)
        except (TimeoutError, httpx.HTTPError, OSError, ValueError):
            response = None
        if registrable(final_host) != registrable(host):
            findings.append(f"redirects_to:{registrable(final_host)}")
        official = registrable(final_host) in _OFFICIAL
        if response is None:
            findings.append("unreachable")
        else:
            findings += self._page_findings(response, final_host)
        if self.rdap and not official:
            age = await self._domain_age(registrable(final_host))
            if age is not None and age < YOUNG_DAYS:
                findings.append(f"new_domain:{age}")
        return SandboxReport(host, tuple(dict.fromkeys(findings)), official=official)

    async def _follow(self, url: str) -> tuple[httpx.Response, str]:
        """Walk redirects by hand so every hop is checked against private addresses."""
        current = url
        for _ in range(MAX_HOPS + 1):
            parsed = httpx.URL(current)
            host = parsed.host.casefold()
            if await _is_private(host):
                raise _Blocked("private address")
            request = self.http.build_request(
                "GET", current, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"}
            )
            response = await self.http.send(request, stream=True, follow_redirects=False)
            try:
                if response.is_redirect and response.headers.get("location"):
                    current = str(parsed.join(response.headers["location"]))
                    continue
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
                response._content = body[:MAX_BYTES]
                return response, host
            finally:
                await response.aclose()
        raise httpx.TooManyRedirects("too many redirects", request=request)

    def _page_findings(self, response: httpx.Response, final_host: str) -> list[str]:
        findings: list[str] = []
        kind = response.headers.get("content-type", "").casefold()
        if "android.package-archive" in kind or httpx.URL(str(response.url)).path.endswith(".apk"):
            return ["apk_download"]
        if "html" not in kind and not response.content.lstrip().lower().startswith(b"<"):
            return ["no_page"]
        page = _Page()
        try:
            page.feed(response.content.decode(response.encoding or "utf-8", errors="replace"))
        except Exception:
            return ["no_page"]
        if page.password_form:
            findings.append("password_form")
        if page.card_form:
            findings.append("card_form")
        words = fold(page.title + " " + " ".join(page.text[:200]))
        brand = brand_in(final_host) or next(
            (b for b in BRANDS if len(b) >= 4 and b in words.replace(" ", "")), None
        )
        if brand and registrable(final_host) not in BRANDS[brand]:
            findings.append(f"brand_page:{brand}")
        return findings

    async def _domain_age(self, domain: str) -> int | None:
        try:
            response = await self.http.get(
                RDAP + domain, headers={"Accept": "application/rdap+json"}, timeout=TIMEOUT
            )
            if response.status_code != 200:
                return None
            events = response.json().get("events") or []
        except (httpx.HTTPError, ValueError):
            return None
        for event in events:
            if event.get("eventAction") == "registration" and event.get("eventDate"):
                registered = datetime.fromisoformat(str(event["eventDate"]).replace("Z", "+00:00"))
                today = self.today or datetime.now(UTC).date()
                return max((today - registered.date()).days, 0)
        return None


class _Blocked(Exception):
    pass


async def _is_private(host: str) -> bool:
    """A literal or resolved address inside a private, loopback or link-local range."""
    try:
        return _private_ip(ipaddress.ip_address(host))
    except ValueError:
        pass
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, host, None)
    except OSError:
        return False  # it will fail to connect, which is "unreachable", not "blocked"
    return any(_private_ip(ipaddress.ip_address(info[4][0])) for info in infos)


def _private_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


class ReplaySandbox:
    """Recorded looks, by host (fixtures/scam/sandbox). An unknown host is `unreachable`."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder

    async def inspect(self, host: str, *, url: str | None = None) -> SandboxReport:
        path = self.folder / f"{registrable(host.casefold())}.json"
        if not path.exists():
            return SandboxReport(host, ("unreachable",), official=False)
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return SandboxReport(
            host,
            tuple(str(f) for f in data.get("findings", [])),
            official=bool(data.get("official")),
        )
