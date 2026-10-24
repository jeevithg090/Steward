import asyncio
import time
from decimal import Decimal
from typing import Any

import pytest

from tempo_core.models import ProofStep, ProofTrace
from tempo_core.rules import NotEligible
from tempo_missions.court import (
    ConsensusCourt,
    CourtOutcome,
    NeedsHuman,
    apply_court,
)
from tempo_ports.court import CaseQuestion, JurorVerdict

QUESTION = CaseQuestion(
    mission_id="m_1",
    question="Was the delay caused by extraordinary circumstances?",
    rule_id="uk261.delay",
    rule_text="Compensation is not payable where the delay was caused by extraordinary...",
)
ENGINE_TRACE = ProofTrace(
    id="pt_1",
    steps=(
        ProofStep(
            fact_keys=("arrival_delay_min",),
            rule_id="uk261.delay",
            rule_version="0.1.0",
            citation_url="https://www.caa.co.uk/",
            explanation="Arrived 4 h late on a 2100 km flight → £350.00 under UK261",
        ),
    ),
    amount_gbp=Decimal("350.00"),
)


class FakeJuror:
    def __init__(
        self,
        name: str,
        eligible: bool = True,
        *,
        rule_id: str = "uk261.delay",
        delay_s: float = 0.0,
        error: Exception | None = None,
        amount: str | None = None,
    ) -> None:
        self.name = name
        self._verdict = JurorVerdict(
            eligible=eligible,
            rule_id=rule_id,
            confidence=0.9,
            amount_gbp=Decimal(amount) if amount else None,
        )
        self._delay_s = delay_s
        self._error = error

    async def deliberate(self, question: CaseQuestion) -> JurorVerdict:
        await asyncio.sleep(self._delay_s)
        if self._error:
            raise self._error
        return self._verdict


def court(*jurors: Any, timeout_s: float = 1.0) -> ConsensusCourt:
    return ConsensusCourt(jurors, timeout_s=timeout_s)


async def test_unanimous_proceeds() -> None:
    decision = await court(FakeJuror("a"), FakeJuror("b"), FakeJuror("c")).decide(QUESTION)

    assert decision.outcome is CourtOutcome.PROCEED
    assert decision.eligible is True
    assert decision.agreement_rate == 1.0
    assert decision.flags == ()


async def test_majority_proceeds_with_flag() -> None:
    decision = await court(FakeJuror("a"), FakeJuror("b"), FakeJuror("c", False)).decide(QUESTION)

    assert decision.outcome is CourtOutcome.PROCEED_FLAGGED
    assert decision.eligible is True
    assert "dissent: c" in decision.flags[0]


async def test_agreement_rate_metric_recorded() -> None:
    decision = await court(FakeJuror("a"), FakeJuror("b", False), FakeJuror("c")).decide(QUESTION)

    assert decision.agreement_rate == pytest.approx(2 / 3)
    assert decision.summary() == "2/3 jurors agreed"


async def test_split_requires_human() -> None:
    jurors = (
        FakeJuror("a"),
        FakeJuror("b", False),
        FakeJuror("c", error=ValueError("bad JSON")),
    )

    decision = await court(*jurors).decide(QUESTION)

    assert decision.outcome is CourtOutcome.HUMAN_CHECKPOINT
    assert decision.eligible is None
    assert "the jurors are split" in decision.flags


async def test_juror_timeout_marks_absent_and_still_decides() -> None:
    jurors = (FakeJuror("a"), FakeJuror("b"), FakeJuror("slow", delay_s=5))

    decision = await court(*jurors, timeout_s=0.05).decide(QUESTION)

    assert decision.absent == ("slow",)
    assert decision.outcome is CourtOutcome.PROCEED_FLAGGED  # 2-of-2, flagged
    assert decision.eligible is True
    assert "juror absent: slow" in decision.flags


async def test_two_absent_jurors_need_a_human() -> None:
    jurors = (FakeJuror("a"), FakeJuror("b", error=RuntimeError()), FakeJuror("c", delay_s=5))

    decision = await court(*jurors, timeout_s=0.05).decide(QUESTION)

    assert decision.outcome is CourtOutcome.HUMAN_CHECKPOINT
    assert "fewer than two jurors answered" in decision.flags


async def test_jurors_deliberate_concurrently() -> None:
    jurors = [FakeJuror(n, delay_s=0.2) for n in "abc"]

    start = time.perf_counter()
    await court(*jurors).decide(QUESTION)

    assert time.perf_counter() - start < 0.5


async def test_different_rules_are_flagged_even_when_unanimous() -> None:
    jurors = (FakeJuror("a"), FakeJuror("b"), FakeJuror("c", rule_id="uk261.cancellation"))

    decision = await court(*jurors).decide(QUESTION)

    assert decision.outcome is CourtOutcome.PROCEED_FLAGGED
    assert "cited different rules" in decision.flags[0]


def test_the_court_sits_with_exactly_three_jurors() -> None:
    with pytest.raises(ValueError, match="three"):
        ConsensusCourt([FakeJuror("a"), FakeJuror("b")])


async def test_court_cannot_override_rights_engine_amount() -> None:
    jurors = [FakeJuror(n, amount="999.99") for n in "abc"]  # every juror names a bigger sum

    decision = await court(*jurors).decide(QUESTION)
    final = apply_court(ENGINE_TRACE, decision)

    assert isinstance(final, ProofTrace)
    assert final.amount_gbp == Decimal("350.00")
    assert final.steps[-1].explanation == "Consensus Court: 3/3 jurors agreed that this is eligible"
    assert final.steps[0] == ENGINE_TRACE.steps[0]


async def test_court_cannot_turn_not_eligible_into_eligible() -> None:
    engine_said_no = NotEligible(
        reason="arrived 2 h late; UK261 starts at 3 h",
        rule_id="uk261.delay",
        rule_version="0.1.0",
        citation_url="https://www.caa.co.uk/",
    )
    decision = await court(FakeJuror("a"), FakeJuror("b"), FakeJuror("c")).decide(QUESTION)

    assert apply_court(engine_said_no, decision) is engine_said_no


async def test_a_court_no_declines_with_its_working() -> None:
    jurors = (FakeJuror("a", False), FakeJuror("b", False), FakeJuror("c"))

    final = apply_court(ENGINE_TRACE, await court(*jurors).decide(QUESTION))

    assert isinstance(final, NotEligible)
    assert final.reason == "The Consensus Court found this isn't covered (2/3 jurors agreed)"
    assert final.rule_id == "uk261.delay"


async def test_a_split_goes_to_a_person() -> None:
    jurors = (FakeJuror("a"), FakeJuror("b", False), FakeJuror("c", error=TimeoutError()))

    final = apply_court(ENGINE_TRACE, await court(*jurors).decide(QUESTION))

    assert isinstance(final, NeedsHuman)
    assert "split" in final.reason
