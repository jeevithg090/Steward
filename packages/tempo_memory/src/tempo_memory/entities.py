"""What goes into the temporal graph: trusted episodes, and the entity types Graphiti extracts.

Only JSON produced by Tempo's own code becomes an episode (spec §17.4): promises, appointments,
deadlines, references and outcomes, each a strict model. Company emails and call transcripts
never do; they stay in the Evidence Vault. A payload with an unknown field, free text where a
name belongs, or an event we don't know is rejected, so the graph stays clean and hard to poison.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter

UserId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]  # a Graphiti group id
# A name, not a sentence: up to four words ("London North Eastern Railway"), and labels up to five.
CompanyName = Annotated[
    str,
    StringConstraints(max_length=40, pattern=r"^[A-Za-z0-9&.'()-]+(?: [A-Za-z0-9&.'()-]+){0,3}$"),
]
Label = Annotated[
    str, StringConstraints(max_length=40, pattern=r"^[A-Za-z0-9'-]+(?: [A-Za-z0-9'-]+){0,4}$")
]
Reference = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9-]{3,32}$")]
Money = Annotated[Decimal, Field(ge=0, le=100_000, max_digits=8, decimal_places=2)]


class _Episode(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
    user_id: UserId
    mission_id: str | None = None
    at: AwareDatetime  # when it happened: the graph's reference time


class AppointmentBooked(_Episode):
    event: Literal["appointment"] = "appointment"
    company: CompanyName
    what: Label  # "engineer visit"
    starts_at: AwareDatetime
    ends_at: AwareDatetime


class PromiseMade(_Episode):
    event: Literal["promise"] = "promise"
    company: CompanyName
    amount_gbp: Money
    due_by: AwareDatetime
    reference: Reference | None = None


class DeadlineSet(_Episode):
    event: Literal["deadline"] = "deadline"
    what: Label  # "payment check", "appeal window closes"
    due_at: AwareDatetime


class ReferenceGiven(_Episode):
    event: Literal["reference"] = "reference"
    company: CompanyName
    reference: Reference


class OutcomeRecorded(_Episode):
    event: Literal["outcome"] = "outcome"
    company: CompanyName
    state: Literal["verified", "completed", "failed_safe"]
    amount_gbp: Money | None = None


class VoiceSet(_Episode):
    """How Tempo's voice was set up for one call, from what the person asked (Patience Profile)."""

    event: Literal["voice"] = "voice"
    language: Annotated[str, StringConstraints(pattern=r"^[a-z]{2}$")]
    speed: Annotated[Decimal, Field(ge=Decimal("0.7"), le=Decimal("1.2"), decimal_places=2)]
    voice: Literal["default", "low"] = "default"
    patience: Literal["normal", "high"] = "normal"
    prefers_text: bool = False


Episode = Annotated[
    AppointmentBooked | PromiseMade | DeadlineSet | ReferenceGiven | OutcomeRecorded | VoiceSet,
    Field(discriminator="event"),
]
EPISODE = TypeAdapter[Episode](Episode)


# Graphiti custom entity types. The descriptions steer its extraction; field names avoid the ones
# Graphiti reserves (uuid, name, group_id, labels, created_at, summary, attributes).


class Person(BaseModel):
    """Someone in the user's life, e.g. a helper or family member."""

    relation: str | None = Field(None, description="How they relate to the user, e.g. daughter")


class Company(BaseModel):
    """A company the user deals with."""

    sector: str | None = Field(None, description="e.g. rail, broadband, energy")


class Service(BaseModel):
    """Something a company provides the user, e.g. a broadband line or a rail journey."""

    provider: str | None = Field(None, description="The company providing it")


class Appointment(BaseModel):
    """A booked slot, e.g. an engineer visit."""

    starts_at: datetime | None = Field(None, description="When the slot starts")
    ends_at: datetime | None = Field(None, description="When the slot ends")


class Case(BaseModel):
    """One of Tempo's missions for the user."""

    mission_id: str | None = Field(None, description="Tempo's mission id")
    state: str | None = Field(None, description="The mission's state")


class Promise(BaseModel):
    """Something a company said it would do or pay."""

    amount_gbp: str | None = Field(None, description="Amount in pounds, as written")
    due_by: datetime | None = Field(None, description="When it is due")


class Deadline(BaseModel):
    """A date something must happen by."""

    due_at: datetime | None = Field(None, description="The deadline")


ENTITY_TYPES: dict[str, type[BaseModel]] = {
    "Person": Person, "Company": Company, "Service": Service, "Appointment": Appointment,
    "Case": Case, "Promise": Promise, "Deadline": Deadline,
}  # fmt: skip
