"""Vision port: a photo of a ticket, letter or bill in, sourced facts out."""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol

from tempo_core.models import Fact


class DocumentKind(StrEnum):
    TICKET = "ticket"
    LETTER = "letter"
    BENEFIT_DECISION = "benefit_decision"  # e.g. a PIP decision letter (S7.2)
    MISSED_VISIT = "missed_visit"  # a "sorry we missed you" card or text (Rights Decay, R8)
    OFFICIAL_LETTER = "official_letter"  # any bill, reminder or decision: Read It To Me (1b)


class VisionPort(Protocol):
    async def extract(
        self, image: bytes, *, mime_type: str, kind: DocumentKind, filename: str
    ) -> tuple[Fact, ...]:
        """Every fact carries a source ("<filename>#vision") and a confidence from 0 to 1."""
        ...
