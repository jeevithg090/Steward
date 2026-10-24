"""Domain models shared by every package: facts, proof traces, mission states and capsules."""

from __future__ import annotations

from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer


def _tag_decimal(value: str | int | Decimal) -> str | int | dict[str, str]:
    # JSON has no decimal type: a bare "14.20" would come back as a str, so money is tagged.
    if isinstance(value, Decimal):
        return {"decimal": str(value)}
    return value


def _untag_decimal(value: Any) -> Any:
    if isinstance(value, dict) and value.keys() == {"decimal"}:
        return Decimal(value["decimal"])
    return value


FactValue = Annotated[
    str | int | Decimal,
    BeforeValidator(_untag_decimal),
    PlainSerializer(_tag_decimal, when_used="json"),
]


class Fact(BaseModel):
    """One piece of evidence, always with where it came from and how sure we are."""

    model_config = ConfigDict(frozen=True)

    key: str
    value: FactValue
    source: str = Field(min_length=1)  # "ticket.jpg#ocr", "hsp:RID:202610238123"
    confidence: float = Field(ge=0.0, le=1.0)


class ProofStep(BaseModel):
    model_config = ConfigDict(frozen=True)

    fact_keys: tuple[str, ...]
    rule_id: str
    rule_version: str
    citation_url: str
    explanation: str  # plain English, shown to the user and to judges


class ProofTrace(BaseModel):
    """fact (source) → rule (version) → citation → amount, attached to every money step."""

    model_config = ConfigDict(frozen=True)

    id: str
    steps: tuple[ProofStep, ...] = Field(min_length=1)
    amount_gbp: Decimal = Field(ge=0)


class MissionState(StrEnum):
    RECEIVED = "received"
    UNDERSTOOD = "understood"
    PLANNED = "planned"
    APPRAISED = "appraised"
    DECLINED = "declined"
    AWAITING_CONSENT = "awaiting_consent"
    RUNNING = "running"
    CHECKPOINT = "checkpoint"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED_SAFE = "failed_safe"
    VERIFIED = "verified"


class ContextCapsule(BaseModel):
    """Minimal hand-off between agents. Never contains raw documents or secrets.

    Only what the next agent needs crosses an executor boundary, which keeps context small,
    cheap and safe. Contact details stay in the vault and are referenced, never copied here.
    """

    model_config = ConfigDict(frozen=True)

    capsule: str = "v1"
    mission_id: str
    goal: str
    display_name: str
    language: str = "en-GB"
    time_value_gbp_h: Decimal = Field(ge=0)
    facts: tuple[Fact, ...] = ()
    proof_trace_id: str | None = None
    consent_scopes: tuple[str, ...] = ()
    do_not: tuple[str, ...] = ()
