"""The Rights Decay planner (R2): rights with clocks, odds that a problem fixes itself, and when to
act. Known values for the two demo cases, then the invariants as properties."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tempo_core.arbiter import ActionOption
from tempo_core.hazard import Hazard
from tempo_core.readability import flesch_reading_ease
from tempo_core.rights_decay import Plan, Right, apply_clocks, plan, wait_cost
from tempo_core.rules import ClockPack, RulePackRegistry, parse_pack

D = Decimal
SKILLS = Path(__file__).resolve().parents[2] / "skills"
TV = D(18)
OWED = D("32.31")
MISSED = date(2026, 10, 18)  # the engineer didn't come
NYC = Hazard(
    id="t", source="NYC 311 HPD 2025", n=458_589, demo_values=True,
    resolved_by=((0, D(0)), (14, D("0.57")), (30, D("0.70")), (60, D("0.78")), (180, D("0.85"))),
)  # fmt: skip


def way(id: str = "tempo_calls", **kw: Any) -> ActionOption:
    values: dict[str, Any] = {
        "label": "I call Broadbandly for you", "p_success": D("0.85"), "amount_gbp": OWED,
        "user_minutes": D(0), "compute_gbp": D("0.20"),
    }  # fmt: skip
    return ActionOption(id=id, **(values | kw))


YOURSELF = way("you_complain", label="You complain yourself", p_success=D("0.9"), user_minutes=25)
COMPLAIN = Right(id="ofcom.complaint", label="Complain to Broadbandly", ways=(way(), YOURSELF))
OMBUDSMAN = Right(
    id="telecoms.ombudsman", label="Go to the ombudsman",
    ways=(way("tempo_refers", label="I refer it for you", p_success=D("0.6")),),
)  # fmt: skip


def broadband(**starts: date) -> tuple[Right, ...]:
    registry = RulePackRegistry.from_directory(SKILLS)
    clocks = [
        *registry.clocks("missed_appointment"),
        *registry.clocks("complaint_sent"),
        *registry.clocks("final_response"),
    ]
    return apply_clocks([COMPLAIN, OMBUDSMAN], clocks, {"event_date": MISSED, **starts})


def decide(rights: tuple[Right, ...] | list[Right], today: date, **kw: Any) -> Plan:
    values: dict[str, Any] = {
        "hazard": NYC, "started_on": MISSED, "today": today, "time_value_gbp_h": TV,
        "resolved_value_gbp": OWED,
    }  # fmt: skip
    return plan(rights, **(values | kw))


# --- clocks become dates ----------------------------------------------------------------------


def test_clocks_set_when_rights_open_and_lock() -> None:
    complain, ombudsman = broadband()

    assert complain.opens_on == date(2026, 11, 18)  # 30 days for the automatic credit, then
    assert complain.clocks == ("ofcom.auto-comp.payment-window",)
    assert ombudsman.unlocked_by == ("complaint_sent",)  # its 8 weeks haven't started
    assert ombudsman.opens_on is None and ombudsman.expires_on is None


def test_started_clocks_open_and_close_the_ombudsman() -> None:
    _, ombudsman = broadband(
        complaint_date=date(2026, 11, 18), final_response_date=date(2027, 1, 4)
    )

    assert ombudsman.opens_on == date(2027, 1, 14)  # 8 weeks after the complaint, then
    assert ombudsman.expires_on == date(2028, 1, 4)  # a year after the final answer
    assert ombudsman.hard_cliff and ombudsman.unlocked_by == ()


def test_the_tightest_clock_wins_and_unknown_rights_are_ignored() -> None:
    def window(id: str, days: int, right: str = "r") -> ClockPack:
        pack = parse_pack({
            "kind": "clock", "id": id, "version": "1", "operator": "T", "demo_values": True,
            "citation_url": "https://example.org", "trigger": "x", "starts_from": "event_date",
            "length": {"days": days}, "role": "window", "right": right, "summary": "s",
        })  # fmt: skip
        assert isinstance(pack, ClockPack)
        return pack

    wait = window("w", 5).model_copy(update={"role": "wait", "hard_cliff": False})
    later_wait = window("w2", 9).model_copy(update={"role": "wait", "hard_cliff": False})
    clocks = [window("a", 30), window("b", 10), window("c", 3, right="nobody"), wait, later_wait]
    [right] = apply_clocks(
        [Right(id="r", label="R", ways=(way(),))], clocks, {"event_date": MISSED}
    )

    assert right.expires_on == MISSED + timedelta(days=10)
    assert right.opens_on == MISSED + timedelta(days=10)  # the later of the two waits, plus a day
    assert right.clocks == ("a", "b", "w", "w2")


def test_a_window_that_has_not_started_limits_nothing() -> None:
    _, ombudsman = broadband(complaint_date=date(2026, 11, 18))

    assert ombudsman.expires_on is None  # no final answer yet


# --- the two demo cases -----------------------------------------------------------------------


def test_a_week_after_the_missed_visit_tempo_waits_and_says_why() -> None:
    p = decide(broadband(), date(2026, 10, 25))

    assert (p.action_today, p.way, p.next_decision_on) == ("wait", None, date(2026, 11, 18))
    assert p.explanation == (
        "I'll wait for now. You can complain to Broadbandly from 18 November. About 58% of "
        "cases like this get paid without a fight by then. If yours does, you get £32.31 and "
        "nobody has to call. I'll check again on 18 November. Nothing you can claim runs out "
        "before then."
    )
    assert [r.status for r in p.rights] == ["opens_later", "locked"]
    assert p.why[0].startswith("58% of cases like this are paid without a fight by 18 November")
    assert "used as a stand-in" in p.why[0]
    assert p.why[1] == (
        "An open problem costs you about 2 minutes a week: £0.60 at £18.00 an hour. "
        "You can change this."
    )


def test_when_the_credit_is_late_tempo_calls() -> None:
    p = decide(broadband(), date(2026, 11, 18))

    assert (p.action_today, p.way, p.next_decision_on) == (
        "ofcom.complaint", "tempo_calls", date(2026, 11, 18),
    )  # fmt: skip
    assert p.explanation.startswith("It's time to act: I call Broadbandly for you.")
    assert (
        "Only 13% of cases like this get paid without a fight in the next two weeks."
        in p.explanation
    )
    assert p.why[0].startswith(
        "13% of cases like this are paid without a fight in the next two weeks"
    )
    assert p.rights[0].status == "chosen" and p.rights[0].best_way == "tempo_calls"
    assert p.days[0].value_gbp == p.rights[0].ev_gbp == D("27.2635")  # 0.85 x 32.31 - 0.20


def test_a_late_train_never_fixes_itself_so_tempo_claims_now() -> None:
    claim = Right(
        id="delay-repay", label="Claim Delay Repay", expires_on=date(2026, 11, 20),
        ways=(way("tempo_claims", label="I claim online for you", amount_gbp=D("14.20"),
                  p_success=D("0.9"), compute_gbp=D("0.05")),),
    )  # fmt: skip
    p = decide([claim], date(2026, 10, 24), hazard=Hazard.none(), started_on=date(2026, 10, 23))

    assert p.action_today == "delay-repay" and p.next_decision_on == date(2026, 10, 24)
    assert p.explanation == (
        "It's time to act: I claim online for you. This won't fix itself. "
        "You can claim until 20 November."
    )
    assert p.why[0] == "This kind of problem doesn't fix itself."
    assert p.why[2] == "Nearest deadline: Claim Delay Repay, until 20 November."


def test_with_no_clock_the_falling_odds_pick_the_day() -> None:
    p = decide([COMPLAIN], date(2026, 10, 19))  # the complaint could be made today

    assert p.action_today == "wait"
    assert p.next_decision_on is not None
    assert date(2026, 11, 10) <= p.next_decision_on <= date(2026, 11, 25)  # about day 30
    assert all(d.best == "wait" for d in p.days if d.day < p.next_decision_on)


def test_waiting_costs_more_when_your_time_costs_more() -> None:
    cheap = decide([COMPLAIN], date(2026, 10, 19), attention_minutes_per_week=D(1))
    dear = decide([COMPLAIN], date(2026, 10, 19), attention_minutes_per_week=D(10))

    assert cheap.next_decision_on and dear.next_decision_on
    assert dear.next_decision_on < cheap.next_decision_on
    assert wait_cost(TV, D(2)) == D(18) * 2 / 60 / 7


# --- when there's nothing to do ---------------------------------------------------------------


def test_nothing_worth_doing_and_nothing_coming() -> None:
    tiny = Right(id="tiny", label="Ask for 20p", ways=(way(amount_gbp=D("0.20")),))
    p = decide([tiny], date(2026, 10, 25), hazard=Hazard.none())

    assert p.action_today == "drop"
    assert p.explanation == "There's nothing to claim here yet, and nothing that opens later."
    assert p.rights[0].status == "open"  # open, but under the Arbiter's threshold


def test_if_it_may_still_come_tempo_stops_chasing_but_keeps_watch() -> None:
    p = decide([], date(2026, 10, 25))

    assert p.action_today == "drop"
    assert p.explanation == (
        "It isn't worth chasing this. If the money comes on its own, I'll tell you."
    )
    assert p.why[2] == "No deadline before 23 April."


def test_waiting_for_the_whole_horizon() -> None:
    far = Right(id="far", label="Ask again", opens_on=date(2028, 1, 1), ways=(way(),))
    p = decide([far], date(2026, 10, 25), attention_minutes_per_week=D(0))

    assert p.action_today == "wait" and p.next_decision_on is None
    assert p.explanation.endswith("I'll keep an eye on it.")


def test_a_small_right_that_runs_out_first_is_named_honestly() -> None:
    small = Right(
        id="small", label="Ask for a goodwill fiver", expires_on=date(2026, 10, 28),
        ways=(way("ask", amount_gbp=D("5.00")),),
    )  # fmt: skip
    p = decide([small, *broadband()], date(2026, 10, 25))

    assert p.action_today == "wait"  # the £32.31 complaint opening later is worth more
    assert not p.explanation.endswith("Nothing you can claim runs out before then.")
    assert p.why[2] == "Nearest deadline: Ask for a goodwill fiver, until 28 October."


def test_locked_and_expired_rights_say_so() -> None:
    old = Right(id="old", label="Old", expires_on=date(2026, 10, 20), ways=(way(),))
    p = decide([old, *broadband()], date(2026, 10, 25))

    assert [r.status for r in p.rights] == ["expired", "opens_later", "locked"]
    assert p.rights[2].unlocked_by == ("complaint_sent",)


def test_what_happened_unlocks_a_right() -> None:
    rights = broadband(complaint_date=date(2026, 11, 18))
    p = decide(rights, date(2027, 1, 20), happened={"complaint_sent"})

    assert [r.status for r in p.rights] == ["chosen", "open"]  # complaining again is still best


def test_today_cannot_be_before_the_problem() -> None:
    with pytest.raises(ValueError, match="before the problem started"):
        decide([COMPLAIN], MISSED - timedelta(days=1))


def test_every_explanation_is_plain() -> None:
    cases = [
        decide(broadband(), date(2026, 10, 25)),
        decide(broadband(), date(2026, 11, 18)),
        decide([], date(2026, 10, 25)),
        decide([COMPLAIN], date(2026, 10, 25), hazard=Hazard.none()),
    ]
    for p in cases:
        assert flesch_reading_ease(p.explanation) >= 60, p.explanation


# --- invariants -------------------------------------------------------------------------------

offsets = st.integers(min_value=0, max_value=60)
money = st.decimals(min_value=1, max_value=200, places=2, allow_nan=False, allow_infinity=False)
probs = st.decimals(min_value=0, max_value=1, places=2, allow_nan=False, allow_infinity=False)


@st.composite
def cases(draw: st.DrawFn) -> tuple[list[Right], Hazard, date]:
    rights = []
    for i in range(draw(st.integers(min_value=0, max_value=3))):
        opens = draw(st.none() | offsets)
        span = draw(st.none() | st.integers(min_value=0, max_value=60))
        opens_on = MISSED + timedelta(days=opens) if opens is not None else None
        start = opens_on or MISSED
        rights.append(Right(
            id=f"r{i}", label=f"Right {i}",
            opens_on=opens_on, expires_on=start + timedelta(days=span) if span is not None else None,
            ways=(way(f"w{i}", amount_gbp=draw(money), p_success=draw(probs),
                      user_minutes=draw(st.integers(min_value=0, max_value=60))),),
        ))  # fmt: skip
    a, b = sorted(draw(st.lists(probs, min_size=2, max_size=2)))
    hazard = NYC.model_copy(update={"resolved_by": ((0, D(0)), (14, a), (60, b))})
    return rights, hazard, MISSED + timedelta(days=draw(offsets))


@settings(max_examples=150, deadline=None)
@given(case=cases())
def test_plans_never_break_their_own_rules(case: tuple[list[Right], Hazard, date]) -> None:
    rights, hazard, today = case
    p = decide(rights, today, hazard=hazard, horizon_days=60)

    by_id = {r.id: r for r in rights}
    for day in p.days:
        assert day.value_at_risk_gbp >= 0 and day.cost_of_delay_gbp >= 0
        if day.best not in ("wait", "drop"):
            assert by_id[day.best].open_on(day.day, frozenset())  # never a closed right
    if p.next_decision_on is not None:
        assert all(d.best == "wait" for d in p.days if d.day < p.next_decision_on)


@settings(max_examples=100, deadline=None)
@given(case=cases(), cut=st.integers(min_value=0, max_value=30))
def test_a_tighter_deadline_never_makes_things_better(
    case: tuple[list[Right], Hazard, date], cut: int
) -> None:
    rights, hazard, today = case
    tighter = [
        r.model_copy(update={"expires_on": (r.expires_on or today + timedelta(60))
                             - timedelta(days=cut)})
        for r in rights
    ]  # fmt: skip
    loose = decide(rights, today, hazard=hazard, horizon_days=60)
    tight = decide(tighter, today, hazard=hazard, horizon_days=60)

    assert tight.days[0].value_gbp <= loose.days[0].value_gbp


def test_a_closure_that_does_not_pay_leaves_the_right_open() -> None:
    # 98% of cases close by day 180, but only 55% of closures go the person's way.
    closes = NYC.model_copy(update={"resolved_by": ((0, D(0)), (14, D("0.59")), (30, D("0.78")),
                                                     (60, D("0.88")), (180, D("0.98")))})  # fmt: skip
    every_close_pays = decide(broadband(), date(2026, 11, 18), hazard=closes)
    some_do = closes.model_copy(update={"pays_share": D("0.55"), "pays_share_source": "FCA H1"})
    honest = decide(broadband(), date(2026, 11, 18), hazard=some_do)

    assert every_close_pays.action_today == "drop"  # "it'll come anyway": too hopeful
    assert honest.action_today == "ofcom.complaint"
    assert honest.assumptions.pays_share == D("0.55")
    assert "55% of closures pay (FCA H1)" in honest.why[0]
