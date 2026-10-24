"""UK bank holidays from gov.uk (https://www.gov.uk/bank-holidays.json), for deadline maths.

fixtures/govuk/bank-holidays.json is a copy fetched on 24 Oct 2026; `fetch` gets a fresh one.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx

URL = "https://www.gov.uk/bank-holidays.json"
Division = str  # "england-and-wales" | "scotland" | "northern-ireland"


def parse(document: dict[str, Any], division: Division = "england-and-wales") -> frozenset[date]:
    return frozenset(date.fromisoformat(e["date"]) for e in document[division]["events"])


def from_file(path: Path, division: Division = "england-and-wales") -> frozenset[date]:
    return parse(json.loads(path.read_text(encoding="utf-8")), division)


async def fetch(
    http: httpx.AsyncClient, division: Division = "england-and-wales"
) -> frozenset[date]:
    response = await http.get(URL, timeout=10)
    response.raise_for_status()
    return parse(response.json(), division)
