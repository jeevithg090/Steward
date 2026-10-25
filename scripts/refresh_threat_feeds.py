"""`make refresh-feeds`: refresh the cached public phishing lists Scam Shield checks links against.

Writes one file per source into .data/scam/feeds/ (gitignored; the Gateway reads it when
SCAM_FEEDS_DIR points there, else the synthetic slices in fixtures/scam/feeds):

- OpenPhish community feed: free, refreshed every 12 hours, a URL per line, no key. By using it
  you accept OpenPhish's terms of use (openphish.com).
- URLhaus (abuse.ch): the plain-text URL list from the community API, free under abuse.ch's fair
  use principles with an Auth-Key from the abuse.ch portal (URLHAUS_AUTH_KEY). Skipped without one.
- PhishTank (Cisco Talos): free with registration (PHISHTANK_API_KEY); skipped without one.

Each file starts with `# source:` and `# fetched_at:` lines, which tempo_adapters.scam.feeds reads.
Hosts, not full URLs, are what Scam Shield compares, so only registrable hosts are kept.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx

from tempo_adapters.scam.feeds import host_of

REPO = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("SCAM_FEEDS_DIR") or REPO / ".data" / "scam" / "feeds")
OPENPHISH = "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt"
URLHAUS = "https://urlhaus.abuse.ch/downloads/text_online/"
PHISHTANK = "http://data.phishtank.com/data/{key}/online-valid.csv"
MAX_HOSTS = 50_000


def write(name: str, source: str, lines: list[str]) -> int:
    hosts = sorted({h for h in (host_of(line) for line in lines) if h})[:MAX_HOSTS]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.txt").write_text(
        f"# source: {source}\n# fetched_at: {datetime.now(UTC).isoformat(timespec='seconds')}\n"
        + "\n".join(hosts)
        + "\n",
        encoding="utf-8",
    )
    return len(hosts)


def main() -> int:
    written = 0
    with httpx.Client(timeout=60, follow_redirects=True) as http:
        text = http.get(OPENPHISH).raise_for_status().text
        print(f"openphish: {write('openphish', OPENPHISH, text.splitlines())} hosts")
        written += 1
        if key := os.environ.get("URLHAUS_AUTH_KEY"):
            text = http.get(URLHAUS, headers={"Auth-Key": key}).raise_for_status().text
            print(f"urlhaus: {write('urlhaus', URLHAUS, text.splitlines())} hosts")
            written += 1
        else:
            print("urlhaus: skipped (set URLHAUS_AUTH_KEY from the abuse.ch portal)")
        if key := os.environ.get("PHISHTANK_API_KEY"):
            text = http.get(PHISHTANK.format(key=key)).raise_for_status().text
            urls = [row.split(",")[1] for row in text.splitlines()[1:] if "," in row]
            print(f"phishtank: {write('phishtank', 'https://phishtank.org', urls)} hosts")
            written += 1
        else:
            print("phishtank: skipped (set PHISHTANK_API_KEY)")
    print(f"wrote {written} feed(s) to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
