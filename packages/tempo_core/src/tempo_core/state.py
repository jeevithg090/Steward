"""The mission lifecycle (spec §7.1) as data, so an illegal jump is a typed error, not a bug."""

from __future__ import annotations

from datetime import datetime
from types import MappingProxyType

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from tempo_core.errors import IllegalTransition
from tempo_core.models import MissionState

S = MissionState

# The state diagram in spec §7.1.
SPEC_TRANSITIONS: frozenset[tuple[MissionState, MissionState]] = frozenset(
    {
        (S.RECEIVED, S.UNDERSTOOD),
        (S.UNDERSTOOD, S.PLANNED),
        (S.PLANNED, S.APPRAISED),
        (S.APPRAISED, S.DECLINED),
        (S.APPRAISED, S.AWAITING_CONSENT),
        (S.AWAITING_CONSENT, S.RUNNING),
        (S.RUNNING, S.CHECKPOINT),
        (S.CHECKPOINT, S.RUNNING),
        (S.RUNNING, S.WAITING),
        (S.WAITING, S.RUNNING),
        (S.RUNNING, S.COMPLETED),
        (S.RUNNING, S.FAILED_SAFE),
        (S.COMPLETED, S.VERIFIED),
    }
)

# Moves the diagram leaves out but the spec's text needs.
SPEC_TEXT_TRANSITIONS: frozenset[tuple[MissionState, MissionState]] = frozenset(
    {
        (S.APPRAISED, S.RUNNING),  # nothing binding to approve (e.g. explaining a letter)
        (S.AWAITING_CONSENT, S.DECLINED),  # the person said no (§13)
        # The kill switch stops a mission wherever it is (§7.4).
        (S.AWAITING_CONSENT, S.FAILED_SAFE),
        (S.CHECKPOINT, S.FAILED_SAFE),
        (S.WAITING, S.FAILED_SAFE),
    }
)

TERMINAL: frozenset[MissionState] = frozenset({S.DECLINED, S.FAILED_SAFE, S.VERIFIED})

_NEXT: MappingProxyType[MissionState, frozenset[MissionState]] = MappingProxyType(
    {
        state: frozenset(b for a, b in SPEC_TRANSITIONS | SPEC_TEXT_TRANSITIONS if a is state)
        for state in MissionState
    }
)


class StateChanged(BaseModel):
    """One transition, for the case_events table and Mission Control's per-stage timer."""

    model_config = ConfigDict(frozen=True)

    mission_id: str
    from_state: MissionState
    to_state: MissionState
    at: AwareDatetime
    latency_ms: int = Field(ge=0)  # time spent in from_state


def allowed_next(current: MissionState) -> frozenset[MissionState]:
    return _NEXT[current]


def transition(current: MissionState, to: MissionState) -> MissionState:
    """Return `to` if the lifecycle allows it, else raise IllegalTransition."""
    if to not in _NEXT[current]:
        raise IllegalTransition(current, to)
    return to


def advance(
    mission_id: str,
    current: MissionState,
    to: MissionState,
    *,
    entered_at: datetime,
    now: datetime,
) -> StateChanged:
    """Validate a transition and describe it, including how long the mission sat in `current`."""
    transition(current, to)
    if now < entered_at:
        raise ValueError("a mission cannot leave a state before it entered it")
    latency_ms = int((now - entered_at).total_seconds() * 1000)
    return StateChanged(
        mission_id=mission_id, from_state=current, to_state=to, at=now, latency_ms=latency_ms
    )
