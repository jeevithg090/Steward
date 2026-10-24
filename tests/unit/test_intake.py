from decimal import Decimal

from tempo_core.intake import follow_up
from tempo_core.models import Fact


def fact(key: str, value: str | int | Decimal, confidence: float) -> Fact:
    return Fact(key=key, value=value, source="ticket.jpg#vision", confidence=confidence)


def test_confident_facts_need_no_question() -> None:
    assert follow_up((fact("travel_date", "2026-10-23", 0.95),)) is None


def test_low_confidence_creates_one_question_not_many() -> None:
    facts = (
        fact("ticket_type", "Off-Peak Day Single", 0.4),
        fact("fare_gbp", Decimal("28.40"), 0.6),
        fact("travel_date", "2026-10-23", 0.7),
    )

    question = follow_up(facts)

    assert question is not None
    assert question.fact_key == "travel_date"  # the date matters most for the claim
    assert question.question == "I read the date you travelled as 23 October 2026. Is that right?"
    assert question.question.count("?") == 1


def test_money_is_read_back_in_pounds() -> None:
    question = follow_up((fact("fare_gbp", Decimal("28.4"), 0.6),))

    assert question is not None
    assert question.question == "I read the fare as £28.40. Is that right?"


def test_unknown_keys_are_asked_about_in_plain_words() -> None:
    question = follow_up((fact("seat_number", "C12", 0.3),))

    assert question is not None
    assert question.question == "I read seat number as C12. Is that right?"


def test_the_threshold_is_adjustable() -> None:
    assert follow_up((fact("origin", "Oxford", 0.85),), threshold=0.9) is not None


def test_whole_numbers_are_read_back_as_they_are() -> None:
    question = follow_up((fact("arrival_delay_min", 38, 0.5),))

    assert question is not None
    assert question.question == "I read arrival delay min as 38. Is that right?"
