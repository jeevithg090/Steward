"""Assessing a missed engineer visit: read the facts, apply Ofcom's rule, check the reading, then
plan when to act (build plan R4).

The agent still does the reading (typed facts tonight; a photo of the card or bill with vision in
R8). The Rights Engine still sets the amount, and the Court may only say no. Rights Decay adds
*when*: the automatic credit may still come, the complaint only opens after the payment window,
and the ombudsman only after the complaint has had its 8 weeks.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from agent_framework import WorkflowContext, handler

from tempo_core.arbiter import ActionOption
from tempo_core.delays import LONDON
from tempo_core.errors import NotCovered
from tempo_core.hazard import Hazard
from tempo_core.models import Fact
from tempo_core.rights_decay import Plan, Right, apply_clocks, plan
from tempo_core.rules import FixedAmountPack, NotEligible, evaluate_missed_appointment
from tempo_missions.clawback_ofcom.messages import OfcomCase, OfcomRequest
from tempo_missions.clawback_rail.base import ClawbackDeps, S, _Step
from tempo_missions.clawback_rail.messages import MissionOutcome
from tempo_missions.court import NeedsHuman, apply_court
from tempo_ports.court import CaseQuestion

PACK_ID = "ofcom.missed-appointment"
TRIGGERS = ("missed_appointment", "complaint_sent", "final_response")
YOU_COMPLAIN_MINUTES = Decimal(25)  # (assumption) find the number, wait, explain, get a reference

Ctx = WorkflowContext[OfcomCase, MissionOutcome]


def rights_for(case: OfcomCase, deps: ClawbackDeps) -> tuple[Right, ...]:
    """What Margaret can do, with the clocks that gate each option."""
    owed, who = case.trace.amount_gbp, case.request.operator
    call = ActionOption(
        id="tempo_calls", label=f"I call {who} for you", p_success=Decimal("0.85"),
        amount_gbp=owed, user_minutes=Decimal(0), compute_gbp=Decimal("0.20"),
    )  # fmt: skip
    yourself = ActionOption(
        id="you_complain", label="You complain yourself", p_success=Decimal("0.9"),
        amount_gbp=owed, user_minutes=YOU_COMPLAIN_MINUTES, compute_gbp=Decimal(0),
    )  # fmt: skip
    refer = ActionOption(
        id="tempo_refers", label="I send it to the ombudsman for you", p_success=Decimal("0.6"),
        amount_gbp=owed, user_minutes=Decimal(0), compute_gbp=Decimal("0.10"),
    )  # fmt: skip
    rights = [
        Right(id="ofcom.complaint", label=f"Complain to {who}", ways=(call, yourself)),
        Right(id="telecoms.ombudsman", label="Go to the ombudsman", ways=(refer,)),
    ]
    clocks = [c for trigger in TRIGGERS for c in deps.rules.clocks(trigger)]
    starts = {"event_date": case.missed_on}
    if case.complaint_date:
        starts["complaint_date"] = date.fromisoformat(case.complaint_date)
    return apply_clocks(rights, clocks, starts, deps.holidays)


def plan_case(case: OfcomCase, deps: ClawbackDeps) -> Plan:
    """Re-plan from today: the same inputs always give the same plan."""
    return plan(
        rights_for(case, deps),
        hazard=deps.hazards.get(case.request.hazard_id, Hazard.none()),
        started_on=case.missed_on,
        today=max(deps.clock().astimezone(LONDON).date(), case.missed_on),
        time_value_gbp_h=Decimal(case.request.time_value_gbp_h),
        resolved_value_gbp=case.trace.amount_gbp,
        happened=frozenset(case.happened),
        horizon_days=deps.horizon_days,
    )


class Intake(_Step):
    """Tonight the facts arrive typed (Mission Control or the voice agent read them back)."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_intake", deps)

    @handler
    async def run(self, request: OfcomRequest, ctx: Ctx) -> None:
        facts = [
            Fact(key="event_date", value=request.event_date, source=request.source, confidence=1.0)
        ]
        if request.notice_hours is not None:
            facts.append(Fact(
                key="notice_hours", value=Decimal(request.notice_hours), source="you",
                confidence=1.0,
            ))  # fmt: skip
        await self.move(request.mission_id, S.UNDERSTOOD)
        payload = "[" + ",".join(f.model_dump_json() for f in facts) + "]"
        await ctx.send_message(OfcomCase(request=request, facts_json=payload))


class Rights(_Step):
    """The Rights Engine decides the amount; nothing later can change it."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_rights", deps)

    @handler
    async def run(self, case: OfcomCase, ctx: Ctx) -> None:
        pack = self.deps.rules.by_id(PACK_ID)
        if not isinstance(pack, FixedAmountPack):  # a mis-filed pack must fail loudly, not pay
            raise NotCovered(f"{PACK_ID} isn't a fixed-amount pack")
        notice = case.request.notice_hours
        result = evaluate_missed_appointment(
            pack,
            notice_hours=Decimal(notice) if notice is not None else None,
            facts=(Fact(key="event_date", value=case.request.event_date,
                        source=case.request.source, confidence=1.0),),
            trace_id=f"pt_{case.request.mission_id}",
        )  # fmt: skip
        if isinstance(result, NotEligible):
            await self.stop_case(ctx, case, f"Nothing to claim: {result.reason}.")
            return
        await self.move(case.request.mission_id, S.PLANNED)
        await ctx.send_message(case.with_(trace_json=result.model_dump_json()))

    async def stop_case(self, ctx: Ctx, case: OfcomCase, message: str) -> None:
        mission_id = case.request.mission_id
        await self.move(mission_id, S.UNDERSTOOD, S.PLANNED, S.APPRAISED, S.DECLINED)
        await ctx.yield_output(MissionOutcome(mission_id, S.DECLINED.value, message))


class Court(_Step):
    """Three models check the reading. They can say no or ask you, never raise the amount."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_court", deps)

    @handler
    async def run(self, case: OfcomCase, ctx: Ctx) -> None:
        if self.deps.court is None:
            await ctx.send_message(case)
            return
        trace = case.trace
        question = CaseQuestion(
            mission_id=case.request.mission_id,
            question="Does Ofcom's automatic compensation cover this missed visit, as described?",
            rule_id=trace.steps[0].rule_id,
            rule_text=trace.steps[0].explanation,
        )
        decision = await self.deps.court.decide(question)
        final = apply_court(trace, decision)
        voted = case.with_(court_json=decision.model_dump_json())
        if isinstance(final, NotEligible):
            mission_id = case.request.mission_id
            await self.move(mission_id, S.APPRAISED, S.DECLINED)
            await ctx.yield_output(MissionOutcome(mission_id, S.DECLINED.value, final.reason))
        elif isinstance(final, NeedsHuman):
            await ctx.send_message(voted.with_(court_note=final.reason))
        else:
            await ctx.send_message(voted.with_(trace_json=final.model_dump_json()))


class Appraise(_Step):
    """The Arbiter picks the best way; Rights Decay picks the day."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_plan", deps)

    @handler
    async def run(self, case: OfcomCase, ctx: Ctx) -> None:
        planned = plan_case(case, self.deps)
        mission_id = case.request.mission_id
        if planned.action_today == "drop" and planned.next_decision_on == planned.today:
            await self.move(mission_id, S.APPRAISED, S.DECLINED)
            outcome = MissionOutcome(
                mission_id, S.DECLINED.value, planned.explanation,
                plan_json=planned.model_dump_json(),
            )  # fmt: skip
            await ctx.yield_output(outcome)
            return
        await self.move(mission_id, S.APPRAISED)
        await ctx.send_message(case.with_(plan_json=planned.model_dump_json()))
