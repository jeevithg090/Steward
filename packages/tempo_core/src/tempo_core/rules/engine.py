"""The Rights Engine: deterministic entitlements, each with a Proof Trace.

Models may read tickets and argue about eligibility, but every amount comes from here.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from tempo_core.models import Fact, ProofStep, ProofTrace
from tempo_core.rules.schema import ClockPack, DelayRepayPack, DistanceBandPack, FixedAmountPack

PENNY = Decimal("0.01")

AnyPack = DelayRepayPack | FixedAmountPack | DistanceBandPack | ClockPack


@dataclass(frozen=True)
class NotEligible:
    """A decline that still shows its working: which rule said no, and why."""

    reason: str
    rule_id: str
    rule_version: str
    citation_url: str


def evaluate_delay_repay(
    pack: DelayRepayPack,
    *,
    delay_minutes: int,
    fare_gbp: Decimal,
    facts: tuple[Fact, ...],
    trace_id: str,
) -> ProofTrace | NotEligible:
    """Refund for a late train. `fare_gbp` is the fare for the delayed journey."""
    if fare_gbp < 0:
        raise ValueError("fare_gbp cannot be negative")
    if delay_minutes < 0:
        return _decline(pack, "the train arrived early, so there is no delay to claim for")
    band = next(b for b in pack.bands if b.contains(delay_minutes))  # bands cover 0 and up
    if band.refund_pct == 0:
        threshold = min(b.min_minutes for b in pack.bands if b.refund_pct > 0)
        reason = f"{delay_minutes} min late is below the {pack.scheme} threshold of {threshold} min"
        return _decline(pack, reason)
    amount = _money(fare_gbp * band.refund_pct / Decimal(100))
    explanation = (
        f"{delay_minutes} min late → {_pct(band.refund_pct)}% of £{_money(fare_gbp)} "
        f"under {pack.operator} {pack.scheme}"
    )
    return _trace(pack, facts=facts, trace_id=trace_id, amount=amount, explanation=explanation)


def evaluate_missed_appointment(
    pack: FixedAmountPack,
    *,
    notice_hours: Decimal | None,
    facts: tuple[Fact, ...],
    trace_id: str,
) -> ProofTrace | NotEligible:
    """Fixed payment for a missed visit. `notice_hours=None` means nobody came and nobody called."""
    if notice_hours is not None and notice_hours >= pack.min_notice_hours:
        return _decline(
            pack,
            f"the visit was cancelled with {notice_hours} h notice; {pack.scheme} pays only "
            f"under {pack.min_notice_hours} h",
        )
    what = (
        "missed with no notice"
        if notice_hours is None
        else f"cancelled with only {notice_hours} h notice"
    )
    amount = _money(pack.amount_gbp)
    explanation = f"Engineer appointment {what} → £{amount} under {pack.operator} {pack.scheme}"
    return _trace(pack, facts=facts, trace_id=trace_id, amount=amount, explanation=explanation)


def evaluate_distance_band(
    pack: DistanceBandPack,
    *,
    distance_km: int,
    arrival_delay_minutes: int,
    facts: tuple[Fact, ...],
    trace_id: str,
) -> ProofTrace | NotEligible:
    """Flight delay compensation. Extraordinary circumstances are judged before this is called."""
    if distance_km <= 0:
        raise ValueError("distance_km must be positive")
    if arrival_delay_minutes < pack.min_arrival_delay_minutes:
        return _decline(
            pack,
            f"arrived {_duration(arrival_delay_minutes)} late; {pack.scheme} starts at "
            f"{_duration(pack.min_arrival_delay_minutes)}",
        )
    band = next(b for b in pack.bands if b.max_km is None or distance_km <= b.max_km)
    amount = _money(band.amount_gbp)
    explanation = (
        f"Arrived {_duration(arrival_delay_minutes)} late on a {distance_km} km flight "
        f"→ £{amount} under {pack.scheme}"
    )
    return _trace(pack, facts=facts, trace_id=trace_id, amount=amount, explanation=explanation)


def _trace(
    pack: AnyPack, *, facts: tuple[Fact, ...], trace_id: str, amount: Decimal, explanation: str
) -> ProofTrace:
    step = ProofStep(
        fact_keys=tuple(f.key for f in facts),
        rule_id=pack.id,
        rule_version=pack.version,
        citation_url=pack.citation_url,
        explanation=_honest(pack, explanation),
    )
    return ProofTrace(id=trace_id, steps=(step,), amount_gbp=amount)


def _decline(pack: AnyPack, reason: str) -> NotEligible:
    return NotEligible(
        reason=_honest(pack, reason),
        rule_id=pack.id,
        rule_version=pack.version,
        citation_url=pack.citation_url,
    )


def _honest(pack: AnyPack, text: str) -> str:
    if pack.demo_values:
        return f"{text} (demo values: not yet checked against {pack.operator}'s published terms)"
    return text


def _money(value: Decimal) -> Decimal:
    return value.quantize(PENNY, ROUND_HALF_UP)


def _pct(value: Decimal) -> str:
    return f"{value.normalize():f}"


def _duration(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    if not hours:
        return f"{mins} min"
    return f"{hours} h" if not mins else f"{hours} h {mins} min"
