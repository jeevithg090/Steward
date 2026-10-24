"""The Patience Profile (ElevenLabs idea 3): memories in, how Tempo speaks out. Pure."""

from __future__ import annotations

from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from tempo_core.readability import flesch_reading_ease
from tempo_core.voice_profile import (
    LANGUAGES,
    MAX_KEYWORDS,
    SPEED_MAX,
    SPEED_MIN,
    VoiceProfile,
    how_to_speak,
    profile_from,
    to_initiation,
)

VOICES = {"default": "voice_tempo", "low": "voice_tempo_low"}
GREETINGS = {"hi": "नमस्ते, मैं Tempo हूँ, एक AI सहायक।"}


def initiation(profile: VoiceProfile) -> dict:
    return to_initiation(
        profile, user_id="u_1", display_name="Dilip", voices=VOICES, greetings=GREETINGS
    )


def test_no_memories_is_everyones_call() -> None:
    profile = profile_from([])

    assert profile == VoiceProfile()
    assert not profile.adjusted
    answer = initiation(profile)
    assert answer["type"] == "conversation_initiation_client_data"
    assert "conversation_config_override" not in answer  # nothing to override
    assert answer["dynamic_variables"]["patience"] == "normal"


def test_a_stammer_means_patience_not_a_different_voice() -> None:
    profile = profile_from([("access", "has a stammer"), ("access", "needs more time to answer")])

    assert (profile.patience, profile.stammer, profile.voice, profile.speed) == (
        "high", True, "default", Decimal("1.0"),
    )  # fmt: skip
    assert "stammer" in how_to_speak(profile)
    assert "Wait as long as it takes" in how_to_speak(profile)
    assert "conversation_config_override" not in initiation(profile)  # the agent is told, in words
    assert profile.reasons == ("has a stammer", "needs more time to answer")


def test_hindi_and_slower() -> None:
    profile = profile_from([("access", "speaks Hindi"), ("access", "wants slower speech")])
    override = initiation(profile)["conversation_config_override"]

    assert override["agent"] == {"language": "hi", "first_message": GREETINGS["hi"]}
    assert override["tts"] == {"speed": 0.85}
    assert how_to_speak(profile).startswith("Speak Hindi")


def test_hard_of_hearing_is_lower_slower_and_steadier() -> None:
    profile = profile_from(
        [("access", "is hard of hearing"), ("access", "prefers text for questions")]
    )
    answer = initiation(profile)

    assert answer["conversation_config_override"]["tts"] == {
        "voice_id": "voice_tempo_low", "speed": 0.9, "stability": 0.65,
    }  # fmt: skip
    assert answer["dynamic_variables"]["channel_hint"] == "text"
    assert "say key numbers twice" in answer["dynamic_variables"]["how_to_speak"]


def test_slower_wins_over_hearing_speed() -> None:
    profile = profile_from([("access", "is deaf"), ("access", "please talk slower")])

    assert profile.speed == Decimal("0.85")


def test_no_low_voice_configured_keeps_the_default_voice() -> None:
    profile = profile_from([("access", "prefers a lower voice")])
    answer = to_initiation(profile, user_id=None, display_name=None, voices={}, greetings={})

    assert "conversation_config_override" not in answer
    assert answer["dynamic_variables"]["caller_id"] == ""


def test_a_language_the_agent_cannot_speak_stays_english_and_says_so() -> None:
    profile = profile_from([("access", "speaks Bengali")])

    assert (profile.language, profile.other_language) == ("en", "Bengali")
    assert "may prefer Bengali" in how_to_speak(profile)
    assert "conversation_config_override" not in initiation(profile)


def test_their_stations_and_people_become_recogniser_keywords() -> None:
    profile = profile_from([
        ("journey", "commutes Reading to Paddington"), ("contact", "Kevin is their son"),
        ("journey", "commutes Reading to Paddington"),
    ])  # fmt: skip

    assert profile.keywords == ("Reading", "Paddington", "Kevin", "Tempo", "Delay Repay")
    assert initiation(profile)["conversation_config_override"]["asr"]["keywords"][0] == "Reading"
    assert not profile.adjusted  # keywords help it hear; they don't change how it speaks


@pytest.mark.parametrize("category", ["preference", "health", "finance", "household"])
def test_other_categories_never_change_how_tempo_speaks(category: str) -> None:
    assert profile_from([(category, "speaks Hindi slowly with a lower voice")]) == VoiceProfile()


@pytest.mark.parametrize(
    "memories",
    [
        [],
        [("access", "has a stammer")],
        [("access", "speaks Welsh"), ("access", "wants slower speech")],
        [("access", "is hard of hearing"), ("access", "prefers text for questions")],
        [("access", "speaks Bengali")],
        [("access", "speaks Punjabi"), ("access", "has a stammer"), ("access", "is deaf"),
         ("access", "prefers text for questions")],
    ],
)  # fmt: skip
def test_what_the_agent_is_told_is_plain_english(memories: list[tuple[str, str]]) -> None:
    assert flesch_reading_ease(how_to_speak(profile_from(memories))) >= 60


@given(
    st.lists(
        st.tuples(
            st.sampled_from(["access", "journey", "contact", "preference", "health"]),
            st.text(max_size=60),
        ),
        max_size=80,
    )
)
def test_any_memories_give_a_profile_elevenlabs_accepts(memories: list[tuple[str, str]]) -> None:
    profile = profile_from(memories)

    assert SPEED_MIN <= profile.speed <= SPEED_MAX
    assert profile.language in LANGUAGES.values()
    assert len(profile.keywords) <= MAX_KEYWORDS
    override = initiation(profile).get("conversation_config_override", {})
    assert set(override) <= {"agent", "tts", "asr"}
    assert set(override.get("tts", {})) <= {"voice_id", "speed", "stability"}
