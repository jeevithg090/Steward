"""Assessing a claim: find the train, apply the rules, check the interpretation, weigh the time."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from agent_framework import WorkflowContext, handler

from tempo_core.arbiter import ActionOption, choose_action
from tempo_core.delays import claimable_delay
from tempo_core.errors import NotCovered, RailDataUnavailable, ServiceNotFound
from tempo_core.models import Fact
from tempo_core.rules import (
    DelayRepayPack,
    DistanceBandPack,
    FixedAmountPack,
    NotEligible,
    evaluate_delay_repay,
)
from tempo_core.rules.words import rule_in_words
from tempo_missions.clawback_rail.base import DO_IT_YOURSELF_MINUTES, ClawbackDeps, S, _Step
from tempo_missions.clawback_rail.messages import (
    ClaimRequest,
    MissionOutcome,
    RailCase,
)
from tempo_missions.court import NeedsHuman, apply_court
from tempo_ports.court import CaseQuestion


class Intake(_Step):
    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("intake", deps)

    @handler
    async def run(
        self, request: ClaimRequest, ctx: WorkflowContext[RailCase, MissionOutcome]
    ) -> None:
        try:
            journey = await self.deps.rail.service_delay(
                request.origin_crs,
                request.destination_crs,
                date.fromisoformat(request.travel_date),
                request.departure,
            )
        except (ServiceNotFound, RailDataUnavailable) as exc:
            await self.stop(
                ctx, request.mission_id, f"I couldn't find that train in the rail records ({exc})."
            )
            return
        await self.move(request.mission_id, S.UNDERSTOOD)
        await ctx.send_message(RailCase(request=request, journey_json=journey.model_dump_json()))


class Rights(_Step):
    """The Rights Engine decides the amount; nothing later can change it."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("rights", deps)

    @handler
    async def run(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        mission_id, journey = case.request.mission_id, case.journey
        try:
            pack = self.deps.rules.delay_repay(journey.operator_code)
        except NotCovered as exc:
            await self.stop(ctx, mission_id, f"Tempo can't claim from this operator yet ({exc}).")
            return
        delay = claimable_delay(pack, delay=journey.delay_minutes, cancelled=journey.cancelled)
        if delay is None:
            await self.stop(ctx, mission_id, "The train's arrival isn't in the records yet.")
            return
        facts = (
            Fact(key="arrival_delay_min", value=delay, source=journey.source, confidence=1.0),
            Fact(
                key="fare_gbp", value=Decimal(case.request.fare_gbp), source="you", confidence=1.0
            ),
        )
        result = evaluate_delay_repay(
            pack,
            delay_minutes=delay,
            fare_gbp=Decimal(case.request.fare_gbp),
            facts=facts,
            trace_id=f"pt_{mission_id}",
        )
        if isinstance(result, NotEligible):
            await self.stop(ctx, mission_id, f"Nothing to claim: {result.reason}.")
            return
        await self.move(mission_id, S.PLANNED)
        await ctx.send_message(case.with_(trace_json=result.model_dump_json()))


class Court(_Step):
    """Three models check the interpretation. They can say no or ask you, never raise the amount."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("court", deps)

    @handler
    async def run(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        if self.deps.court is None:
            await ctx.send_message(case)
            return
        trace, journey, request = case.trace, case.journey, case.request
        pack = self.deps.rules.by_id(trace.steps[0].rule_id)
        # The jurors read the operator's rule itself and the facts with their sources; never only
        # Tempo's own result line (a model given that and no facts rightly says it can't tell).
        rule_text = (
            rule_in_words(pack)
            if isinstance(pack, DelayRepayPack | FixedAmountPack | DistanceBandPack)
            else trace.steps[0].explanation
        )
        facts = (
            Fact(key="arrival_delay_min", value=journey.delay_minutes or 0,
                 source=journey.source, confidence=1.0),
            Fact(key="cancelled", value="yes" if journey.cancelled else "no",
                 source=journey.source, confidence=1.0),
            Fact(key="operator", value=journey.operator_code,
                 source=journey.source, confidence=1.0),
            Fact(key="journey", confidence=1.0, source="you",
                 value=f"{request.origin_crs} to {request.destination_crs} on "
                       f"{request.travel_date}, departing {request.departure}"),
            Fact(key="fare_gbp", value=Decimal(request.fare_gbp), source="you", confidence=1.0),
        )  # fmt: skip
        question = CaseQuestion(
            mission_id=request.mission_id,
            question="Does this rule cover this journey, as the facts describe it?",
            rule_id=trace.steps[0].rule_id,
            rule_text=rule_text,
            facts=facts,
        )
        decision = await self.deps.court.decide(question)
        final = apply_court(trace, decision)
        voted = case.with_(court_json=decision.model_dump_json())
        if isinstance(final, NotEligible):
            await self.stop(ctx, case.request.mission_id, final.reason)
        elif isinstance(final, NeedsHuman):
            await ctx.send_message(voted.with_(court_note=final.reason))
        else:
            await ctx.send_message(voted.with_(trace_json=final.model_dump_json()))


class Appraise(_Step):
    """The Arbiter: is this worth the person's time, and should Tempo or they do it?"""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("arbiter", deps)

    @handler
    async def run(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        amount = case.trace.amount_gbp
        options = [
            ActionOption(
                id="tempo_claims",
                label="I claim online for you",
                p_success=Decimal("0.9"),
                amount_gbp=amount,
                user_minutes=Decimal(0),
                compute_gbp=Decimal("0.05"),
            ),
            ActionOption(
                id="you_claim",
                label="You claim yourself",
                p_success=Decimal("0.95"),
                amount_gbp=amount,
                user_minutes=DO_IT_YOURSELF_MINUTES,
                compute_gbp=Decimal(0),
            ),
        ]
        decision = choose_action(options, time_value_gbp_h=Decimal(case.request.time_value_gbp_h))
        if decision.chosen is None:
            await self.stop(ctx, case.request.mission_id, decision.explanation)
            return
        await self.move(case.request.mission_id, S.APPRAISED)
        saved = DO_IT_YOURSELF_MINUTES - decision.chosen.user_minutes
        await ctx.send_message(
            case.with_(explanation=decision.explanation, user_minutes_saved=str(saved))
        )
