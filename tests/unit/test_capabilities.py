"""The capability words live in two packages on purpose (the domain core can't import the
passport's verifier); this is the test that stops the two lists drifting apart."""

from __future__ import annotations

import pytest

from tempo_core.capabilities import (
    CAPABILITIES,
    IN_PLAIN_WORDS,
    MAX_MANDATE_DAYS,
    check_capabilities,
)
from tempo_core.readability import flesch_reading_ease
from tempo_harness.policies_mandate import TOOL_ACTIONS
from tempo_passport import ACTIONS
from tempo_passport.mandate import MAX_LIFETIME


def test_the_core_and_the_passport_agree_on_the_eight_words() -> None:
    assert CAPABILITIES == ACTIONS
    assert len(CAPABILITIES) == 8


def test_a_profile_mandate_can_last_as_long_as_a_signed_one() -> None:
    assert MAX_LIFETIME.days == MAX_MANDATE_DAYS


def test_every_binding_tool_maps_onto_a_capability() -> None:
    assert {action for action in TOOL_ACTIONS.values() if action} <= CAPABILITIES


def test_every_word_has_plain_words_for_a_refusal() -> None:
    assert set(IN_PLAIN_WORDS) == CAPABILITIES
    for phrase in IN_PLAIN_WORDS.values():
        message = f"This profile doesn't let me {phrase}, so I stopped."
        assert flesch_reading_ease(message) >= 60, message


def test_check_capabilities_explains_itself() -> None:
    assert check_capabilities(("claim", "escalate")) == ("claim", "escalate")
    with pytest.raises(ValueError, match="unknown capability fly; the words are accept_cash"):
        check_capabilities(("claim", "fly"))
    with pytest.raises(ValueError, match="once"):
        check_capabilities(("claim", "claim"))
