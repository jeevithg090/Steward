"""The Consensus Court's port: what a juror is asked, and what it may answer."""

from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from tempo_core.models import Fact


class CaseQuestion(BaseModel):
    """An eligibility question that needs interpretation, e.g. "were these extraordinary
    circumstances?". The amount is never up for a vote: the Rights Engine has already set it."""

    model_config = ConfigDict(frozen=True)

    mission_id: str
    question: str
    rule_id: str
    rule_text: str  # the passage being interpreted, quoted from the operator's terms
    facts: tuple[Fact, ...] = ()


class JurorVerdict(BaseModel):
    model_config = ConfigDict(frozen=True)

    eligible: bool
    rule_id: str
    band: str | None = None
    # Recorded for the audit trail only: the court never uses a juror's amount.
    amount_gbp: Decimal | None = None
    citations: tuple[str, ...] = ()
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(default="", max_length=600)


class Juror(Protocol):
    @property
    def name(self) -> str: ...

    async def deliberate(self, question: CaseQuestion) -> JurorVerdict: ...
