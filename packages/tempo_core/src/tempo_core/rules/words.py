"""A rule pack in plain words, for the Consensus Court's jurors (plan.md §13.5).

The jurors must read the operator's rule itself, not Tempo's own summary of the result: a model
asked "does this rule cover this journey?" with only "38 min late → 50% of £28.40" and no facts
can, and real ones did, answer no. Amounts here are the rule's, never a calculation.
"""

from __future__ import annotations

from decimal import Decimal

from tempo_core.rules.schema import DelayRepayPack, DistanceBandPack, FixedAmountPack


def _pct(value: Decimal) -> str:
    return f"{value.normalize():f}"


def rule_in_words(pack: DelayRepayPack | FixedAmountPack | DistanceBandPack) -> str:
    """The rule a juror interprets: who it covers, what it pays, by when, and where it is."""
    window = f"Claims must be made within {pack.claim_window_days} days."
    source = f"Published at {pack.citation_url}."
    if isinstance(pack, DelayRepayPack):
        paying = sorted((b for b in pack.bands if b.refund_pct > 0), key=lambda b: b.min_minutes)
        bands = "; ".join(
            f"{b.min_minutes} to {b.max_minutes} minutes late: {_pct(b.refund_pct)}% of the fare"
            if b.max_minutes is not None
            else f"{b.min_minutes} minutes or more late: {_pct(b.refund_pct)}% of the fare"
            for b in paying
        )
        top = max(pack.bands, key=lambda b: b.min_minutes)
        # The Rights Engine pays a cancelled train as the top band (delays.claimable_delay); the
        # jurors must read the same rule, or they judge a cancellation by its "0 minutes late".
        cancelled = (
            f"A cancelled train is paid as the top band: {_pct(top.refund_pct)}% of the fare."
        )
        return (
            f"{pack.operator} Delay Repay ({pack.scheme}). If your train arrives "
            f"{paying[0].min_minutes} minutes or more late at your destination, you can claim "
            f"compensation for that journey. It pays: {bands}. {cancelled} {window} {source}"
        )
    if isinstance(pack, FixedAmountPack):
        return (
            f"{pack.operator} {pack.scheme}. If an engineer doesn't turn up for a scheduled "
            f"appointment, or the provider cancels it with less than {pack.min_notice_hours} "
            f"hours' notice, the provider must pay £{pack.amount_gbp} automatically. "
            f"{window} {source}"
        )
    return (
        f"{pack.operator} {pack.scheme}: compensation by distance and arrival delay. "
        f"{window} {source}"
    )
