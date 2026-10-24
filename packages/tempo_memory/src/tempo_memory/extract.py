"""Memory candidates from what the person said, by rule (no model, so it can't be talked into
anything). Each candidate still goes through the Memory Gate; this only proposes.

An LLM extractor can replace it behind the same signature; it must read only the person's own
turns and verified tool results, never company text.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any

from tempo_memory.models import Category, MemoryCandidate, Source

Extractor = Callable[[str, str, Source, datetime, float], list[MemoryCandidate]]

_FACT = r"(?P<fact>[^.!?\n]{2,80})"
_NAME = r"[A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'-]+){0,2}"
_PEOPLE = "daughter|son|wife|husband|partner|carer|friend|neighbour"
_CONDITIONS = "diabetic|blind|disabled|dyslexic"
_AIDS = "wheelchair|hearing aid|guide dog"
# How the person needs Tempo to speak with them (`access`): read back before it's kept (the Gate).
_HEARING = "deaf|partially deaf|hard of hearing"
_LANGUAGES = (
    "English|Hindi|Punjabi|Polish|Urdu|Welsh|Bengali|Gujarati|Tamil|Arabic|Somali|Romanian"
    "|Portuguese|Spanish|French|Cantonese|Mandarin"
)
_RULES: list[tuple[str, Category, str, float]] = [
    (rf"(?i)\bremember (?:that )?I {_FACT}", "preference", "{fact}", 0.95),
    (rf"(?i)\bI(?: would|'d)? prefer {_FACT}", "preference", "prefers {fact}", 0.9),
    (rf"(?i)\bI(?: would|'d) rather {_FACT}", "preference", "would rather {fact}", 0.9),
    (rf"\bI (?:now )?live in (?P<place>{_NAME})", "household", "lives in {place}", 0.85),
    (rf"\bI(?:'ve| have)? moved to (?P<place>{_NAME})", "household", "lives in {place}", 0.85),
    (rf"\b[Mm]y (?P<rel>{_PEOPLE}) (?P<name>{_NAME})", "contact", "{name} is their {rel}", 0.85),
    (
        rf"\bI commute (?:from )?(?P<a>{_NAME}) to (?P<b>{_NAME})",
        "journey",
        "commutes {a} to {b}",
        0.85,
    ),
    (rf"(?i)\bI(?:'m| am) (?P<cond>{_CONDITIONS})\b", "health", "is {cond}", 0.85),
    (rf"(?i)\bI (?:use|have) (?:a )?(?P<aid>{_AIDS})\b", "health", "has a {aid}", 0.85),
    (
        r"(?i)\bI(?:'ve got| have got| have)? (?:a )?(?:stammer|stutter)\b",
        "access",
        "has a stammer",
        0.85,
    ),
    (rf"(?i)\bI(?:'m| am) (?P<hear>{_HEARING})\b", "access", "is {hear}", 0.85),
    (r"(?i)\bI (?:can't|cannot) hear (?:very )?well\b", "access", "is hard of hearing", 0.8),
    (
        r"(?i)\b(?:speak|talk)(?: to me)? (?:more )?(?:slowly|slower)\b",
        "access",
        "wants slower speech",
        0.9,
    ),
    (
        r"(?i)\byou(?:'re| are)? (?:talking|speaking) too fast\b",
        "access",
        "wants slower speech",
        0.85,
    ),
    (r"(?i)\bgive me (?:more |some |a bit of )?time\b", "access", "needs more time to answer", 0.9),
    (
        r"(?i)\bI need (?:more |some )?time to (?:answer|reply|respond|speak)\b",
        "access",
        "needs more time to answer",
        0.9,
    ),
    (r"(?i)\bdon'?t rush me\b", "access", "needs more time to answer", 0.9),
    (
        rf"(?i)\b(?:speak|talk)(?: to me)? in (?P<lang>{_LANGUAGES})\b",
        "access",
        "speaks {lang}",
        0.9,
    ),
    (rf"(?i)\bI speak (?P<lang>{_LANGUAGES})\b", "access", "speaks {lang}", 0.9),
    (rf"(?i)\bin (?P<lang>{_LANGUAGES}),? please\b", "access", "speaks {lang}", 0.9),
    (rf"(?i)\bcan you (?:speak|talk) (?P<lang>{_LANGUAGES})\b", "access", "speaks {lang}", 0.8),
    (
        r"(?i)\b(?:text|message) me (?:the questions?|instead)\b",
        "access",
        "prefers text for questions",
        0.85,
    ),
    (r"(?i)\bask me by text\b", "access", "prefers text for questions", 0.85),
    (
        r"(?i)\b(?:use|with|have|try) a (?:lower|deeper)(?:-pitched)? voice\b",
        "access",
        "prefers a lower voice",
        0.85,
    ),
    (
        r"(?i)\bI (?:can't|cannot|struggle to) hear high(?:-pitched)? voices\b",
        "access",
        "prefers a lower voice",
        0.85,
    ),
]
RULES = [
    (re.compile(pattern), c, template, confidence) for pattern, c, template, confidence in _RULES
]


def _clean(groups: dict[str, Any]) -> dict[str, str]:
    return {k: " ".join(str(v).split()).rstrip(" ,;:") for k, v in groups.items() if v}


def extract_candidates(
    text: str, user_id: str, source: Source, at: datetime, confidence: float = 1.0
) -> list[MemoryCandidate]:
    """`confidence` scales each rule's own (e.g. the speech recogniser's confidence)."""
    found: dict[str, MemoryCandidate] = {}
    for pattern, category, template, rule_confidence in RULES:
        for match in pattern.finditer(text):
            fact = template.format(**_clean(match.groupdict()))
            candidate = MemoryCandidate(
                user_id=user_id, text=fact, category=category, source=source, observed_at=at,
                confidence=round(rule_confidence * confidence, 3),
            )  # fmt: skip
            found.setdefault(candidate.key, candidate)
    return list(found.values())
