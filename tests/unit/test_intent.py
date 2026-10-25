"""The chat's intent router (plan.md §4.1) against the shared vector file, plus its edges.

`fixtures/chat/intents.json` is the contract the web app's TypeScript port runs against too:
`today` fixes the relative dates, and each vector's `slots` are the non-null facts `extract`
returns for that vector's intent. Everything Tempo says in the chat must read plainly.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tempo_core.intent import (
    ALIASES,
    PROVIDERS,
    QUESTIONS,
    STATIONS,
    Intent,
    Slots,
    classify,
    extract,
    merge,
    missing,
    station_name,
)
from tempo_core.readability import flesch_reading_ease
from tempo_gateway.chat import CANNED, small_talk_ok

ROOT = Path(__file__).resolve().parents[2]
VECTORS = json.loads((ROOT / "fixtures" / "chat" / "intents.json").read_text(encoding="utf-8"))
TODAY = date.fromisoformat(VECTORS["today"])
PASS_BAR = 60


def found(text: str, intent: Intent) -> dict[str, str]:
    return {k: v for k, v in extract(text, today=TODAY, intent=intent).model_dump().items() if v}


@pytest.mark.parametrize(
    "vector", VECTORS["vectors"], ids=lambda v: str(v["text"])[:40] or "<empty>"
)
def test_every_vector_classifies_and_extracts_as_recorded(vector: dict[str, Any]) -> None:
    intent = classify(vector["text"])

    assert intent.value == vector["intent"]
    assert found(vector["text"], intent) == vector["slots"]


def test_the_vector_file_covers_every_intent_and_is_the_shared_shape() -> None:
    covered = {v["intent"] for v in VECTORS["vectors"]}

    assert covered == {i.value for i in Intent}
    assert len(VECTORS["vectors"]) >= 40
    assert set(VECTORS) == {"today", "vectors"}
    assert all(set(v) == {"text", "intent", "slots"} for v in VECTORS["vectors"])
    assert all(set(v["slots"]) <= set(Slots.model_fields) for v in VECTORS["vectors"])


def test_yes_and_no_lead_a_sentence_only_when_a_question_is_pending() -> None:
    assert classify("yes, the 08:12", pending_question=True) is Intent.APPROVE
    assert classify("yes, the 08:12") is Intent.RAIL_DELAY
    assert classify("No, that's not what I meant", pending_question=True) is Intent.DECLINE
    assert classify("No, that's not what I meant") is Intent.SMALLTALK
    assert classify("yes") is Intent.APPROVE  # a bare yes always is one
    assert classify("STOP", pending_question=True) is Intent.STOP  # STOP wins over everything


def test_edges_empty_long_and_mixed_case() -> None:
    assert classify("") is Intent.HELP
    assert classify("   \n ") is Intent.HELP
    assert classify("My TRAIN Was LATE") is Intent.RAIL_DELAY
    assert classify("x" * 2000) is Intent.SMALLTALK
    long = "my 08:12 Oxford to Paddington was late " * 50
    assert classify(long) is Intent.RAIL_DELAY
    assert found(long, Intent.RAIL_DELAY) == {
        "origin_crs": "OXF", "destination_crs": "PAD", "departure": "08:12"
    }  # fmt: skip


def test_a_fare_is_never_read_as_a_time_and_a_time_never_as_a_fare() -> None:
    slots = extract("the 08:12 cost £14.20", today=TODAY, intent=Intent.RAIL_DELAY)

    assert (slots.departure, slots.fare_gbp) == ("08:12", "14.20")
    assert extract("£14.20", today=TODAY).departure is None
    assert classify("£14.20") is Intent.SMALLTALK  # a bare fare has no door of its own


def test_dates_without_a_year_are_the_most_recent_ones() -> None:
    rail = Intent.RAIL_DELAY

    assert found("on 23 October", rail)["travel_date"] == "2026-10-23"
    assert found("on 2 November", rail)["travel_date"] == "2025-11-02"  # still to come this year
    assert found("on 23/10/25", rail)["travel_date"] == "2025-10-23"
    assert found("last Sunday", rail)["travel_date"] == "2026-10-18"  # today is a Sunday
    assert found("on Sunday", rail)["travel_date"] == "2026-10-25"
    assert "travel_date" not in found("on 31 February", rail)


def test_stations_from_and_to_in_either_order() -> None:
    assert found("from Paddington to Oxford", Intent.RAIL_DELAY) == {
        "origin_crs": "PAD", "destination_crs": "OXF"
    }  # fmt: skip
    assert found("to Oxford from Paddington", Intent.RAIL_DELAY) == {
        "origin_crs": "PAD", "destination_crs": "OXF"
    }  # fmt: skip
    assert found("OXF→PAD", Intent.RAIL_DELAY) == {"origin_crs": "OXF", "destination_crs": "PAD"}
    assert found("I was reading on the train", Intent.RAIL_DELAY) == {}  # not the station
    assert found("reading", Intent.RAIL_DELAY) == {"origin_crs": "RDG"}  # a one-word answer is


def test_the_station_table_is_consistent() -> None:
    assert len(set(STATIONS.values())) == len(STATIONS) == 20
    assert set(ALIASES.values()) <= set(STATIONS.values())
    assert station_name("PAD") == "Paddington" and station_name("oxf") == "Oxford"
    assert station_name("ZZZ") == "ZZZ"
    assert set(PROVIDERS) >= {"Broadbandly", "BT", "Sky", "Virgin Media", "TalkTalk", "Vodafone",
                              "EE", "Plusnet", "Now", "Openreach"}  # fmt: skip


def test_short_provider_names_stay_words_in_lower_case() -> None:
    assert classify("ee I'm not sure now") is Intent.SMALLTALK
    assert classify("yes now") is Intent.APPROVE
    assert classify("the EE engineer came late") is Intent.MISSED_VISIT
    assert found("Now Broadband never came", Intent.MISSED_VISIT) == {"operator": "Now"}


def test_merge_lets_the_new_turn_win_and_missing_asks_in_order() -> None:
    known = Slots(origin_crs="OXF", destination_crs="PAD", fare_gbp="28.40")
    this_turn = Slots(destination_crs="RDG", departure="08:12")

    merged = merge(known, this_turn)

    assert merged == Slots(origin_crs="OXF", destination_crs="RDG", departure="08:12",
                           fare_gbp="28.40")  # fmt: skip
    assert missing(Intent.RAIL_DELAY, merged) == [("travel_date", "What day was it?")]
    assert [f for f, _ in missing(Intent.RAIL_DELAY, Slots())] == [
        "origin_crs", "destination_crs", "travel_date", "departure", "fare_gbp"
    ]  # fmt: skip
    assert [f for f, _ in missing(Intent.MISSED_VISIT, Slots())] == ["operator", "event_date"]
    assert missing(Intent.SCAM_CHECK, Slots()) == []


def test_extract_without_an_intent_keeps_everything_and_routes_the_date_by_context() -> None:
    both = extract("BT never came on 19 October, the ticket was £5", today=TODAY)
    train = extract("the train was late on 19 October", today=TODAY)

    assert (both.operator, both.event_date, both.travel_date, both.fare_gbp) == (
        "BT", "2026-10-19", None, "5.00"
    )  # fmt: skip
    assert (train.travel_date, train.event_date) == ("2026-10-19", None)


@settings(max_examples=300, deadline=None)
@given(st.text(max_size=2000), st.booleans())
def test_any_text_classifies_and_extracts_without_error(text: str, pending: bool) -> None:
    intent = classify(text, pending_question=pending)

    assert isinstance(intent, Intent)
    slots = extract(text, today=TODAY, intent=intent)
    assert isinstance(slots, Slots)
    assert all(v is None or isinstance(v, str) for v in slots.model_dump().values())


def plain_strings() -> dict[str, str]:
    return {**{f"question_{k}": v for k, v in QUESTIONS.items()},
            **{f"chat_{k}": v for k, v in CANNED.items()}}  # fmt: skip


@pytest.mark.parametrize(("name", "text"), list(plain_strings().items()))
def test_every_canned_chat_string_reads_plainly(name: str, text: str) -> None:
    score = flesch_reading_ease(text)

    assert score >= PASS_BAR, f"{name} reads at {score:.0f}: {text}"


def test_small_talk_word_rules_let_only_a_plain_harmless_sentence_through() -> None:
    assert small_talk_ok("Lovely to hear from you. How can I help today?") is not None
    assert small_talk_ok(None) is None
    assert small_talk_ok("") is None
    assert small_talk_ok("You are owed £14.20.") is None  # money
    assert small_talk_ok("Your train was 38 minutes late.") is None  # a number
    assert small_talk_ok("I will claim it for you now.") is None  # a promise of an action
    assert small_talk_ok("I'll send the form.") is None
    assert small_talk_ok("See https://example.com for more.") is None
    assert small_talk_ok("Lovely. " * 40) is None  # too long
    jargon = "Remuneration eligibility determination necessitates comprehensive verification."
    assert small_talk_ok(jargon) is None  # not plain


@pytest.mark.parametrize(
    ("text", "origin", "destination"),
    [
        # Live, "Oxford to London" made Tempo ask "Where were you going?".
        (
            "My 17:42 train from Oxford to London on 23 October got cancelled. The ticket was £28.40.",
            "OXF",
            "PAD",
        ),
        ("the 18:05 from London to Banbury was late", "MYB", "BAN"),
        ("my train from Leeds to London was cancelled", "LDS", "KGX"),
        ("Oxford to London Euston, 30 minutes late", "OXF", "EUS"),  # a station said is kept
        ("a train to London was late", None, None),  # nothing says which terminus
    ],
)
def test_the_city_london_is_the_terminus_a_train_from_the_other_end_arrives_at(
    text: str, origin: str | None, destination: str | None
) -> None:
    found = extract(text, today=date(2026, 10, 25), intent=Intent.RAIL_DELAY)
    assert (found.origin_crs, found.destination_crs) == (origin, destination)
