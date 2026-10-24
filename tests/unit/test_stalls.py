import pytest

from tempo_core.stalls import COUNTER_PLAY, Stall, classify

GOLDEN = {
    Stall.CALLBACK_DEFLECTION: [
        "I'll get someone to call you back.",
        "That takes five to seven working days.",
        "We'll be in touch.",
    ],
    Stall.TRANSFER_LOOP: [
        "Let me transfer you.",
        "I'll put you through to claims.",
        "That's another department.",
    ],
    Stall.POLICY_WALL: [
        "I'm afraid that's our policy.",
        "It's in the terms and conditions.",
        "That's not something we can do.",
    ],
    Stall.FORM_DEFLECTION: [
        "You need to use the online form.",
        "Please claim on our website.",
        "Claims are in writing only.",
    ],
    Stall.INFORMATION_FISHING: [
        "Can I take the ticket number again?",
        "What's the passenger's date of birth?",
        "I need to confirm your details.",
    ],
    Stall.HOLD_EXTENSION: [
        "Please continue to hold.",
        "Bear with me.",
        "Your call is important to us.",
    ],
    Stall.LOWBALL_OFFER: [
        "I can offer a five pound voucher.",
        "As a goodwill gesture, ten pounds.",
        "That's my final offer.",
    ],
    Stall.DENIAL_WITHOUT_REASON: [
        "You're not eligible.",
        "I can't help you with that.",
        "Your claim has been declined.",
    ],
}


@pytest.mark.parametrize(
    ("stall", "phrase"), [(s, p) for s, phrases in GOLDEN.items() for p in phrases]
)
def test_rule_classifier_golden_phrases(stall: Stall, phrase: str) -> None:
    assert classify(phrase) is stall


@pytest.mark.parametrize(
    "phrase", ["Good morning, how can I help?", "Your reference is GW-12345.", ""]
)
def test_unknown_phrase_returns_none_not_guess(phrase: str) -> None:
    assert classify(phrase) is None


def test_every_category_has_golden_phrases_and_a_counter() -> None:
    assert set(GOLDEN) == set(Stall) == set(COUNTER_PLAY)
    assert all(len(phrases) >= 3 for phrases in GOLDEN.values())
