"""Scam Shield speaks every line in the person's language (plan.md §12.1, finding 4).

For each Patience Profile language other than English, and each thing `say` can speak (a warning,
a hold, a caution, "I couldn't check", "no warning signs", and "I checked it" after a hold), the
spoken words are that language's, with no English line in them. The one English-only part is
"why", on purpose: the reasons are shown in writing (tempo_core.scam_voice.say explains why).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tempo_core.scam import ADVICE, Level, Verdict, Zone
from tempo_core.scam_voice import ENGLISH, KEYS, load_warnings, say

ROOT = Path(__file__).resolve().parents[2]
WARNINGS = load_warnings(ROOT / "voice" / "warnings.yaml")
LANGUAGES = ("hi", "pa", "pl", "ur", "cy")
WHY = ("it pretends to be a tax refund",)
SPOKEN = {
    "likely_scam": (Verdict(Level.LIKELY_SCAM, ("x",), ADVICE[Level.LIKELY_SCAM], zone=Zone.WARN,
                            why=WHY), False),
    "sandbox_hold": (Verdict(Level.CAUTION, ("x",), zone=Zone.SANDBOX, why=WHY), False),
    "caution": (Verdict(Level.CAUTION, ("x",), ADVICE[Level.CAUTION], zone=Zone.WARN, why=WHY),
                False),
    "unknown": (Verdict(Level.UNKNOWN, ("x",), ADVICE[Level.UNKNOWN]), False),
    "no_flags": (Verdict(Level.NO_FLAGS, (), ADVICE[Level.NO_FLAGS]), False),
    "cleared_after_hold": (Verdict(Level.NO_FLAGS, (), ADVICE[Level.NO_FLAGS], checked=True), True),
}  # fmt: skip


def test_every_language_gives_every_spoken_key_and_only_why_stays_english() -> None:
    assert set(WARNINGS) == set(LANGUAGES)
    for code in LANGUAGES:
        assert set(KEYS) - set(WARNINGS[code]) == {"why"}, code


@pytest.mark.parametrize("code", LANGUAGES)
@pytest.mark.parametrize("case", list(SPOKEN))
def test_each_level_and_zone_is_spoken_in_the_persons_language(code: str, case: str) -> None:
    verdict, held = SPOKEN[case]
    english = say(verdict, language="en", translations=WARNINGS, held=held)

    spoken = say(verdict, language=code, translations=WARNINGS, held=held)

    assert spoken and spoken != english
    assert not any(line in spoken for line in ENGLISH.values() if line != ENGLISH["why"])
    assert "Why:" not in spoken and WHY[0] not in spoken  # reasons are in writing, not half-said
