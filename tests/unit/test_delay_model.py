"""The Arbiter's delay model (S6.3): shrinkage, Brier score, a holdout with no leakage."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_core.delay_model import (
    MAX_STRENGTH,
    MIN_STRENGTH,
    Run,
    Tally,
    brier,
    day_type,
    fit,
    prior_strength,
    reliability,
    shrink,
    split,
)

MONDAY = date(2026, 9, 7)


def runs(departure: str, late: int, total: int, *, start: date = MONDAY, at: int = 15) -> list[Run]:
    """`total` weekday runs of one service, the first `late` of them at least `at` min late."""
    days = [d for d in (start + timedelta(days=i) for i in range(total * 2)) if d.weekday() < 5][
        :total
    ]
    return [
        Run(day, departure, frozenset({15, at}) if i < late else frozenset())
        for i, day in enumerate(days)
    ]


def history() -> list[Run]:
    # Morning services: around 20% late; the 08:12 is chronically worse; the 08:44 ran once, late.
    return [
        *runs("0742", 4, 20), *runs("0758", 5, 20), *runs("0828", 3, 20), *runs("0812", 10, 20),
        *runs("0844", 1, 1), *runs("1412", 1, 20),
    ]  # fmt: skip


def test_shrinkage_pulls_sparse_services_to_route_mean() -> None:
    model = fit(history())
    sparse = model.p(Run(MONDAY, "0844", frozenset()), 15)
    chronic = model.p(Run(MONDAY, "0812", frozenset()), 15)

    assert sparse < 0.5  # one late run is not "always late"
    assert abs(sparse - model.hours[15][("WEEKDAY", 8)]) < abs(1.0 - sparse)
    assert 0.35 < chronic < 0.5  # 20 runs at 50% keep most of their own evidence
    assert model.p(Run(MONDAY, "1412", frozenset()), 15) < model.route[15]


def test_unseen_services_fall_back_to_their_hour_then_the_route() -> None:
    model = fit(history())

    assert model.p(Run(MONDAY, "0850", frozenset()), 15) == model.hours[15][("WEEKDAY", 8)]
    assert model.p(Run(MONDAY, "2112", frozenset()), 15) == model.route[15]
    assert model.p(Run(date(2026, 9, 12), "0812", frozenset()), 15) == model.route[15]  # a Saturday


def test_brier_score_computation() -> None:
    assert brier([0.0, 1.0, 0.5], [False, True, True]) == pytest.approx(0.25 / 3)
    assert brier([0.2, 0.2], [True, False]) == pytest.approx((0.64 + 0.04) / 2)
    with pytest.raises(ValueError):
        brier([0.5], [True, False])
    with pytest.raises(ValueError):
        brier([], [])


def test_holdout_is_strictly_after_training() -> None:
    all_runs = runs("0812", 6, 40)

    train, test = split(all_runs, holdout_days=7)

    assert max(r.day for r in train) < min(r.day for r in test)
    assert (max(r.day for r in test) - min(r.day for r in test)).days <= 6
    assert len(train) + len(test) == len(all_runs)
    assert split([]) == ([], [])


def test_prior_strength_reads_the_spread_between_groups() -> None:
    alike = [Tally(2, 10), Tally(2, 10), Tally(2, 10)]
    apart = [Tally(0, 50), Tally(50, 50)]

    assert prior_strength(alike, 0.2) == MAX_STRENGTH  # no real differences: pool hard
    assert prior_strength(apart, 0.5) == MIN_STRENGTH  # huge differences: trust each group
    assert prior_strength([Tally(1, 4)], 0.25) == MAX_STRENGTH  # one group says nothing
    assert prior_strength(alike, 0.0) == MAX_STRENGTH
    assert prior_strength([Tally(1, 10), Tally(3, 10), Tally(0, 0)], 0.2) == pytest.approx(
        MAX_STRENGTH
    )


def test_a_moderate_spread_gives_a_moderate_strength() -> None:
    groups = [Tally(10, 100), Tally(30, 100), Tally(20, 100)]

    assert MIN_STRENGTH < prior_strength(groups, 0.2) < MAX_STRENGTH


def test_reliability_bins_predictions() -> None:
    bins = reliability([0.05, 0.1, 0.95, 1.0], [False, True, True, True], bins=5)

    assert [(b.runs, b.observed) for b in bins] == [(2, 0.5), (2, 1.0)]
    assert bins[0].predicted == pytest.approx(0.075)


def test_day_types_and_empty_tallies() -> None:
    assert [day_type(MONDAY + timedelta(days=i)) for i in (0, 5, 6)] == [
        "WEEKDAY",
        "SATURDAY",
        "SUNDAY",
    ]
    assert Tally(0, 0).rate == 0.0
    with pytest.raises(ValueError):
        fit([])


@given(
    late=st.integers(0, 50), extra=st.integers(0, 50),
    toward=st.floats(0, 1), strength=st.floats(0.1, 500),
)  # fmt: skip
def test_shrunk_estimates_lie_between_the_data_and_the_prior(
    late: int, extra: int, toward: float, strength: float
) -> None:
    group = Tally(late, late + extra + 1)

    p = shrink(group, toward, strength)

    assert min(group.rate, toward) - 1e-9 <= p <= max(group.rate, toward) + 1e-9
