"""The Consent Ledger: what a person has authorised, merged so that deny always wins.

Consent arrives from any device (voice, SMS "YES", a passkey tap) and can be revoked from any of
them ("STOP"), possibly late or out of order. The merge is pure and order-independent, and every
ambiguity resolves to Tempo doing less (docs/adr/0004-deny-wins.md).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import AwareDatetime, BaseModel, ConfigDict

from tempo_core.errors import ConsentConflict

LimitValue = Decimal | bool


class ConsentKind(StrEnum):
    GRANT = "grant"
    REVOKE = "revoke"


class ConsentEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    mission_id: str
    scope: str  # "file_claim", "phone_company", "accept_offer", ...
    kind: ConsentKind
    at: AwareDatetime
    expires_at: AwareDatetime | None = None
    limits: dict[str, LimitValue] = {}
    device_sig: str  # verified upstream (Mesh)


class ConsentState(BaseModel):
    model_config = ConfigDict(frozen=True)

    allowed: frozenset[str]
    limits: dict[str, LimitValue]

    def allows(self, scope: str) -> bool:
        return scope in self.allowed


def effective_consent(events: Iterable[ConsentEvent], now: datetime) -> ConsentState:
    """Merge consent events into what is allowed right now.

    - A REVOKE at or after a GRANT cancels it, whatever order the events arrived in. Revokes
      count even if stamped in the future (a device clock running fast must not delay a STOP).
    - Expired grants, and grants not yet valid, count for nothing.
    - Limits come from the active grants, and the most restrictive value wins: caps take the
      minimum, floors (keys starting ``min_``) take the maximum, booleans take AND.
    """
    events = list(events)
    last_revoke: dict[str, datetime] = {}
    for e in events:
        if e.kind is ConsentKind.REVOKE and (
            e.scope not in last_revoke or e.at > last_revoke[e.scope]
        ):
            last_revoke[e.scope] = e.at
    active = [e for e in events if _is_active_grant(e, now, last_revoke.get(e.scope))]
    return ConsentState(allowed=frozenset(e.scope for e in active), limits=_merge_limits(active))


def _is_active_grant(e: ConsentEvent, now: datetime, revoked_at: datetime | None) -> bool:
    if e.kind is not ConsentKind.GRANT or e.at > now:
        return False
    if e.expires_at is not None and now >= e.expires_at:
        return False
    return revoked_at is None or e.at > revoked_at  # a tie goes to the revoke


def _merge_limits(grants: list[ConsentEvent]) -> dict[str, LimitValue]:
    values: dict[str, list[LimitValue]] = defaultdict(list)
    for grant in grants:
        for key, value in grant.limits.items():
            values[key].append(value)
    merged: dict[str, LimitValue] = {}
    for key, found in values.items():
        flags = [v for v in found if isinstance(v, bool)]
        if flags and len(flags) != len(found):
            raise ConsentConflict(f"limit {key!r} is a yes/no in one grant and a number in another")
        if flags:
            merged[key] = all(flags)
        else:
            numbers = [v for v in found if not isinstance(v, bool)]
            merged[key] = max(numbers) if key.startswith("min_") else min(numbers)
    return merged
