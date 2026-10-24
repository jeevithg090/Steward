from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from tempo_core.errors import NotCovered
from tempo_core.models import Fact, ProofTrace
from tempo_core.rules import (
    ClockPack,
    DelayRepayPack,
    DistanceBandPack,
    FixedAmountPack,
    NotEligible,
    RulePackRegistry,
    evaluate_delay_repay,
    evaluate_distance_band,
    evaluate_missed_appointment,
    parse_pack,
)

SKILLS = Path(__file__).resolve().parents[2] / "skills"
FACTS = (Fact(key="arrival_delay_min", value=38, source="hsp:RID:1", confidence=1.0),)

DR15_BANDS: list[dict[str, Any]] = [
    {"min_minutes": 0, "max_minutes": 14, "refund_pct": "0"},
    {"min_minutes": 15, "max_minutes": 29, "refund_pct": "25"},
    {"min_minutes": 30, "max_minutes": 59, "refund_pct": "50"},
    {"min_minutes": 60, "max_minutes": 119, "refund_pct": "100"},
    {"min_minutes": 120, "max_minutes": None, "refund_pct": "100"},
]


def dr15(**overrides: Any) -> DelayRepayPack:
    data: dict[str, Any] = {
        "kind": "delay_repay",
        "id": "test.dr15",
        "version": "1.2.0",
        "operator": "GWR",
        "scheme": "DR15",
        "citation_url": "https://example.org/delay-repay",
        "claim_window_days": 28,
        "last_verified": date(2026, 10, 24),
        "bands": DR15_BANDS,
    }
    pack = parse_pack(data | overrides)
    assert isinstance(pack, DelayRepayPack)
    return pack


def refund(pack: DelayRepayPack, delay: int, fare: str = "40.00") -> ProofTrace | NotEligible:
    return evaluate_delay_repay(
        pack, delay_minutes=delay, fare_gbp=Decimal(fare), facts=FACTS, trace_id="pt_1"
    )


# --- packs ---------------------------------------------------------------------------------------


def test_pack_yaml_files_validate() -> None:
    registry = RulePackRegistry.from_directory(SKILLS)

    kinds = {type(p) for p in registry}
    assert kinds == {DelayRepayPack, FixedAmountPack, DistanceBandPack, ClockPack}
    assert len(registry) >= 12


def test_skill_forge_drafts_are_not_loaded(tmp_path: Path) -> None:
    good = tmp_path / "clawback-uk-rail" / "rules"
    draft = tmp_path / "generated" / "skill-x" / "rules"
    for folder in (good, draft):
        folder.mkdir(parents=True)
    (good / "gwr.yaml").write_text((SKILLS / "clawback-uk-rail/rules/gwr.yaml").read_text())
    (draft / "bad.yaml").write_text("id: no-kind\nversion: '1'\n")  # would fail validation

    registry = RulePackRegistry.from_directory(tmp_path)

    assert [p.id for p in registry] == ["uk-rail.gwr.delay-repay"]
    with pytest.raises(ValidationError):  # pointed at a draft on purpose, it is checked
        RulePackRegistry.from_directory(draft.parent)


def test_money_in_packs_is_exact() -> None:
    ofcom = RulePackRegistry.from_directory(SKILLS).by_id("ofcom.missed-appointment")

    assert isinstance(ofcom, FixedAmountPack)
    assert ofcom.amount_gbp == Decimal("32.31")


@pytest.mark.parametrize(
    "bands",
    [
        pytest.param(
            [
                {"min_minutes": 0, "max_minutes": 20, "refund_pct": "0"},
                {"min_minutes": 15, "max_minutes": None, "refund_pct": "25"},
            ],
            id="overlap",
        ),
        pytest.param(
            [
                {"min_minutes": 0, "max_minutes": 14, "refund_pct": "0"},
                {"min_minutes": 16, "max_minutes": None, "refund_pct": "25"},
            ],
            id="gap",
        ),
        pytest.param(
            [{"min_minutes": 5, "max_minutes": None, "refund_pct": "25"}], id="starts-late"
        ),
        pytest.param([{"min_minutes": 0, "max_minutes": 99, "refund_pct": "25"}], id="not-open"),
        pytest.param(
            [
                {"min_minutes": 0, "max_minutes": 29, "refund_pct": "50"},
                {"min_minutes": 30, "max_minutes": None, "refund_pct": "25"},
            ],
            id="pays-less-later",
        ),
    ],
)
def test_bands_must_be_contiguous(bands: list[dict[str, Any]]) -> None:
    with pytest.raises(ValidationError):
        dr15(bands=bands)


def test_a_verified_pack_must_say_when() -> None:
    with pytest.raises(ValidationError, match="last_verified"):
        dr15(last_verified=None)


def test_unknown_operator_raises_not_covered() -> None:
    registry = RulePackRegistry.from_directory(SKILLS)

    assert registry.delay_repay("gwr").operator == "GWR"  # case-insensitive
    assert registry.delay_repay("GW").operator == "GWR"  # rail data's TOC code
    with pytest.raises(NotCovered):
        registry.delay_repay("Hogwarts Express")
    with pytest.raises(NotCovered):
        registry.by_id("no.such.pack")


def test_duplicate_pack_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate"):
        RulePackRegistry([dr15(), dr15()])


# --- Delay Repay ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("delay", "expected"),
    [
        (0, None),
        (14, None),  # threshold - 1
        (15, "10.00"),  # threshold
        (29, "10.00"),
        (30, "20.00"),
        (59, "20.00"),
        (60, "40.00"),
        (119, "40.00"),
        (120, "40.00"),
        (500, "40.00"),  # open-ended band
    ],
)
def test_delay_repay_band_boundaries(delay: int, expected: str | None) -> None:
    result = refund(dr15(), delay)

    if expected is None:
        assert isinstance(result, NotEligible)
        assert "below the DR15 threshold of 15 min" in result.reason
    else:
        assert isinstance(result, ProofTrace)
        assert result.amount_gbp == Decimal(expected)


def test_amount_is_decimal_and_rounded_to_pence() -> None:
    result = refund(dr15(), 20, fare="9.99")  # 25% of £9.99 = £2.4975

    assert isinstance(result, ProofTrace)
    assert result.amount_gbp == Decimal("2.50")
    assert result.amount_gbp.as_tuple().exponent == -2


def test_explanation_shows_the_working() -> None:
    result = refund(dr15(), 38, fare="28.40")

    assert isinstance(result, ProofTrace)
    [step] = result.steps
    assert step.explanation == "38 min late → 50% of £28.40 under GWR DR15"
    assert step.fact_keys == ("arrival_delay_min",)


def test_early_arrival_is_not_eligible() -> None:
    result = refund(dr15(), -3)

    assert isinstance(result, NotEligible)
    assert "early" in result.reason


def test_negative_fare_is_a_bug_not_a_decline() -> None:
    with pytest.raises(ValueError, match="fare"):
        refund(dr15(), 30, fare="-1")


def test_demo_values_flag_surfaces_in_explanation() -> None:
    demo = dr15(demo_values=True, last_verified=None)

    paid, declined = refund(demo, 40), refund(demo, 5)

    assert isinstance(paid, ProofTrace)
    assert isinstance(declined, NotEligible)
    for text in (paid.steps[0].explanation, declined.reason):
        assert "demo values: not yet checked against GWR's published terms" in text
    verified = refund(dr15(), 40)
    assert isinstance(verified, ProofTrace)
    assert "demo values" not in verified.steps[0].explanation


fares = st.decimals(min_value=0, max_value=500, places=2, allow_nan=False, allow_infinity=False)
delays = st.integers(min_value=0, max_value=1000)


@given(delay=delays, fare=fares)
def test_amount_never_negative(delay: int, fare: Decimal) -> None:
    result = refund(dr15(), delay, str(fare))
    assert isinstance(result, NotEligible) or result.amount_gbp >= 0


@given(delay=delays, fare=fares)
def test_amount_never_exceeds_fare(delay: int, fare: Decimal) -> None:
    result = refund(dr15(), delay, str(fare))
    assert isinstance(result, NotEligible) or result.amount_gbp <= fare


def _paid(result: ProofTrace | NotEligible) -> Decimal:
    return Decimal(0) if isinstance(result, NotEligible) else result.amount_gbp


@given(a=delays, b=delays, fare=fares)
def test_monotonic_in_delay(a: int, b: int, fare: Decimal) -> None:
    shorter, longer = sorted((a, b))
    pack = dr15()
    assert _paid(refund(pack, shorter, str(fare))) <= _paid(refund(pack, longer, str(fare)))


# --- Ofcom missed appointment --------------------------------------------------------------------


def ofcom() -> FixedAmountPack:
    pack = RulePackRegistry.from_directory(SKILLS).by_id("ofcom.missed-appointment")
    assert isinstance(pack, FixedAmountPack)
    return pack


@pytest.mark.parametrize(
    ("notice", "paid"),
    [(None, True), (Decimal("0"), True), (Decimal("23.5"), True), (Decimal("24"), False)],
)
def test_missed_appointment(notice: Decimal | None, paid: bool) -> None:
    result = evaluate_missed_appointment(ofcom(), notice_hours=notice, facts=FACTS, trace_id="pt")

    if paid:
        assert isinstance(result, ProofTrace)
        assert result.amount_gbp == Decimal("32.31")
    else:
        assert isinstance(result, NotEligible)
        assert "24 h" in result.reason


def test_missed_appointment_explains_no_notice() -> None:
    result = evaluate_missed_appointment(ofcom(), notice_hours=None, facts=FACTS, trace_id="pt")

    assert isinstance(result, ProofTrace)
    assert result.steps[0].explanation.startswith(
        "Engineer appointment missed with no notice → £32.31 under Ofcom"
    )


# --- UK261 ---------------------------------------------------------------------------------------


def uk261() -> DistanceBandPack:
    pack = RulePackRegistry.from_directory(SKILLS).by_id("uk261.delay")
    assert isinstance(pack, DistanceBandPack)
    return pack


@pytest.mark.parametrize(
    ("km", "delay", "expected"),
    [
        (800, 179, None),
        (800, 180, "220.00"),
        (1500, 200, "220.00"),
        (1501, 200, "350.00"),
        (3500, 200, "350.00"),
        (3501, 200, "520.00"),
        (9000, 600, "520.00"),
    ],
)
def test_uk261_distance_bands(km: int, delay: int, expected: str | None) -> None:
    result = evaluate_distance_band(
        uk261(), distance_km=km, arrival_delay_minutes=delay, facts=FACTS, trace_id="pt"
    )

    if expected is None:
        assert isinstance(result, NotEligible)
        assert result.reason.startswith("arrived 2 h 59 min late; UK261 starts at 3 h")
    else:
        assert isinstance(result, ProofTrace)
        assert result.amount_gbp == Decimal(expected)


def test_uk261_explanation() -> None:
    result = evaluate_distance_band(
        uk261(), distance_km=2100, arrival_delay_minutes=245, facts=FACTS, trace_id="pt"
    )

    assert isinstance(result, ProofTrace)
    assert result.steps[0].explanation.startswith(
        "Arrived 4 h 5 min late on a 2100 km flight → £350.00 under UK261"
    )


def test_uk261_rejects_a_non_positive_distance() -> None:
    with pytest.raises(ValueError, match="distance"):
        evaluate_distance_band(
            uk261(), distance_km=0, arrival_delay_minutes=200, facts=FACTS, trace_id="pt"
        )


@pytest.mark.parametrize(
    "bands",
    [
        [{"max_km": None, "amount_gbp": "220"}, {"max_km": 3500, "amount_gbp": "350"}],
        [
            {"max_km": 3500, "amount_gbp": "220"},
            {"max_km": 1500, "amount_gbp": "350"},
            {"max_km": None, "amount_gbp": "520"},
        ],
        [{"max_km": 1500, "amount_gbp": "350"}, {"max_km": None, "amount_gbp": "220"}],
        [{"max_km": 1500, "amount_gbp": "220"}],
    ],
    ids=["open-first", "descending", "pays-less", "not-open"],
)
def test_distance_bands_must_ascend(bands: list[dict[str, Any]]) -> None:
    data = uk261().model_dump() | {"bands": bands}
    with pytest.raises(ValidationError):
        parse_pack(data)


# --- every result shows its working --------------------------------------------------------------


def test_every_result_has_citation_and_version() -> None:
    results: list[ProofTrace | NotEligible] = [
        refund(dr15(), 5),
        refund(dr15(), 45),
        evaluate_missed_appointment(ofcom(), notice_hours=None, facts=FACTS, trace_id="a"),
        evaluate_missed_appointment(ofcom(), notice_hours=Decimal(48), facts=FACTS, trace_id="b"),
        evaluate_distance_band(
            uk261(), distance_km=900, arrival_delay_minutes=30, facts=FACTS, trace_id="c"
        ),
        evaluate_distance_band(
            uk261(), distance_km=900, arrival_delay_minutes=300, facts=FACTS, trace_id="d"
        ),
    ]

    for result in results:
        steps = [result] if isinstance(result, NotEligible) else list(result.steps)
        for step in steps:
            assert step.citation_url.startswith("https://")
            assert step.rule_id
            assert step.rule_version
