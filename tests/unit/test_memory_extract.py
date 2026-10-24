"""Rule-based memory candidates from the person's own words (S3.9)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from tempo_memory.extract import extract_candidates

AT = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("said", "expected"),
    [
        ("I prefer phone updates.", [("prefers phone updates", "preference", 0.9)]),
        (
            "I'd rather you texted me after 6pm",
            [("would rather you texted me after 6pm", "preference", 0.9)],
        ),
        (
            "Please remember that I take the 07:58 on Thursdays",
            [("take the 07:58 on Thursdays", "preference", 0.95)],
        ),
        ("I've moved to Abingdon", [("lives in Abingdon", "household", 0.85)]),
        ("my son Kevin sorts my post", [("Kevin is their son", "contact", 0.85)]),
        (
            "I commute from Oxford to Paddington",
            [("commutes Oxford to Paddington", "journey", 0.85)],
        ),
        ("I'm hard of hearing", [("is hard of hearing", "health", 0.85)]),
        ("I use a hearing aid", [("has a hearing aid", "health", 0.85)]),
        ("Was my train late?", []),
        ("Where do I live?", []),
    ],
)
def test_rules_propose_candidates(said: str, expected: list[tuple[str, str, float]]) -> None:
    found = extract_candidates(said, "u_1", "user_voice", AT)

    assert [(c.text, c.category, c.confidence) for c in found] == expected
    assert all((c.source, c.observed_at, c.user_id) == ("user_voice", AT, "u_1") for c in found)


def test_speech_confidence_scales_the_rule() -> None:
    (c,) = extract_candidates("I live in Didcot", "u_1", "user_voice", AT, confidence=0.5)

    assert c.confidence == 0.425  # below the Gate's 0.8, so Tempo reads it back


def test_the_same_fact_said_twice_is_one_candidate() -> None:
    found = extract_candidates(
        "I prefer phone updates. I prefer phone updates!", "u_1", "user_sms", AT
    )

    assert [c.text for c in found] == ["prefers phone updates"]
