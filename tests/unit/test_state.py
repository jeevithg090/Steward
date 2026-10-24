from datetime import UTC, datetime, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_core.errors import IllegalTransition
from tempo_core.models import MissionState as S
from tempo_core.state import (
    SPEC_TEXT_TRANSITIONS,
    SPEC_TRANSITIONS,
    TERMINAL,
    advance,
    allowed_next,
    transition,
)

T0 = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(("current", "to"), sorted(SPEC_TRANSITIONS | SPEC_TEXT_TRANSITIONS))
def test_all_spec_transitions_allowed(current: S, to: S) -> None:
    assert transition(current, to) is to


@pytest.mark.parametrize(
    ("current", "to"),
    [
        (S.COMPLETED, S.RUNNING),
        (S.RECEIVED, S.RUNNING),  # no skipping understanding, planning and appraisal
        (S.PLANNED, S.AWAITING_CONSENT),  # the Arbiter must appraise first
        (S.APPRAISED, S.COMPLETED),
        (S.RUNNING, S.VERIFIED),  # only a completed mission can be verified
        (S.RUNNING, S.RUNNING),
    ],
)
def test_illegal_transitions_raise(current: S, to: S) -> None:
    with pytest.raises(IllegalTransition) as err:
        transition(current, to)
    assert err.value.current == current
    assert err.value.target == to


@given(state=st.sampled_from(sorted(TERMINAL)), target=st.sampled_from(list(S)))
def test_terminal_states_have_no_exits(state: S, target: S) -> None:
    assert allowed_next(state) == frozenset()
    with pytest.raises(IllegalTransition):
        transition(state, target)


def test_every_non_terminal_state_can_still_fail_safe_or_finish() -> None:
    # No mission can get stuck: every live state has somewhere to go.
    for state in set(S) - TERMINAL:
        assert allowed_next(state), state


def test_the_kill_switch_works_wherever_a_mission_is_paused() -> None:
    for state in (S.AWAITING_CONSENT, S.RUNNING, S.CHECKPOINT, S.WAITING):
        assert S.FAILED_SAFE in allowed_next(state)


def test_transition_emits_event_with_latency_ms() -> None:
    event = advance(
        "m_1", S.RUNNING, S.COMPLETED, entered_at=T0, now=T0 + timedelta(milliseconds=1234)
    )

    assert (event.from_state, event.to_state) == (S.RUNNING, S.COMPLETED)
    assert event.latency_ms == 1234
    assert event.at == T0 + timedelta(milliseconds=1234)


def test_advance_rejects_illegal_moves_and_time_travel() -> None:
    with pytest.raises(IllegalTransition):
        advance("m_1", S.COMPLETED, S.RUNNING, entered_at=T0, now=T0)
    with pytest.raises(ValueError, match="before it entered"):
        advance("m_1", S.RUNNING, S.COMPLETED, entered_at=T0, now=T0 - timedelta(seconds=1))
