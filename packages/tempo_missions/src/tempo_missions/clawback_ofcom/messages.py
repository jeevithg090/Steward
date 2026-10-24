"""Messages between the Ofcom mission's steps. Checkpointed, so plain values only: money as
strings, nested models as JSON. Only these types (and the shared rail ones) may be restored."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date

from tempo_core.models import ProofTrace
from tempo_core.rights_decay import Plan
from tempo_missions.clawback_rail import messages as shared
from tempo_ports.claims import ClaimReceipt


@dataclass(frozen=True)
class OfcomRequest:
    """A missed engineer visit: Ofcom's automatic compensation, and what to do if it's late."""

    mission_id: str
    user_id: str
    display_name: str
    operator: str  # the provider who missed the visit, e.g. "Broadbandly"
    event_date: str  # YYYY-MM-DD, the day of the missed visit
    notice_hours: str | None  # None: nobody came and nobody called
    time_value_gbp_h: str
    account_ref: str | None = None
    hazard_id: str = "nyc311.hpd.all"  # which curve says how often this gets paid on its own
    source: str = "you"  # where the date came from, e.g. "card.png#vision, confirmed by you"


@dataclass(frozen=True)
class OfcomCase:
    request: OfcomRequest
    facts_json: str = "[]"
    trace_json: str | None = None
    plan_json: str | None = None
    court_note: str | None = None
    court_json: str | None = None
    receipt_json: str | None = None
    paid_amount_gbp: str | None = None
    paid_on_its_own: bool = False
    payment_checks: int = 0
    replans: int = 0
    happened: tuple[str, ...] = ()  # events that unlock rights, e.g. "complaint_sent"
    complaint_date: str | None = None  # YYYY-MM-DD, once Tempo has complained
    chosen: str | None = None  # the right Tempo used
    way: str | None = None  # how (an ActionOption id)
    minutes_saved: str = "0"

    @property
    def trace(self) -> ProofTrace:
        if self.trace_json is None:
            raise ValueError("this case has no Proof Trace yet")
        return ProofTrace.model_validate_json(self.trace_json)

    @property
    def plan(self) -> Plan:
        if self.plan_json is None:
            raise ValueError("this case has no plan yet")
        return Plan.model_validate_json(self.plan_json)

    @property
    def receipt(self) -> ClaimReceipt:
        if self.receipt_json is None:
            raise ValueError("no claim has been filed yet")
        return ClaimReceipt.model_validate_json(self.receipt_json)

    @property
    def missed_on(self) -> date:
        return date.fromisoformat(self.request.event_date)

    def with_(self, **changes: object) -> OfcomCase:
        return replace(self, **changes)  # type: ignore[arg-type]


CHECKPOINT_TYPES = [
    *shared.CHECKPOINT_TYPES,
    *(f"{__name__}:{cls.__name__}" for cls in (OfcomRequest, OfcomCase)),
]
