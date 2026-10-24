from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.errors import ConsentConflict

T0 = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
NOW = T0 + timedelta(hours=1)


def grant(scope: str = "file_claim", minute: int = 0, **kw: Any) -> ConsentEvent:
    return ConsentEvent(
        mission_id="m_1",
        scope=scope,
        kind=ConsentKind.GRANT,
        at=T0 + timedelta(minutes=minute),
        device_sig="sig",
        **kw,
    )


def revoke(scope: str = "file_claim", minute: int = 0) -> ConsentEvent:
    return ConsentEvent(
        mission_id="m_1",
        scope=scope,
        kind=ConsentKind.REVOKE,
        at=T0 + timedelta(minutes=minute),
        device_sig="sig",
    )


def test_grant_allows_scope() -> None:
    state = effective_consent([grant()], NOW)

    assert state.allows("file_claim")
    assert not state.allows("phone_company")


def test_revoke_after_grant_denies() -> None:
    assert not effective_consent([grant(minute=1), revoke(minute=5)], NOW).allows("file_claim")


def test_expired_grant_denies() -> None:
    expired = grant(expires_at=NOW)  # expiry is exclusive: at NOW it has already ended

    assert not effective_consent([expired], NOW).allows("file_claim")
    assert effective_consent([expired], NOW - timedelta(seconds=1)).allows("file_claim")


def test_a_grant_that_is_not_valid_yet_is_ignored() -> None:
    assert not effective_consent([grant(minute=90)], NOW).allows("file_claim")


def test_a_tie_goes_to_the_revoke() -> None:
    assert not effective_consent([grant(minute=5), revoke(minute=5)], NOW).allows("file_claim")


def test_a_future_stamped_revoke_still_denies() -> None:
    # A phone whose clock runs fast must not delay a STOP.
    assert not effective_consent([grant(minute=1), revoke(minute=600)], NOW).allows("file_claim")


def test_regrant_after_revoke_allows_with_only_the_new_limits() -> None:
    events = [
        grant(minute=1, limits={"auto_accept_max_gbp": Decimal("5")}),
        revoke(minute=2),
        grant(minute=3, limits={"auto_accept_max_gbp": Decimal("50")}),
    ]

    state = effective_consent(events, NOW)

    assert state.allows("file_claim")
    assert state.limits == {"auto_accept_max_gbp": Decimal("50")}


def test_revoking_one_scope_leaves_the_others() -> None:
    state = effective_consent(
        [grant("file_claim"), grant("phone_company"), revoke("file_claim", 1)], NOW
    )

    assert state.allowed == frozenset({"phone_company"})


def test_floor_limits_take_the_maximum() -> None:
    events = [
        grant("file_claim", limits={"min_settlement_ratio": Decimal("0.8")}),
        grant("accept_offer", limits={"min_settlement_ratio": Decimal("1")}),
    ]

    assert effective_consent(events, NOW).limits["min_settlement_ratio"] == Decimal("1")


def test_conflicting_limit_types_raise_so_callers_fail_closed() -> None:
    events = [
        grant("file_claim", limits={"accept_vouchers": True}),
        grant("accept_offer", limits={"accept_vouchers": Decimal("1")}),
    ]

    with pytest.raises(ConsentConflict):
        effective_consent(events, NOW)


def test_naive_datetimes_are_rejected() -> None:
    with pytest.raises(ValidationError):
        ConsentEvent(
            mission_id="m",
            scope="s",
            kind=ConsentKind.GRANT,
            at=datetime(2026, 10, 24, 12, 0),  # deliberately naive
            device_sig="sig",
        )


# --- properties ----------------------------------------------------------------------------------

minutes = st.integers(min_value=0, max_value=59)
caps = st.decimals(min_value=0, max_value=500, places=2, allow_nan=False, allow_infinity=False)


@settings(max_examples=500)
@given(grant_minutes=st.lists(minutes, min_size=1, max_size=8), data=st.data())
def test_deny_wins_regardless_of_order(grant_minutes: list[int], data: st.DataObject) -> None:
    revoke_minute = data.draw(st.integers(min_value=max(grant_minutes), max_value=59))
    events = [grant(minute=m) for m in grant_minutes] + [revoke(minute=revoke_minute)]

    shuffled = data.draw(st.permutations(events))

    assert not effective_consent(shuffled, NOW).allows("file_claim")


@settings(max_examples=500)
@given(values=st.lists(caps, min_size=1, max_size=6))
def test_limits_take_the_minimum(values: list[Decimal]) -> None:
    events = [grant(f"scope_{i}", limits={"auto_accept_max_gbp": v}) for i, v in enumerate(values)]

    merged = effective_consent(events, NOW).limits["auto_accept_max_gbp"]

    assert all(merged <= v for v in values)
    assert merged in values


@settings(max_examples=500)
@given(flags=st.lists(st.booleans(), min_size=1, max_size=6))
def test_booleans_take_and(flags: list[bool]) -> None:
    events = [grant(f"scope_{i}", limits={"accept_vouchers": f}) for i, f in enumerate(flags)]

    assert effective_consent(events, NOW).limits["accept_vouchers"] is all(flags)


event_specs = st.lists(
    st.tuples(
        st.sampled_from(["file_claim", "phone_company"]),
        st.sampled_from([ConsentKind.GRANT, ConsentKind.REVOKE]),
        st.integers(min_value=0, max_value=120),
        st.one_of(st.none(), caps),
    ),
    max_size=10,
)


@settings(max_examples=500)
@given(specs=event_specs, data=st.data())
def test_merge_is_deterministic(
    specs: list[tuple[str, ConsentKind, int, Decimal | None]], data: st.DataObject
) -> None:
    events = [
        ConsentEvent(
            mission_id="m_1",
            scope=scope,
            kind=kind,
            at=T0 + timedelta(minutes=minute),
            limits={} if cap is None or kind is ConsentKind.REVOKE else {"max_gbp": cap},
            device_sig="sig",
        )
        for scope, kind, minute, cap in specs
    ]

    reordered = data.draw(st.permutations(events))

    assert effective_consent(reordered, NOW) == effective_consent(events, NOW)
