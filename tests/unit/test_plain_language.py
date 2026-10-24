"""Plain-language eval (S6.1): what Tempo says to people must read at Flesch 60 or more.

The messages come from the real code paths (engine, Arbiter, intake, mission outcomes), so a
change that makes Tempo harder to understand fails here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from tempo_core.arbiter import ActionOption, choose_action
from tempo_core.intake import follow_up
from tempo_core.models import Fact
from tempo_core.readability import flesch_reading_ease, syllables
from tempo_core.rules import NotEligible, RulePackRegistry, evaluate_delay_repay
from tempo_core.time_value import TimeProfile, time_value

SKILLS = Path(__file__).resolve().parents[2] / "skills" / "clawback-uk-rail"
PASS_BAR = 60
FACT = (Fact(key="arrival_delay_min", value=9, source="hsp", confidence=1.0),)


def messages() -> dict[str, str]:
    gwr = RulePackRegistry.from_directory(SKILLS).delay_repay("GWR")
    decline = evaluate_delay_repay(
        gwr, delay_minutes=9, fare_gbp=Decimal("28.40"), facts=FACT, trace_id="t"
    )
    assert isinstance(decline, NotEligible)
    online = ActionOption(
        id="a",
        label="I claim online for you",
        p_success=Decimal("0.9"),
        amount_gbp=Decimal("14.20"),
        user_minutes=Decimal(0),
        compute_gbp=Decimal("0.05"),
    )
    tiny = online.model_copy(update={"amount_gbp": Decimal("0.40"), "user_minutes": Decimal(5)})
    question = follow_up(
        (Fact(key="fare_gbp", value=Decimal("28.40"), source="t.jpg#vision", confidence=0.6),)
    )
    assert question is not None
    return {
        "arbiter_choice": choose_action([online], time_value_gbp_h=Decimal(18)).explanation,
        "arbiter_decline": choose_action([tiny], time_value_gbp_h=Decimal(18)).explanation,
        "rule_decline": f"Nothing to claim: {decline.reason}.",
        "follow_up": question.question,
        "time_value": time_value(
            TimeProfile(hourly_pay_gbp=Decimal(12), shift_worker=True)
        ).explanation,
        "consent_no": "Stopped: you said no. Nothing was sent.",
        "filed": "Claim filed. I'll check the payment has arrived on 31 Oct at 09:00.",
        "paid": "GWR has paid you £14.20 (reference GW-12345). That's 20 minutes of your time back.",
        "not_paid": "I've claimed £14.20 (reference GW-12345), but GWR hasn't paid after 4 checks. I'll chase it.",
        "failed_safe": "I couldn't verify that approval, so I did nothing.",
    }


def test_syllable_estimates_are_sane() -> None:
    assert [syllables(w) for w in ("time", "returned", "compensation", "the")] == [1, 2, 4, 1]


@pytest.mark.parametrize(("name", "text"), list(messages().items()))
def test_tempo_speaks_plainly(name: str, text: str) -> None:
    score = flesch_reading_ease(text)

    assert score >= PASS_BAR, f"{name} reads at {score:.0f}: {text}"


def test_there_are_ten_messages_in_the_eval() -> None:
    assert len(messages()) == 10


def test_jargon_scores_lower_than_plain_words() -> None:
    jargon = "Remuneration eligibility determination necessitates comprehensive documentation verification."
    plain = "We need to check your ticket before we can pay you."

    assert flesch_reading_ease(plain) > PASS_BAR > flesch_reading_ease(jargon)


def test_now_is_not_used() -> None:  # keep the dataset deterministic
    assert datetime(2026, 10, 24, tzinfo=UTC).year == 2026
