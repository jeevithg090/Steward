"""Scam Shield's rules (S7.3): flags with reasons, and never "safe"."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from tempo_core.links import find_links
from tempo_core.scam import Evidence, FirmCheck, Level, SandboxReport, Zone, assess, pressure_signs
from tempo_core.scam_model import Score

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


# --- v2: zones, links, the model and the sandbox (docs/scam-shield.md §4.4) -----------------------

HMRC = (
    "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
PARCEL = "Your parcel is waiting. Track it: rb.gy/4k2q"


def score(p: float, zone: str, *words: str) -> Score:
    return Score(probability=p, decision=0.0, zone=zone, top_words=tuple(words))  # type: ignore[arg-type]


def test_a_genuine_one_time_code_is_not_a_request_for_one() -> None:
    genuine = "Your HSBC passcode is 482913. Never share this code with anyone, including staff."
    bank = "SIB never asks for sensitive information like Passwords, ATM/SMS PIN through SMS."
    assert "a code or password" not in pressure_signs(genuine)
    assert "a code or password" not in pressure_signs(bank)
    assert "a code or password" in pressure_signs("Please read me the code we sent you")
    assert "a code or password" in pressure_signs("Can you send me your pin number?")
    assert assess(genuine, None).level is Level.NO_FLAGS


def test_a_brand_look_alike_link_is_a_likely_scam_that_speaks_now() -> None:
    verdict = assess(HMRC, None, Evidence(families=("scam_official_pretext", "scam_urgency")))

    assert verdict.level is Level.LIKELY_SCAM and verdict.zone is Zone.WARN
    assert verdict.reasons[0] == "its link hmrc-refunds-gov.uk only looks like a real one"
    assert verdict.link_hosts == ("hmrc-refunds-gov.uk",)
    assert "its link only looks like HMRC's" in verdict.why
    assert "it pretends to be a tax refund, a parcel fee or your bank's fraud team" in verdict.why


def test_a_shortened_link_with_no_other_sign_is_held_for_the_sandbox() -> None:
    verdict = assess(PARCEL, None, Evidence(score=score(0.58, "sandbox")))

    assert (verdict.level, verdict.zone, verdict.checked) == (Level.CAUTION, Zone.SANDBOX, False)
    assert verdict.confidence == 0.58
    assert "its link rb.gy needs a closer look" in verdict.reasons


def test_the_sandbox_settles_a_held_message_either_way() -> None:
    bad = SandboxReport("rb.gy", ("redirects_to:evri-redelivery.co", "card_form", "new_domain:9"))
    fine = SandboxReport("rb.gy", ("redirects_to:evri.com",), official=True)

    caught = assess(PARCEL, None, Evidence(sandbox=(bad,)))
    cleared = assess(PARCEL, None, Evidence(sandbox=(fine,)))

    assert (caught.level, caught.zone, caught.checked) == (Level.LIKELY_SCAM, Zone.WARN, True)
    assert "the page behind the link asks for card details" in caught.why
    assert cleared.level is Level.CAUTION and cleared.zone is Zone.QUIET and cleared.checked
    assert "the link quietly moves you on to evri.com" in cleared.why


def test_a_public_phishing_list_wins_on_its_own() -> None:
    verdict = assess(
        "Track your parcel: tinyurl.com/abc", None, Evidence(feed_hits=("tinyurl.com",))
    )

    assert verdict.level is Level.LIKELY_SCAM and verdict.zone is Zone.WARN
    assert verdict.reasons[0] == "a public phishing list names tinyurl.com"


def test_the_model_ranks_but_the_zone_is_the_models_only_when_nothing_else_speaks() -> None:
    sure = assess(
        "You have won a prize, call now", None, Evidence(score=score(0.97, "warn", "prize", "won"))
    )
    unsure = assess("Your table is booked for 7pm", None, Evidence(score=score(0.4, "sandbox")))
    quiet = assess("Your table is booked for 7pm", None, Evidence(score=score(0.02, "quiet")))

    assert sure.level is Level.CAUTION and sure.zone is Zone.QUIET  # formal alone never speaks
    assert "though nothing else confirms it" in sure.reasons[0]
    backed = assess(
        "You have won a prize, claim now at bit.ly/x", None,
        Evidence(score=score(0.97, "warn", "prize", "won"), families=("scam_urgency",)),
    )  # fmt: skip
    assert backed.level is Level.LIKELY_SCAM and backed.zone is Zone.WARN
    assert "it uses words seen in scam texts, like prize, won" in backed.why
    assert unsure.level is Level.CAUTION and unsure.zone is Zone.QUIET  # nothing to inspect
    assert quiet.level is Level.NO_FLAGS and quiet.zone is Zone.QUIET and quiet.confidence == 0.02


def test_links_passed_in_are_used_instead_of_the_text() -> None:
    links = find_links("see http://evri-track.co/x")
    verdict = assess("a message the phone kept to itself", None, Evidence(links=links))

    assert verdict.level is Level.LIKELY_SCAM and verdict.link_hosts == ("evri-track.co",)


def test_v1_callers_still_get_the_same_answers() -> None:
    verdict = assess("Your statement is ready to view in the app.", CLEAN)

    assert (verdict.level, verdict.zone, verdict.confidence, verdict.why) == (
        Level.NO_FLAGS,
        Zone.QUIET,
        None,
        (),
    )
