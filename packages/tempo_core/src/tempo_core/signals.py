"""On-device signal filters (spec §15.9, build plan S5.3): the reference behaviour.

A skill declares which signals it needs (skills/*/signals.yaml). Each device checks them
locally, and only the declared `extract` fields of a matching notification leave it, never the
notification itself. The Android node (apps/android-signal) implements the same rules and is
tested against the same vectors (fixtures/signals/notifications.json for the rail signal,
fixtures/signals/scam_messages.json for Scam Shield).

Schema v2 (docs/scam-shield.md §5.1) adds to `match`, all optional so the rail signal is
unchanged: `families` (named phrase lists; a family fires on any of its phrases), `links` (a link
with a strong finding is a match on its own) and `model` (a text model shipped as data; a score
in the warn or sandbox zone is a match). It adds four extractors: `rules`, `sender_domain`,
`link_hosts` and `score`.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field

from tempo_core.links import find_links, link_hosts
from tempo_core.scam_model import Score, score_text

EXTRACTORS: dict[str, re.Pattern[str]] = {
    "service_time": re.compile(r"\b([01]\d|2[0-3])[:.]?([0-5]\d)\b"),
    "origin": re.compile(r"\bfrom ([A-Z][A-Za-z' ]+?) to\b|\b([A-Z][A-Za-z' ]+?) to [A-Z]"),
    "destination": re.compile(r"\bto ([A-Z][A-Za-z' ]+?)(?: is| has| was|[.,]|$)"),
    "delay_minutes": re.compile(r"\b(\d{1,3}) ?(?:min(?:ute)?s?)\b", re.I),
}
# The v2 fields are derived from the whole message, not pulled out of it with one regex.
DERIVED: frozenset[str] = frozenset({"rules", "sender_domain", "link_hosts", "score"})
FIELDS: frozenset[str] = frozenset(EXTRACTORS) | DERIVED
MODEL_PATH = re.compile(r"^[a-z0-9-]+/model\.json$")  # relative to skills/


class Match(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    sender_any: tuple[str, ...]
    text_any: tuple[str, ...] = ()
    families: dict[str, tuple[str, ...]] = {}
    links: bool = False
    model: str | None = Field(default=None, pattern=MODEL_PATH.pattern)

    @property
    def gated_by_text(self) -> bool:
        """True when the message's words decide (v1 shape): `text_any` alone, nothing else."""
        return bool(self.text_any) and not (self.families or self.links or self.model)


class SignalSpec(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    sources: tuple[str, ...]
    match: Match
    extract: tuple[str, ...] = Field(min_length=1)
    retention_days: int = Field(gt=0)


def load_signals(path: Path) -> list[SignalSpec]:
    specs = [
        SignalSpec.model_validate(s)
        for s in yaml.safe_load(path.read_text(encoding="utf-8"))["signals"]
    ]
    for spec in specs:
        unknown = set(spec.extract) - FIELDS
        if unknown:
            raise ValueError(f"{path}: {spec.id} extracts unknown fields {sorted(unknown)}")
    return specs


def fired_families(spec: SignalSpec, text: str) -> list[str]:
    """The keyword families whose phrases appear in the text, sorted. Plain substrings, case
    folded, exactly as the phone does it."""
    low = text.casefold()
    return sorted(
        name
        for name, phrases in spec.match.families.items()
        if any(p.casefold() in low for p in phrases)
    )


def matches(spec: SignalSpec, sender: str, text: str, *, score: Score | None = None) -> bool:
    """Does this notification concern the skill? The sender must fit; then any one gate fires:
    a `text_any` phrase, a keyword family, a link with a strong finding, or a model score in the
    warn or sandbox zone."""
    sender_ok = any(s.casefold() in sender.casefold() for s in spec.match.sender_any)
    if not sender_ok:
        return False
    low = text.casefold()
    if any(t.casefold() in low for t in spec.match.text_any):
        return True
    if fired_families(spec, text):
        return True
    if spec.match.links and any(link.suspicious for link in find_links(text)):
        return True
    return bool(spec.match.model and score is not None and score.zone != "quiet")


def extract(
    spec: SignalSpec, sender: str, text: str, *, score: Score | None = None
) -> dict[str, str] | None:
    """The fields that may leave the device, or None if the notification doesn't match.

    `score` is the model's answer for this text when the spec names a model and the caller has
    run it; without it the model gate is simply off, which is how the shared vectors stay
    independent of the model file.
    """
    if not matches(spec, sender, text, score=score):
        return None
    found: dict[str, str] = {}
    for field in spec.extract:
        value = _derived(spec, field, sender, text, score)
        if value is not None:
            if value != "":
                found[field] = value
            continue
        pattern = EXTRACTORS.get(field)
        hit = pattern.search(text) if pattern else None
        if hit is None:
            continue
        if field == "service_time":
            found[field] = f"{hit.group(1)}:{hit.group(2)}"
        else:
            found[field] = next(g for g in hit.groups() if g).strip()
    return found


def _derived(
    spec: SignalSpec, field: str, sender: str, text: str, score: Score | None
) -> str | None:
    """A v2 field's value, "" when it has nothing to say, None when `field` is not a v2 field."""
    if field == "rules":
        return ",".join(fired_families(spec, text))
    if field == "sender_domain":
        return sender.rpartition("@")[2].casefold() if "@" in sender else ""
    if field == "link_hosts":
        return ",".join(link_hosts(text))
    if field == "score":
        return score_text(score.probability) if score is not None else ""
    return None


def only_declared(spec: SignalSpec, fields: dict[str, str]) -> bool:
    """The Gateway's side of the privacy rule: anything undeclared is refused, not dropped."""
    return set(fields) <= set(spec.extract)
