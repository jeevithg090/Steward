"""Hazard curves (Rights Decay R2): how often a problem sorts itself out, and how soon."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from tempo_core.hazard import Hazard, load_hazards

D = Decimal
KNOTS = ((0, D(0)), (14, D("0.57")), (30, D("0.70")), (60, D("0.78")))


def curve(knots: tuple[tuple[int, Decimal], ...] = KNOTS, **kw: object) -> Hazard:
    data: dict[str, object] = {"id": "t", "source": "test", "n": 100, "demo_values": True}
    return Hazard.model_validate(data | kw | {"resolved_by": knots})


def test_exact_at_knots_linear_between_flat_after() -> None:
    h = curve()

    assert [h.p_resolved_by(d) for d, _ in KNOTS] == [p for _, p in KNOTS]
    assert h.p_resolved_by(7) == D("0.285")  # halfway to the first knot
    assert h.p_resolved_by(500) == D("0.78")
    assert h.p_resolved_by(-3) == 0


def test_conditional_odds_count_only_what_is_still_open() -> None:
    h = curve()

    # 0.13 of all cases close between day 14 and 30; 0.43 were still open at day 14.
    assert h.p_resolves_between(14, 30) == D("0.13") / D("0.43")
    assert h.p_resolves_between(30, 14) == 0
    assert h.p_resolves_between(60, 400) == 0  # past the data: never a guess


def test_nothing_left_open_means_no_hazard() -> None:
    h = curve(((0, D(0)), (10, D(1))))

    assert h.hazard_on(9) == D(1)
    assert h.hazard_on(10) == 0 and h.p_resolves_between(10, 20) == 0


def test_a_problem_that_never_fixes_itself() -> None:
    h = Hazard.none()

    assert h.n == 0 and not h.demo_values
    assert all(h.hazard_on(d) == 0 for d in range(0, 400, 7))


@given(day=st.integers(min_value=-5, max_value=400))
def test_hazard_is_a_probability(day: int) -> None:
    assert 0 <= curve().hazard_on(day) <= 1


@given(a=st.integers(min_value=0, max_value=200), b=st.integers(min_value=0, max_value=200))
def test_share_resolved_never_goes_down(a: int, b: int) -> None:
    early, late = sorted((a, b))
    h = curve()
    assert h.p_resolved_by(early) <= h.p_resolved_by(late)


@pytest.mark.parametrize(
    ("knots", "message"),
    [
        (((1, D(0)), (14, D("0.5"))), "starts at day 0"),
        (((0, D("0.1")), (14, D("0.5"))), "starts at day 0"),
        (((0, D(0)), (14, D("0.5")), (14, D("0.6"))), "ascend"),
        (((0, D(0)), (14, D("0.5")), (30, D("0.4"))), "can't go down"),
        (((0, D(0)), (14, D("1.2"))), "probabilities"),
    ],
)
def test_a_curve_must_be_a_curve(knots: tuple[tuple[int, Decimal], ...], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        curve(knots)


def test_load_curves_from_yaml(tmp_path: Path) -> None:
    (tmp_path / "a.yaml").write_text(
        "id: a\nsource: NYC 311\nn: 10\ndemo_values: true\nnote: a stand-in\n"
        "resolved_by: [[0, '0'], [14, '0.5']]\n"
    )
    (tmp_path / "b.yaml").write_text(
        "id: b\nsource: FCA\nn: 5\ndemo_values: true\nresolved_by: [[0, 0], [56, 0.9]]\n"
    )

    curves = load_hazards(tmp_path)

    assert sorted(curves) == ["a", "b"]
    assert curves["a"].p_resolved_by(14) == D("0.5")
    assert curves["b"].p_resolved_by(56) == D("0.9")  # floats in YAML still become exact


def test_two_curves_cannot_share_an_id(tmp_path: Path) -> None:
    for name in ("a", "b"):
        (tmp_path / f"{name}.yaml").write_text(
            "id: same\nsource: s\nn: 1\ndemo_values: true\nresolved_by: [[0, '0']]\n"
        )
    with pytest.raises(ValueError, match="share an id"):
        load_hazards(tmp_path)


def test_only_the_closures_that_pay_count() -> None:
    h = curve(pays_share=D("0.5"), pays_share_source="FCA")

    paid = h.paid()
    assert paid.p_resolved_by(14) == D("0.285") and paid.pays_share == 1
    assert curve().paid() is not None and curve().paid().p_resolved_by(14) == D("0.57")
    with pytest.raises(ValidationError):
        curve(pays_share=D("1.5"))


def test_the_pays_share_loads_from_yaml(tmp_path: Path) -> None:
    (tmp_path / "a.yaml").write_text(
        "id: a\nsource: s\nn: 1\ndemo_values: true\npays_share: 0.548\n"
        "pays_share_source: FCA H1 2026\nresolved_by: [[0, '0'], [14, '0.5']]\n"
    )

    assert load_hazards(tmp_path)["a"].pays_share == D("0.548")
