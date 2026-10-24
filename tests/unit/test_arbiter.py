from decimal import Decimal
from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from tempo_core.arbiter import ActionOption, choose_action, expected_value

V18 = Decimal("18")

money = st.decimals(min_value=0, max_value=1000, places=2, allow_nan=False, allow_infinity=False)
mins = st.decimals(min_value=0, max_value=600, places=1, allow_nan=False, allow_infinity=False)
prob = st.decimals(min_value=0, max_value=1, places=3, allow_nan=False, allow_infinity=False)


def option(id: str = "claim", **kw: Any) -> ActionOption:
    values: dict[str, Any] = {
        "label": "Claim online for you",
        "p_success": Decimal("0.9"),
        "amount_gbp": Decimal("14.20"),
        "user_minutes": Decimal("0"),
        "compute_gbp": Decimal("0.02"),
    }
    return ActionOption(id=id, **(values | kw))


def ev(**kw: Any) -> Decimal:
    values: dict[str, Any] = {
        "p_success": Decimal("0.9"),
        "amount": Decimal("14.20"),
        "p_goodwill": Decimal("0"),
        "goodwill": Decimal("0"),
        "user_minutes": Decimal("2"),
        "time_value_gbp_h": V18,
        "compute_gbp": Decimal("0.02"),
    }
    return expected_value(**(values | kw))


def test_ev_formula_known_value() -> None:
    # 0.9 × 14.20 - (2/60) × 18 - 0.02 = 12.78 - 0.60 - 0.02
    assert ev() == Decimal("12.16")


def test_goodwill_adds_its_expected_value() -> None:
    assert ev(p_goodwill=Decimal("0.5"), goodwill=Decimal("10")) == Decimal("17.16")


@given(a=money, b=money)
def test_ev_increases_with_amount(a: Decimal, b: Decimal) -> None:
    low, high = sorted((a, b))
    assert ev(amount=low) <= ev(amount=high)


@given(a=mins, b=mins, time_value=money)
def test_ev_decreases_with_user_minutes(a: Decimal, b: Decimal, time_value: Decimal) -> None:
    fewer, more = sorted((a, b))
    assert ev(user_minutes=more, time_value_gbp_h=time_value) <= ev(
        user_minutes=fewer, time_value_gbp_h=time_value
    )


def test_picks_the_best_expected_value() -> None:
    online = option("online", user_minutes=Decimal("0"))
    phone = option("phone", label="Phone them yourself", user_minutes=Decimal("25"))

    decision = choose_action([phone, online], time_value_gbp_h=V18)

    assert decision.chosen == online
    assert [s.option.id for s in decision.ranked] == ["online", "phone"]


def test_declines_when_best_ev_below_threshold() -> None:
    tiny = option(amount_gbp=Decimal("1.00"), user_minutes=Decimal("5"))

    decision = choose_action([tiny], time_value_gbp_h=V18)

    assert decision.declined
    assert decision.chosen is None
    assert decision.ev_gbp is not None
    assert decision.ev_gbp < Decimal("0.50")
    assert decision.explanation.startswith("Not worth your time")
    assert "5 min" in decision.explanation


def test_explanation_mentions_amount_minutes_and_time_value() -> None:
    decision = choose_action([option()], time_value_gbp_h=V18)

    assert decision.explanation.startswith("Claim online for you: £14.20 for 0 min of your time")
    assert "£18.00 an hour" in decision.explanation


def test_ties_prefer_fewer_user_minutes() -> None:
    # Same EV: the second asks for 10 more minutes but pays exactly enough more to cover them.
    quick = option("quick", user_minutes=Decimal("0"), p_success=Decimal("1"))
    slow = option(
        "slow",
        user_minutes=Decimal("10"),
        p_success=Decimal("1"),
        amount_gbp=Decimal("17.20"),  # +£3.00 = 10 min at £18/h
    )

    decision = choose_action([slow, quick], time_value_gbp_h=V18)

    assert decision.ranked[0].ev_gbp == decision.ranked[1].ev_gbp
    assert decision.chosen == quick


def test_no_options_declines_with_an_explanation() -> None:
    decision = choose_action([], time_value_gbp_h=V18)

    assert decision.declined
    assert decision.explanation


@given(
    amounts=st.lists(money, min_size=1, max_size=5),
    minutes=st.lists(mins, min_size=5, max_size=5),
    data=st.data(),
)
def test_the_choice_does_not_depend_on_input_order(
    amounts: list[Decimal], minutes: list[Decimal], data: st.DataObject
) -> None:
    options = [
        option(f"o{i}", amount_gbp=a, user_minutes=minutes[i]) for i, a in enumerate(amounts)
    ]

    shuffled = data.draw(st.permutations(options))

    assert choose_action(shuffled, time_value_gbp_h=V18) == choose_action(
        options, time_value_gbp_h=V18
    )


def test_a_decline_that_would_cost_money_says_so_plainly() -> None:
    tiny = option(amount_gbp=Decimal("0.40"), user_minutes=Decimal("5"))

    decision = choose_action([tiny], time_value_gbp_h=V18)

    assert decision.explanation == (
        "Not worth your time: the best way (Claim online for you) would pay £0.40 but needs "
        "5 min of your time (about £18.00 an hour), so you'd be £1.16 worse off."
    )
