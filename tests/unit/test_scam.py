"""Scam Shield's rules (S7.3): flags with reasons, and never "safe"."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from tempo_core.scam import FirmCheck, Level, assess, pressure_signs

CLEAN = FirmCheck("Halifax", on_warning_list=False, fca_authorised=True, contact_matches_register=True,
                  company_active=True, company_age_days=13_000)  # fmt: skip


def test_a_warned_firm_is_a_likely_scam() -> None:
    verdict = assess(
        "Your refund is ready", FirmCheck("Crown Yield Partners", on_warning_list=True)
    )

    assert verdict.level is Level.LIKELY_SCAM
    assert verdict.reasons[0] == "the FCA warns about Crown Yield Partners"
    assert "never one from the message" in verdict.advice


def test_a_clone_of_an_authorised_firm_is_a_likely_scam() -> None:
    clone = FirmCheck(
        "Halifax", on_warning_list=False, fca_authorised=True, contact_matches_register=False
    )

    assert "(a clone)" in assess("Hello from Halifax", clone).reasons[0]


def test_a_safe_account_or_a_code_is_a_likely_scam_even_from_an_unknown_sender() -> None:
    verdict = assess(
        "Your account is locked. Move your money to a safe account within 2 hours.", None
    )

    assert verdict.level is Level.LIKELY_SCAM
    assert verdict.reasons == (
        "it asks for a safe account",
        "it uses pressure: a safe account",
        "it uses pressure: moving your money",
        "it uses pressure: a deadline to act now",
    )


def test_pressure_or_a_weak_company_is_caution() -> None:
    assert assess("Pay with gift cards today only", CLEAN).level is Level.CAUTION
    dissolved = FirmCheck("Old Co", False, False, None, company_active=False, company_age_days=4000)
    assert assess("Hello", dissolved).reasons == ("Old Co is dissolved at Companies House",)
    new = FirmCheck(
        "Quick Refund Services", False, False, None, company_active=True, company_age_days=14
    )
    assert assess("Hello", new).reasons == (
        "Quick Refund Services was registered only 14 days ago",
    )


def test_an_unreachable_register_is_unknown_never_fine() -> None:
    unchecked = FirmCheck(
        "Halifax", on_warning_list=False, fca_authorised=None, company_active=True
    )

    verdict = assess("Your statement is ready", unchecked)

    assert verdict.level is Level.UNKNOWN
    assert "couldn't check" in verdict.advice


def test_clean_is_no_warning_signs_not_safe() -> None:
    assert assess("Your statement is ready to view in the app.", CLEAN).level is Level.NO_FLAGS
    assert assess("Thanks for your call.", None).level is Level.NO_FLAGS
    assert "doesn't prove it's genuine" in assess("Hi", CLEAN).advice


def test_pressure_signs_are_named_in_plain_words() -> None:
    text = "Don't tell your bank. Read me the one-time passcode and buy Bitcoin immediately."

    assert pressure_signs(text) == [
        "gift cards or crypto", "a deadline to act now", "a code or password", "secrecy",
    ]  # fmt: skip


@given(text=st.text(max_size=200), flags=st.lists(st.sampled_from([None, True, False]), min_size=4, max_size=4),
       age=st.one_of(st.none(), st.integers(0, 20_000)))  # fmt: skip
def test_the_answer_is_never_safe(text: str, flags: list[bool | None], age: int | None) -> None:
    firm = FirmCheck("Any Firm", flags[0], flags[1], flags[2], flags[3], age)

    verdict = assess(text, firm)

    assert verdict.level in set(Level) and "safe" not in verdict.level.value
    assert verdict.advice
