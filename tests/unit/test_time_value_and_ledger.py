from datetime import UTC, datetime
from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from tempo_core.ledger import LedgerEntry, summarise, time_invoice
from tempo_core.time_value import DEFAULT_GBP_H, TimeProfile, time_value

AT = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)


def test_default_time_value_from_profile() -> None:
    tv = time_value(TimeProfile())

    assert tv.gbp_h == DEFAULT_GBP_H
    assert tv.explanation.startswith(
        f"I think an hour of your time is worth about £{DEFAULT_GBP_H}"
    )
    assert "demo value" in tv.explanation  # the placeholder is labelled until it's checked
    assert tv.explanation.endswith("Is that right?")


def test_pay_is_the_starting_point_when_shared() -> None:
    assert time_value(TimeProfile(hourly_pay_gbp=Decimal("15"))).gbp_h == Decimal("15.00")


def test_shifts_and_caring_weigh_more() -> None:
    tv = time_value(
        TimeProfile(hourly_pay_gbp=Decimal("12"), shift_worker=True, caring_duties=True)
    )

    assert tv.gbp_h == Decimal("22.50")  # 12 × 1.5 × 1.25
    assert "shift" in tv.explanation
    assert "carer" in tv.explanation


def test_user_override_wins() -> None:
    tv = time_value(
        TimeProfile(hourly_pay_gbp=Decimal("40"), shift_worker=True, override_gbp_h=Decimal("18"))
    )

    assert tv.gbp_h == Decimal("18.00")
    assert tv.explanation == "You told me your time is worth £18.00 an hour."


def test_ledger_sums_minutes_returned_and_gbp() -> None:
    totals = summarise(
        [
            LedgerEntry(
                mission_id="m1",
                at=AT,
                minutes_returned=Decimal("25"),
                gbp_recovered=Decimal("14.20"),
            ),
            LedgerEntry(
                mission_id="m2",
                at=AT,
                minutes_lost=Decimal("23"),
                minutes_returned=Decimal("65"),
                gbp_recovered=Decimal("32.31"),
            ),
        ]
    )

    assert totals.minutes_returned == Decimal("90")
    assert totals.minutes_lost == Decimal("23")
    assert totals.gbp_recovered == Decimal("46.51")
    assert totals.hours_returned == Decimal("1.5")


def test_an_empty_ledger_is_all_zero() -> None:
    totals = summarise([])

    assert (totals.minutes_returned, totals.gbp_recovered) == (Decimal(0), Decimal(0))


def test_time_invoice_line_items() -> None:
    invoice = time_invoice(
        [("On hold to Openreach, 23 Oct", Decimal("52"))], time_value_gbp_h=Decimal("31")
    )

    [line] = invoice.lines
    assert line.amount_gbp == Decimal("26.87")  # 52 min × £31/h = £26.866…
    assert invoice.total_gbp == Decimal("26.87")


@given(
    minutes=st.lists(
        st.decimals(min_value=1, max_value=600, places=0, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=8,
    ),
    rate=st.decimals(min_value=0, max_value=200, places=2, allow_nan=False, allow_infinity=False),
)
def test_the_invoice_always_adds_up(minutes: list[Decimal], rate: Decimal) -> None:
    invoice = time_invoice([(f"item {i}", m) for i, m in enumerate(minutes)], time_value_gbp_h=rate)

    assert invoice.total_gbp == sum(line.amount_gbp for line in invoice.lines)
    assert all(line.amount_gbp.as_tuple().exponent == -2 for line in invoice.lines)
