"""What Tempo might remember, and what it does remember, always with provenance (spec §17.3)."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

Category = Literal[
    "preference", "contact", "journey", "household", "mission_fact",
    "health", "immigration", "finance",  # sensitive: opt-in only, 30-day expiry
    "access",  # how to speak with the person (a stammer, hearing, a language): opt-in, no expiry
]  # fmt: skip
Source = Literal[
    "user_voice", "user_sms", "user_web", "official_api",  # trusted
    "company_message", "transcript", "letter", "web",  # untrusted: evidence only
]  # fmt: skip


class Trust(StrEnum):
    TRUSTED = "trusted"
    UNTRUSTED = "untrusted"


TRUSTED_SOURCES: frozenset[str] = frozenset({"user_voice", "user_sms", "user_web", "official_api"})


class MemoryCandidate(BaseModel):
    model_config = ConfigDict(frozen=True)

    user_id: str
    text: str = Field(min_length=1)  # "prefers phone updates"
    category: Category
    source: Source
    observed_at: AwareDatetime
    confidence: float = Field(ge=0.0, le=1.0)

    @property
    def trust(self) -> Trust:
        return Trust.TRUSTED if self.source in TRUSTED_SOURCES else Trust.UNTRUSTED

    @property
    def key(self) -> str:
        """Identifies "the same fact" for updates and forgets: category plus normalised text."""
        normalised = " ".join(self.text.casefold().split())
        return hashlib.sha256(f"{self.category}:{normalised}".encode()).hexdigest()[:24]


class MemoryItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    user_id: str
    key: str
    text: str
    category: Category
    source: Source
    trust: Trust
    observed_at: AwareDatetime
    confidence: float
    consent_scope: str | None = None  # set for opt-in categories, e.g. "memory.health"
    expires_at: datetime | None = None
    superseded_by: str | None = None


class Tombstone(BaseModel):
    """A forget. It beats any copy of the fact observed at or before it (another device's late
    write included), so a forgotten thing can't come back from a replica."""

    model_config = ConfigDict(frozen=True)

    user_id: str
    key: str
    at: AwareDatetime


class Verdict(StrEnum):
    STORE = "store"
    EPISODE_ONLY = "episode_only"  # quotable evidence, never a fact about the person
    ASK_USER = "ask_user"  # read it back first: "Shall I remember that you...?"
    REJECT = "reject"


TTL: dict[str, timedelta | None] = {
    "preference": None, "contact": None, "journey": None, "household": None,
    "mission_fact": timedelta(days=395),  # 13 months: the longest claim windows
    "health": timedelta(days=30), "immigration": timedelta(days=30), "finance": timedelta(days=30),
    "access": None,  # a need doesn't lapse; "forget" still deletes it everywhere
}  # fmt: skip
