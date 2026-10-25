"""Public phishing lists, cached as files (docs/scam-shield.md §6).

A feed is one text file per source in a folder: a URL or a host per line, `#` for comments, and a
header line `# fetched_at: <iso8601>`. `scripts/refresh_threat_feeds.py` writes real ones from
URLhaus (abuse.ch, free community API with an Auth-Key, fair use) and the OpenPhish community
feed (free, 12-hourly, terms of use on openphish.com); fixtures/scam/feeds holds synthetic slices
in the same shape for replay mode. A hit only ever raises a verdict, and names its list.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from tempo_core.links import registrable

_FETCHED = re.compile(r"^#\s*fetched_at:\s*(\S+)", re.I)
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://", re.I)


def host_of(line: str) -> str:
    """The registrable host of a URL or a bare host, lower-cased; "" for a blank or comment."""
    text = line.strip()
    if not text or text.startswith("#"):
        return ""
    text = _SCHEME.sub("", text)
    host = text.split("/", 1)[0].split(":", 1)[0].casefold().strip(".")
    return registrable(host) if host else ""


@dataclass(frozen=True)
class Feed:
    name: str
    hosts: frozenset[str]
    fetched_at: str | None

    @classmethod
    def from_file(cls, path: Path) -> Feed:
        fetched = None
        hosts: set[str] = set()
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if (when := _FETCHED.match(line)) and fetched is None:
                fetched = when.group(1)
            elif host := host_of(line):
                hosts.add(host)
        return cls(path.stem, frozenset(hosts), fetched)


class ThreatFeeds:
    """Every feed in a folder, asked one question: which of these hosts does a list name?"""

    def __init__(self, feeds: Iterable[Feed]) -> None:
        self.feeds = tuple(feeds)
        self._by_host: dict[str, str] = {}
        for feed in sorted(self.feeds, key=lambda f: f.name):
            for host in feed.hosts:
                self._by_host.setdefault(host, feed.name)

    @classmethod
    def from_directory(cls, folder: Path) -> ThreatFeeds:
        if not folder.is_dir():
            return cls(())
        return cls(Feed.from_file(p) for p in sorted(folder.glob("*.txt")))

    def hits(self, hosts: Iterable[str]) -> dict[str, str]:
        """host -> the name of the list that names it, for the hosts that are named."""
        found: dict[str, str] = {}
        for host in hosts:
            key = registrable(host.casefold())
            if key in self._by_host:
                found[host] = self._by_host[key]
        return found

    def summary(self) -> Mapping[str, Mapping[str, str | int | None]]:
        return {f.name: {"entries": len(f.hosts), "fetched_at": f.fetched_at} for f in self.feeds}
