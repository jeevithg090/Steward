from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_core.delays import LONDON, claimable_delay, delay_minutes, hsp_arrival_delay
from tempo_core.rules import DelayRepayPack, RulePackRegistry

SKILLS = Path(__file__).resolve().parents[2] / "skills"
CLOCKS_GO_BACK = date(2026, 10, 25)  # 02:00 BST becomes 01:00 GMT
CLOCKS_GO_FORWARD = date(2026, 3, 29)  # 01:00 GMT becomes 02:00 BST


def test_a_simple_delay() -> None:
    assert hsp_arrival_delay(date(2026, 10, 23), "0812", "0850", "0928") == 38


def test_early_arrival_is_negative() -> None:
    assert hsp_arrival_delay(date(2026, 10, 23), "0812", "0850", "0847") == -3


def test_delay_minutes_handles_midnight_rollover() -> None:
    # Departs 23:40, due 00:10 the next day, arrives 00:42.
    assert hsp_arrival_delay(date(2026, 10, 23), "2340", "0010", "0042") == 32


def test_a_late_arrival_after_midnight_for_a_train_due_before_it() -> None:
    assert hsp_arrival_delay(date(2026, 10, 23), "2300", "2350", "0035") == 45


def test_delay_minutes_handles_bst_gmt_change() -> None:
    # Due 00:50 BST (23:50 UTC), arrives 02:10 GMT (02:10 UTC): 140 minutes, not 80.
    assert hsp_arrival_delay(CLOCKS_GO_BACK, "0020", "0050", "0210") == 140

    scheduled = datetime(2026, 10, 25, 0, 50, tzinfo=LONDON)
    actual = datetime(2026, 10, 25, 2, 10, tzinfo=LONDON)
    assert actual - scheduled == timedelta(minutes=80)  # Python's same-zone pitfall
    assert delay_minutes(scheduled, actual) == 140


def test_the_repeated_hour_takes_the_smaller_delay() -> None:
    # "0120" happens twice tonight; the earlier reading (30 min late) is the honest claim.
    assert hsp_arrival_delay(CLOCKS_GO_BACK, "0030", "0050", "0120") == 30


def test_the_spring_forward_gap() -> None:
    # Due 00:50 GMT, arrives 02:10 BST (01:10 GMT): 20 minutes, not 80.
    assert hsp_arrival_delay(CLOCKS_GO_FORWARD, "0020", "0050", "0210") == 20


def test_naive_datetimes_are_rejected() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        delay_minutes(datetime(2026, 10, 23, 8, 12), datetime(2026, 10, 23, 8, 50))


@pytest.mark.parametrize("bad", ["812", "08:12", "ab12", ""])
def test_bad_times_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError, match="HHMM"):
        hsp_arrival_delay(date(2026, 10, 23), "0812", bad, "0850")


def test_cancelled_service_maps_to_max_band() -> None:
    gwr = RulePackRegistry.from_directory(SKILLS).delay_repay("GWR")
    assert isinstance(gwr, DelayRepayPack)

    assert claimable_delay(gwr, delay=None, cancelled=True) == 120
    assert claimable_delay(gwr, delay=38, cancelled=False) == 38


instants = st.datetimes(
    min_value=datetime(2026, 1, 1), max_value=datetime(2027, 12, 31), timezones=st.just(UTC)
)


@given(a=instants, b=instants)
def test_the_answer_does_not_depend_on_which_zone_the_times_are_written_in(
    a: datetime, b: datetime
) -> None:
    assert delay_minutes(a.astimezone(LONDON), b.astimezone(LONDON)) == delay_minutes(a, b)
