"""The Consensus Court: three models from three providers vote on eligibility (spec §11).

| Result                   | Action                               |
|--------------------------|--------------------------------------|
| 3/3 agree                | proceed                              |
| 2/3 agree                | proceed, flagged                     |
| a juror is absent        | the other two must agree, flagged    |
| a split, or < 2 jurors   | human checkpoint                     |

The court interprets eligibility and nothing else. It can say "no" or "ask a person", but it can
never turn the Rights Engine's "not eligible" into a "yes", and it never sets an amount.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Sequence
from enum import StrEnum

from pydantic import BaseModel, ConfigDict

from tempo_core.models import ProofStep, ProofTrace
from tempo_core.rules import NotEligible
from tempo_ports.court import CaseQuestion, Juror, JurorVerdict

JUROR_TIMEOUT_S = 20.0


class CourtOutcome(StrEnum):
    PROCEED = "proceed"
    PROCEED_FLAGGED = "proceed_flagged"
    HUMAN_CHECKPOINT = "human_checkpoint"


class NamedVerdict(BaseModel):
    model_config = ConfigDict(frozen=True)

    juror: str
    verdict: JurorVerdict


class CourtDecision(BaseModel):
    model_config = ConfigDict(frozen=True)

    outcome: CourtOutcome
    eligible: bool | None  # None when a person has to decide
    agreement_rate: float  # share of present jurors who agree with the decision (0 if none)
    verdicts: tuple[NamedVerdict, ...]
    absent: tuple[str, ...] = ()
    flags: tuple[str, ...] = ()

    def summary(self) -> str:
        votes = sum(v.verdict.eligible == self.eligible for v in self.verdicts)
        return f"{votes}/{len(self.verdicts) + len(self.absent)} jurors agreed"


class NeedsHuman(BaseModel):
    model_config = ConfigDict(frozen=True)

    reason: str


class ConsensusCourt:
    def __init__(self, jurors: Sequence[Juror], *, timeout_s: float = JUROR_TIMEOUT_S) -> None:
        if len(jurors) != 3:
            raise ValueError("the Consensus Court sits with exactly three jurors")
        self._jurors = tuple(jurors)
        self._timeout_s = timeout_s

    async def decide(self, question: CaseQuestion) -> CourtDecision:
        """Ask all three jurors at once. A juror that times out or errors is marked absent."""
        results = await asyncio.gather(*(self._ask(j, question) for j in self._jurors))
        verdicts = tuple(NamedVerdict(juror=j.name, verdict=v) for j, v in results if v is not None)
        absent = tuple(j.name for j, v in results if v is None)
        return aggregate(verdicts, absent)

    async def _ask(self, juror: Juror, question: CaseQuestion) -> tuple[Juror, JurorVerdict | None]:
        try:
            async with asyncio.timeout(self._timeout_s):
                return juror, await juror.deliberate(question)
        except Exception:  # timeout or invalid output: the juror is absent, never a silent yes
            return juror, None


def aggregate(verdicts: tuple[NamedVerdict, ...], absent: tuple[str, ...] = ()) -> CourtDecision:
    flags = [f"juror absent: {name}" for name in absent]
    if len(verdicts) < 2:
        return _human(verdicts, absent, flags, "fewer than two jurors answered")
    votes = Counter(v.verdict.eligible for v in verdicts)
    (winner, count), *rest = votes.most_common()
    if rest and rest[0][1] == count:  # with two or three yes/no votes, a tie is the only split
        return _human(verdicts, absent, flags, "the jurors are split")
    if len({v.verdict.rule_id for v in verdicts if v.verdict.eligible == winner}) > 1:
        flags.append("jurors agreed on eligibility but cited different rules")
    unanimous = count == len(verdicts) and not absent
    if not unanimous and not absent:
        dissent = [v.juror for v in verdicts if v.verdict.eligible != winner]
        flags.append(f"majority, not unanimous (dissent: {', '.join(dissent)})")
    return CourtDecision(
        outcome=CourtOutcome.PROCEED if unanimous and not flags else CourtOutcome.PROCEED_FLAGGED,
        eligible=winner,
        agreement_rate=count / len(verdicts),
        verdicts=verdicts,
        absent=absent,
        flags=tuple(flags),
    )


def apply_court(
    engine_result: ProofTrace | NotEligible, decision: CourtDecision
) -> ProofTrace | NotEligible | NeedsHuman:
    """Combine the Rights Engine's result with the court's interpretation.

    The amount always comes from the engine. The court may only narrow the result: decline it,
    or hand it to a person. A court "yes" adds a proof step; it never changes the amount.
    """
    if isinstance(engine_result, NotEligible):
        return engine_result
    if decision.outcome is CourtOutcome.HUMAN_CHECKPOINT or decision.eligible is None:
        return NeedsHuman(reason=f"The Consensus Court couldn't agree: {', '.join(decision.flags)}")
    rule = engine_result.steps[-1]
    if not decision.eligible:
        return NotEligible(
            reason=f"The Consensus Court found this isn't covered ({decision.summary()})",
            rule_id=rule.rule_id,
            rule_version=rule.rule_version,
            citation_url=rule.citation_url,
        )
    step = ProofStep(
        fact_keys=rule.fact_keys,
        rule_id="consensus-court",
        rule_version="1",
        citation_url=rule.citation_url,
        explanation=f"Consensus Court: {decision.summary()} that this is eligible",
    )
    return engine_result.model_copy(update={"steps": (*engine_result.steps, step)})


def _human(
    verdicts: tuple[NamedVerdict, ...], absent: tuple[str, ...], flags: list[str], why: str
) -> CourtDecision:
    agreeing = Counter(v.verdict.eligible for v in verdicts).most_common(1)
    rate = agreeing[0][1] / len(verdicts) if agreeing else 0.0
    return CourtDecision(
        outcome=CourtOutcome.HUMAN_CHECKPOINT,
        eligible=None,
        agreement_rate=rate,
        verdicts=verdicts,
        absent=absent,
        flags=(*flags, why),
    )
