"""On-device signal filters (spec §15.9, build plan S5.3): the reference behaviour.

A skill declares which signals it needs (skills/*/signals.yaml). Each device checks them
locally, and only the declared `extract` fields of a matching notification leave it, never the
notification itself. The Android node (apps/android-signal) implements the same rules and is
tested against the same vectors (fixtures/signals/notifications.json).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field

EXTRACTORS: dict[str, re.Pattern[str]] = {
    "service_time": re.compile(r"\b([01]\d|2[0-3])[:.]?([0-5]\d)\b"),
    "origin": re.compile(r"\bfrom ([A-Z][A-Za-z' ]+?) to\b|\b([A-Z][A-Za-z' ]+?) to [A-Z]"),
    "destination": re.compile(r"\bto ([A-Z][A-Za-z' ]+?)(?: is| has| was|[.,]|$)"),
    "delay_minutes": re.compile(r"\b(\d{1,3}) ?(?:min(?:ute)?s?)\b", re.I),
}


class Match(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    sender_any: tuple[str, ...]
    text_any: tuple[str, ...]


class SignalSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    sources: tuple[str, ...]
    match: Match
    extract: tuple[str, ...] = Field(min_length=1)
    retention_days: int = Field(gt=0)


def load_signals(path: Path) -> list[SignalSpec]:
    return [
        SignalSpec.model_validate(s)
        for s in yaml.safe_load(path.read_text(encoding="utf-8"))["signals"]
    ]


def matches(spec: SignalSpec, sender: str, text: str) -> bool:
    sender_ok = any(s.casefold() in sender.casefold() for s in spec.match.sender_any)
    return sender_ok and any(t.casefold() in text.casefold() for t in spec.match.text_any)


def extract(spec: SignalSpec, sender: str, text: str) -> dict[str, str] | None:
    """The fields that may leave the device, or None if the notification doesn't match."""
    if not matches(spec, sender, text):
        return None
    found: dict[str, str] = {}
    for field in spec.extract:
        pattern = EXTRACTORS.get(field)
        hit = pattern.search(text) if pattern else None
        if hit is None:
            continue
        if field == "service_time":
            found[field] = f"{hit.group(1)}:{hit.group(2)}"
        else:
            found[field] = next(g for g in hit.groups() if g).strip()
    return found


def only_declared(spec: SignalSpec, fields: dict[str, str]) -> bool:
    """The Gateway's side of the privacy rule: anything undeclared is refused, not dropped."""
    return set(fields) <= set(spec.extract)
