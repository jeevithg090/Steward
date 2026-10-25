"""What a model hands to a tool must have been said (plan.md §16): grounding.py and the brain's
own-words rules."""

from __future__ import annotations

from datetime import date

import pytest

from tempo_gateway import grounding
from tempo_gateway.brain import plain, said_ok

TODAY = date(2026, 10, 25)
SAID = "my 8:12 from Oxford to London was late on 23 October, the ticket was £28.40"
CLAIM = {
    "origin_station": "Oxford", "destination_station": "London Paddington",
    "travel_date": "2026-10-23", "departure_time": "08:12", "fare_gbp": "28.40",
}  # fmt: skip


def test_a_journey_said_in_full_is_accepted_and_london_from_oxford_is_paddington() -> None:
    slots, problems = grounding.train(CLAIM, SAID, TODAY)
    assert problems == []
    assert slots is not None
    assert (slots.origin_crs, slots.destination_crs, slots.departure, slots.fare_gbp) == (
        "OXF",
        "PAD",
        "08:12",
        "28.40",
    )


def test_the_city_london_is_the_terminus_a_train_from_there_arrives_at() -> None:
    # Live, the model asked "which London station?" of someone who just said "Oxford to London".
    slots, problems = grounding.train(CLAIM | {"destination_station": "London"}, SAID, TODAY)
    assert problems == [] and slots is not None and slots.destination_crs == "PAD"
    back = "my 17:42 from London to Banbury on 23 October was cancelled, the ticket was £28.40"
    claim = CLAIM | {"origin_station": "London", "destination_station": "Banbury",
                     "departure_time": "17:42"}  # fmt: skip
    slots, problems = grounding.train(claim, back, TODAY)
    assert problems == [] and slots is not None and slots.origin_crs == "MYB"
    # Where nothing says which terminus, the person is asked.
    _, problems = grounding.train(
        CLAIM | {"origin_station": "London", "destination_station": "London"}, SAID, TODAY
    )
    assert any(p.startswith("origin") for p in problems)


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        ({"departure_time": "09:00"}, "departure time"),
        ({"fare_gbp": "30.00"}, "fare"),
        ({"travel_date": "2026-10-21"}, "travel date"),
        ({"travel_date": "2026-11-23"}, "travel date"),  # in the future
        ({"origin_station": "Reading"}, "origin"),
        ({"destination_station": "Atlantis Central"}, "destination"),
    ],
)
def test_a_fact_the_person_never_said_is_refused(change: dict[str, str], problem: str) -> None:
    slots, problems = grounding.train(CLAIM | change, SAID, TODAY)
    assert slots is None
    assert any(p.startswith(problem) for p in problems), problems


def test_a_day_said_in_words_counts() -> None:
    _, problems = grounding.train(
        CLAIM | {"travel_date": "2026-10-24"}, SAID.replace("on 23 October", "yesterday"), TODAY
    )
    assert problems == []


def test_a_missed_visit_needs_a_provider_tempo_can_claim_against() -> None:
    slots, problems = grounding.visit(
        {"provider": "Virgin Media", "visit_date": "2026-10-19"},
        "Virgin Media never came on 19 October",
        TODAY,
    )
    assert problems == [] and slots is not None and slots.operator == "Virgin Media"
    slots, problems = grounding.visit(
        {"provider": "plumber", "visit_date": "2026-10-19"},
        "my plumber never came on 19 October",
        TODAY,
    )
    assert slots is None and "not a broadband or phone provider" in problems[0]


@pytest.mark.parametrize(
    "words",
    [
        "I've claimed £14.20 for you.",
        "That's 50% back.",
        "Your claim has been submitted.",
        "You get 12 pounds.",
    ],
)
def test_the_brains_own_words_never_carry_an_amount_or_a_done_deed(words: str) -> None:
    assert said_ok(words) is None


def test_plain_kind_words_pass() -> None:
    assert (
        said_ok("I'm sorry about the train. What day was it?")
        == "I'm sorry about the train. What day was it?"
    )
    assert said_ok("Was it the 08:12 from Oxford?") is not None  # a time is not an amount


def test_markdown_comes_out_as_plain_lines_and_one_paragraph_for_the_voice() -> None:
    reply = "Trains from Oxford arrive at **London Paddington**.\n\n1. Was it that one?"
    assert said_ok(reply) == "Trains from Oxford arrive at London Paddington.\n• Was it that one?"
    assert plain(reply) == "Trains from Oxford arrive at London Paddington. Was it that one?"


def test_a_general_answer_may_give_a_price_but_never_a_done_deed() -> None:
    assert said_ok("A double room is about £120 a night.", about_a_claim=False) is not None
    assert said_ok("A double room is about £120 a night.") is None  # about a claim: no amounts
    assert said_ok("I've booked it for you.", about_a_claim=False) is None


def test_a_long_answer_is_read_aloud_as_its_first_sentence_and_a_pointer_to_the_screen() -> None:
    from tempo_gateway.chat import ON_SCREEN, spoken

    short = "Tomorrow in Oxford: light rain, high 16°C."
    assert spoken(short) == short
    hotels = "OpenStreetMap lists these hotels in Oxford.\n" + "\n".join(
        f"• Hotel {i}, Broad Street" * 3 for i in range(8)
    )
    assert spoken(hotels) == f"OpenStreetMap lists these hotels in Oxford. {ON_SCREEN}"
