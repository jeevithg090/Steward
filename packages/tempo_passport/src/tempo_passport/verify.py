"""Check a mandate offline: who signed it, whether it is live, and whether it covers a request.

Deterministic and local, so Tempo's Harness and the company's agent run the same code and get the
same answer. Everything fails closed: a signature that can't be checked, a key that can't be read
or a revocation status that can't be fetched is a refusal, never a pass (docs/adr/0004). Reason
codes are fixed strings shared with the browser verifier and the voice line; how signatures are
checked (and why sign counts are not) is in `signature.py`.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from decimal import Decimal
from types import MappingProxyType
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from tempo_passport.mandate import ACTIONS, Mandate, SignedMandate
from tempo_passport.signature import Assurance, signature_reason

Reason = Literal[
    "ok", "bad_signature", "bad_key", "unknown_version", "expired", "not_yet_valid", "revoked",
    "wrong_counterparty", "action_not_allowed", "amount_above_max", "amount_below_min",
    "status_unreachable",
]  # fmt: skip
Revoked = Callable[[str], bool | None]  # mandate id -> revoked? None when it can't be asked
NO_KEYS: Mapping[str, bytes] = MappingProxyType({})

MESSAGES: dict[Reason, str] = {
    "ok": "This mandate is signed and still valid.",
    "bad_signature": "The signature does not match this mandate, so I can't trust it.",
    "bad_key": "I can't use the key on this mandate, so I can't trust it.",
    "unknown_version": "This mandate is in a form I don't know, so I can't trust it.",
    "expired": "This mandate has run out.",
    "not_yet_valid": "This mandate has not started yet.",
    "revoked": "The person has cancelled this mandate.",
    "wrong_counterparty": "This mandate is not for this company.",
    "action_not_allowed": "This mandate does not allow that.",
    "amount_above_max": "That is more than this mandate allows.",
    "amount_below_min": "That is less than this mandate allows.",
    "status_unreachable": "I can't check if this mandate was cancelled, so I won't rely on it.",
}
UNREADABLE = "I can't read this mandate, so I can't trust it."
COVERS = "This mandate covers this."
SIGNED_AND_COVERS = "This mandate is signed, still valid and covers this."
_COVERING = {
    "claim": "claims", "call": "calls", "accept_cash": "taking cash",
    "accept_voucher": "taking a voucher", "discuss_other_accounts": "other accounts",
    "change_contract": "contract changes", "share_personal_data": "sharing personal details",
    "escalate": "taking this further",
}  # fmt: skip


class Verdict(BaseModel):
    model_config = ConfigDict(frozen=True)

    ok: bool
    reason: Reason
    message: str  # plain words; never the key or the nonce
    assurance: Assurance
    checked_at: AwareDatetime
    latency_ms: float


def verify(
    signed: SignedMandate,
    *,
    now: datetime,
    revoked: Revoked | None = None,
    gateway_keys: Mapping[str, bytes] = NO_KEYS,
) -> Verdict:
    """Is this mandate genuine and live? Version, signature, window, then revocation."""
    started = time.perf_counter()
    reason, assurance = _verify(signed, now, revoked, gateway_keys)
    return _verdict(reason, assurance, now, started, MESSAGES[reason])


def allows(
    mandate: Mandate, *, counterparty: str, action: str, amount_gbp: Decimal | None = None
) -> Verdict:
    """Does the mandate cover this request? Scope only: it says nothing about the signature."""
    started = time.perf_counter()
    reason = _scope(mandate, counterparty, action, amount_gbp)
    message = _message(reason, mandate, action, amount_gbp)
    return _verdict(reason, "none", datetime.now(tz=UTC), started, message)


def check(
    signed: SignedMandate,
    *,
    now: datetime,
    counterparty: str,
    action: str,
    amount_gbp: Decimal | None = None,
    revoked: Revoked | None = None,
    gateway_keys: Mapping[str, bytes] = NO_KEYS,
) -> Verdict:
    """`verify`, then `allows`: the one call a guard or a counterparty needs."""
    started = time.perf_counter()
    reason, assurance = _verify(signed, now, revoked, gateway_keys)
    if reason == "ok":
        reason = _scope(signed.mandate, counterparty, action, amount_gbp)
    message = _message(reason, signed.mandate, action, amount_gbp, ok=SIGNED_AND_COVERS)
    return _verdict(reason, assurance, now, started, message)


def check_envelope(
    envelope: str | bytes | Mapping[str, Any],
    *,
    now: datetime,
    counterparty: str,
    action: str,
    amount_gbp: Decimal | None = None,
    revoked: Revoked | None = None,
    gateway_keys: Mapping[str, bytes] = NO_KEYS,
) -> Verdict:
    """`check` for an envelope straight off the wire: one that can't be read is refused."""
    started = time.perf_counter()
    try:
        signed = (
            SignedMandate.model_validate_json(envelope)
            if isinstance(envelope, str | bytes)
            else SignedMandate.model_validate(envelope)
        )
    except ValidationError:
        reason = _unreadable(envelope)
        message = MESSAGES[reason] if reason == "unknown_version" else UNREADABLE
        return _verdict(reason, "none", now, started, message)
    return check(
        signed, now=now, counterparty=counterparty, action=action, amount_gbp=amount_gbp,
        revoked=revoked, gateway_keys=gateway_keys,
    )  # fmt: skip


# Internals ---------------------------------------------------------------------------------------


def _verify(
    signed: SignedMandate, now: datetime, revoked: Revoked | None, keys: Mapping[str, bytes]
) -> tuple[Reason, Assurance]:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    mandate = signed.mandate
    if mandate.v != 1:
        return "unknown_version", "none"
    signed_ok, assurance = signature_reason(signed, keys)
    if signed_ok != "ok":
        return signed_ok, "none"
    if now < mandate.issued_at:
        return "not_yet_valid", "none"
    if now >= mandate.expires_at:
        return "expired", "none"
    status = "ok" if revoked is None else _revocation(revoked, mandate.mandate_id)
    return status, assurance if status == "ok" else "none"


def _revocation(revoked: Revoked, mandate_id: str) -> Reason:
    try:
        status = revoked(mandate_id)
    except Exception:  # a status service that fails is one we couldn't reach
        status = None
    if status is None:
        return "status_unreachable"
    return "revoked" if status else "ok"


def _scope(mandate: Mandate, counterparty: str, action: str, amount: Decimal | None) -> Reason:
    if counterparty.strip().casefold() != mandate.counterparty.strip().casefold():
        return "wrong_counterparty"
    if action not in ACTIONS or action in mandate.may_not or action not in mandate.may:
        return "action_not_allowed"
    if amount is None:
        return "ok"
    if not amount.is_finite() or amount > mandate.amount.max_gbp:
        return "amount_above_max"
    if amount < mandate.amount.min_gbp:
        return "amount_below_min"
    return "ok"


def _message(
    reason: Reason, mandate: Mandate, action: str, amount: Decimal | None, *, ok: str = COVERS
) -> str:
    if reason == "ok":
        return ok
    if reason == "action_not_allowed" and action in _COVERING:
        return f"This mandate does not cover {_COVERING[action]}."
    if reason == "amount_above_max" and amount is not None and amount.is_finite():
        return f"£{amount} is more than the £{mandate.amount.max_gbp} this mandate allows."
    if reason == "amount_below_min" and amount is not None:
        return f"£{amount} is less than the £{mandate.amount.min_gbp} this mandate allows."
    return MESSAGES[reason]


def _unreadable(envelope: str | bytes | Mapping[str, Any]) -> Reason:
    try:
        raw: Any = json.loads(envelope) if isinstance(envelope, str | bytes) else envelope
        version = raw["mandate"]["v"]
    except (ValueError, TypeError, KeyError):
        return "bad_signature"
    return "bad_signature" if version == 1 else "unknown_version"


def _verdict(
    reason: Reason, assurance: Assurance, now: datetime, started: float, message: str
) -> Verdict:
    return Verdict(
        ok=reason == "ok", reason=reason, message=message, assurance=assurance, checked_at=now,
        latency_ms=(time.perf_counter() - started) * 1000,
    )  # fmt: skip
