"""Messages between the mission's steps. They're checkpointed, so they hold plain values only:
money as strings, nested models as JSON. Only these types may be restored from a checkpoint."""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal

from tempo_core.models import ProofTrace
from tempo_ports.claims import ClaimReceipt
from tempo_ports.rail import ServiceDelay


@dataclass(frozen=True)
class ClaimRequest:
    mission_id: str
    user_id: str
    display_name: str
    origin_crs: str
    destination_crs: str
    travel_date: str  # YYYY-MM-DD
    departure: str  # HH:MM, the timetabled departure
    fare_gbp: str
    time_value_gbp_h: str


@dataclass(frozen=True)
class RailCase:
    request: ClaimRequest
    journey_json: str
    trace_json: str | None = None
    explanation: str = ""  # the Arbiter's reasoning, in plain words
    user_minutes_saved: str = "0"
    court_note: str | None = None
    receipt_json: str | None = None
    paid_amount_gbp: str | None = None  # set once the watchdog sees the money arrive
    payment_checks: int = 0

    @property
    def journey(self) -> ServiceDelay:
        return ServiceDelay.model_validate_json(self.journey_json)

    @property
    def trace(self) -> ProofTrace:
        if self.trace_json is None:
            raise ValueError("this case has no Proof Trace yet")
        return ProofTrace.model_validate_json(self.trace_json)

    @property
    def receipt(self) -> ClaimReceipt:
        if self.receipt_json is None:
            raise ValueError("no claim has been filed yet")
        return ClaimReceipt.model_validate_json(self.receipt_json)

    def with_(self, **changes: str | None) -> RailCase:
        return replace(self, **changes)  # type: ignore[arg-type]


@dataclass(frozen=True)
class ConsentRequest:
    """Shown on the person's best device (passkey) or read aloud on the landline."""

    mission_id: str
    summary: str
    amount_gbp: str
    scopes: tuple[str, ...]


@dataclass(frozen=True)
class SignedApproval:
    """The person's answer, signed by their device and verified before it's used."""

    approved: bool
    scopes: tuple[str, ...]
    device_sig: str
    limits: tuple[tuple[str, str], ...] = ()  # e.g. (("auto_accept_max_gbp", "50"),)


@dataclass(frozen=True)
class TimerRequest:
    """A durable wait: the workflow sleeps in its checkpoint until the scheduler answers."""

    mission_id: str
    wake_at: str  # an ISO 8601 UTC instant, never a wall-clock time
    reason: str
    attempt: int


@dataclass(frozen=True)
class TimerFired:
    at: str  # ISO 8601 UTC


@dataclass(frozen=True)
class MissionOutcome:
    mission_id: str
    state: str
    message: str
    amount_gbp: str | None = None
    reference: str | None = None
    proof_trace_id: str | None = None

    @property
    def amount(self) -> Decimal | None:
        return Decimal(self.amount_gbp) if self.amount_gbp is not None else None


CHECKPOINT_TYPES = [
    f"{__name__}:{cls.__name__}"
    for cls in (
        ClaimRequest,
        RailCase,
        ConsentRequest,
        SignedApproval,
        TimerRequest,
        TimerFired,
        MissionOutcome,
    )
]
