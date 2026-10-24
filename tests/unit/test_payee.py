"""Before You Pay (track 1b): pay, wait or stop, by rule, in plain words. Tempo never moves money."""

from __future__ import annotations

from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_core.payee import COOLING_OFF, NEVER_MOVES, PayeeAdvice, before_you_pay
from tempo_core.readability import flesch_reading_ease
from tempo_core.scam import Level

SAFE_ACCOUNT = "We've spotted fraud. Move your savings to a safe account today."


def check(
    payee: str = "Tom", amount: str = "50", reason: str = "birthday", *, new: bool = False,
    message: str | None = None, level: Level | None = None,
) -> PayeeAdvice:  # fmt: skip
    return before_you_pay(
        payee, Decimal(amount), reason, new_payee=new, message_text=message, registers_level=level
    )


def test_a_new_payee_and_a_safe_account_is_stop() -> None:
    advice = check(
        "Crown Yield", "2500", "they said my account is at risk", new=True, message=SAFE_ACCOUNT
    )

    assert advice.verdict == "stop"
    assert advice.reasons == (
        "it talks about a safe account, which no bank asks for",
        "it tells you to move your money",
        "you have not paid Crown Yield before",
    )
    assert advice.say.startswith("Stop. Do not pay Crown Yield today.")
    assert "number you already know, not one from the message" in advice.say


def test_a_safe_account_or_a_code_is_stop_even_for_a_payee_you_know() -> None:
    assert check("Barclays", message="Please move your money to a safe account").verdict == "stop"
    assert (
        check("Barclays", reason="they need the one-time passcode to release it").verdict == "stop"
    )


def test_a_new_payee_and_urgency_is_stop() -> None:
    advice = check(
        "Quick Refund", "80", "gas bill", new=True, message="Pay today only or we cut you off"
    )

    assert advice.verdict == "stop"
    assert "it pushes you to act now" in advice.reasons


def test_a_new_payee_waits_with_the_cooling_off_line() -> None:
    advice = check("Tom", "50", "birthday", new=True)

    assert advice.verdict == "wait"
    assert advice.reasons == ("you have not paid Tom before",)
    assert COOLING_OFF in advice.say and advice.say.startswith("Do not pay Tom yet.")


def test_a_large_amount_to_a_new_payee_says_so() -> None:
    advice = check("Tom", "1500.00", "car", new=True)

    assert advice.verdict == "wait"
    assert advice.reasons == ("you have not paid Tom before", "it is more than £1,000")
    assert check("Tom", "1000.00", "car", new=True).reasons == ("you have not paid Tom before",)


def test_a_known_payee_with_pressure_waits() -> None:
    advice = check("British Gas", "80", "gas bill", message="Act now or we cut you off")

    assert advice.verdict == "wait"
    assert advice.reasons == ("it pushes you to act now",)


@pytest.mark.parametrize(
    ("level", "verdict", "reason"),
    [
        (Level.LIKELY_SCAM, "stop", "the official registers flag this as a likely scam"),
        (Level.CAUTION, "wait", "the official registers raise a doubt about this firm"),
        (Level.UNKNOWN, "wait", "the official registers could not be checked just now"),
    ],
)
def test_what_the_registers_say_decides_too(level: Level, verdict: str, reason: str) -> None:
    advice = check("Barclays", "80", "card bill", level=level)

    assert (advice.verdict, advice.reasons) == (verdict, (reason,))


def test_otherwise_pay_and_tempo_never_moves_money() -> None:
    advice = check("British Gas", "80.5", "gas bill", level=Level.NO_FLAGS)

    assert advice.verdict == "pay" and advice.reasons == ()
    assert advice.say.startswith("No warning signs found for paying British Gas £80.50.")
    assert NEVER_MOVES in advice.say and "safe" not in advice.say


NAMES = st.sampled_from(
    ["Tom", "British Gas", "Crown Yield Partners", "Oxford City Council", "A B"]
)
TEXTS = st.one_of(st.none(), st.text(max_size=120), st.just(SAFE_ACCOUNT))


@given(
    payee=NAMES, amount=st.decimals(min_value=0, max_value=Decimal("99999.99"), places=2),
    reason=st.text(max_size=60), new=st.booleans(), message=TEXTS,
    level=st.one_of(st.none(), st.sampled_from(list(Level))),
)  # fmt: skip
def test_the_answer_is_always_plain_and_a_new_payee_is_never_just_pay(
    payee: str, amount: Decimal, reason: str, new: bool, message: str | None, level: Level | None
) -> None:
    advice = before_you_pay(
        payee, amount, reason, new_payee=new, message_text=message, registers_level=level
    )

    assert advice.verdict in {"pay", "wait", "stop"}
    assert flesch_reading_ease(advice.say) >= 60, advice.say
    assert not new or advice.verdict != "pay"
    assert level is not Level.LIKELY_SCAM or advice.verdict == "stop"
    assert (advice.verdict == "pay") == (advice.reasons == ())


@pytest.mark.parametrize(
    "advice",
    [
        check("Crown Yield", "2500", "my account is at risk", new=True, message=SAFE_ACCOUNT),
        check("Tom", "1500", "car", new=True),
        check("British Gas", "80", "gas bill", message="Act now or we cut you off"),
        check("British Gas", "80", "gas bill", level=Level.UNKNOWN),
        check("British Gas", "80", "gas bill", level=Level.NO_FLAGS),
    ],
    ids=["stop", "wait_new_and_large", "wait_pushed", "wait_registers", "pay"],
)
def test_before_you_pay_speaks_plainly(advice: PayeeAdvice) -> None:
    """Flesch 60 or more, like the eval in test_plain_language.py (kept here so the two tracks
    don't edit the same file). And never the word "safe" on its own: only in "safe account"."""
    score = flesch_reading_ease(advice.say)

    assert score >= 60, f"{advice.verdict} reads at {score:.0f}: {advice.say}"
    assert "safe" not in advice.say.replace("safe account", "")
