"""What Scam Shield says out loud (docs/scam-shield.md §5.4).

The warning comes first, in the person's language; then why, in plain English fragments built
from the family, link and sandbox findings (never from the message itself); then what to do. The
six Patience Profile languages live in voice/warnings.yaml (`checked: false` until a speaker of
each has read them); English is here so tests/unit/test_plain_language.py can hold it to Flesch 60.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

import yaml

from tempo_core.scam import ADVICE, Level, Verdict, Zone

WARN = "Do not touch that message. It is a trick trying to take your money."
HOLD = "I'm checking that message. Don't tap anything in it yet."
CLEARED = "I checked that message. I found no warning signs. That doesn't prove it's real."
CAUTION = (
    "Take care with that message. It is pushing you to act fast. Do nothing until you have "
    "checked with someone you trust."
)
UNKNOWN = "I could not check that message. Don't act on it until I can."
RING = "Ring the firm on a number you already know."
ENGLISH: Mapping[str, str] = {
    "warn": WARN,
    "hold": HOLD,
    "cleared": CLEARED,
    "caution": CAUTION,
    "unknown": UNKNOWN,
    "no_flags": ADVICE[Level.NO_FLAGS],
    "ring": RING,
    "why": "Why:",
}
KEYS = tuple(ENGLISH)


def load_warnings(path: Path) -> dict[str, dict[str, str]]:
    """The spoken lines by language code (voice/warnings.yaml), or {} if the file is absent.
    English is always complete; another language may give a subset and falls back to English."""
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    found: dict[str, dict[str, str]] = {}
    for code, lines in (data.get("warnings") or {}).items():
        found[str(code)] = {str(k): str(v) for k, v in (lines or {}).items() if k in KEYS}
    return found


def why_sentence(verdict: Verdict, *, lines: Mapping[str, str] = ENGLISH, limit: int = 3) -> str:
    """ "Why: it pretends to be a tax refund, and its link only looks like HMRC's." or ""."""
    why = [w for w in verdict.why if w][:limit]
    if not why:
        return ""
    joined = why[0] if len(why) == 1 else ", ".join(why[:-1]) + ", and " + why[-1]
    return f"{lines['why']} {joined}."


def say(
    verdict: Verdict,
    *,
    language: str = "en",
    translations: Mapping[str, Mapping[str, str]] | None = None,
    held: bool = False,
) -> str:
    """The sentences the voice speaks for this verdict. `held` is True when the person already
    heard "I'm checking that message", so a clean result is closed with "I checked it".

    Only English carries the reasons: the other languages say the warning and what to do, and
    the reasons are shown in writing, because a half-translated reason misleads more than none.
    """
    lines: Mapping[str, str] = {**ENGLISH, **((translations or {}).get(language) or {})}
    english = language == "en" or lines is ENGLISH
    why = why_sentence(verdict) if english else ""
    if verdict.level is Level.LIKELY_SCAM:
        return _join(lines["warn"], why, lines["ring"])
    if verdict.zone is Zone.SANDBOX:
        return lines["hold"]
    if verdict.level is Level.CAUTION:
        return _join(lines["caution"], why)
    if verdict.level is Level.UNKNOWN:
        return lines["unknown"]
    return lines["cleared"] if held else lines["no_flags"]


def _join(*parts: str) -> str:
    return " ".join(p for p in parts if p)
