"""Acting on a missed visit: one signed yes, then wait or act as the plan says (build plan R4).

    consent -> decide (wait: a durable timer, re-plan on waking) -> action -> watchdog -> ledger

The yes covers the plan, not a single moment: Tempo may wait first, and acts on the day the plan
names. Consent is checked again before anything is filed, and STOP ends the wait.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
from decimal import Decimal

from agent_framework import WorkflowContext, handler, response_handler

from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.delays import LONDON
from tempo_core.rights_decay import Plan
from tempo_missions.clawback_ofcom.assess import YOU_COMPLAIN_MINUTES, plan_case, rights_for
from tempo_missions.clawback_ofcom.messages import OfcomCase
from tempo_missions.clawback_rail.base import ClawbackDeps, S, _Step
from tempo_missions.clawback_rail.messages import (
    ConsentRequest,
    MissionOutcome,
    SignedApproval,
    TimerFired,
    TimerRequest,
)

Ctx = WorkflowContext[OfcomCase, MissionOutcome]
WAKE_AT = time(9, 0)  # re-plan at 09:00 London on the plan's day


def _consent_ends(planned: Plan) -> datetime | None:
    """A yes lasts until the last right runs out: after that there is nothing left to do."""
    ends = [r.expires_on for r in planned.rights if r.status != "expired"]
    if not ends or None in ends:
        return None
    last = max(e for e in ends if e is not None)
    return datetime.combine(last, time(23, 59, 59), tzinfo=LONDON).astimezone(UTC)


class Consent(_Step):
    """Nothing binding happens without the person's signed yes (spec §13)."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_consent", deps)

    @handler
    async def ask(self, case: OfcomCase, ctx: Ctx) -> None:
        mission_id = case.request.mission_id
        await self.move(mission_id, S.AWAITING_CONSENT)
        ctx.set_state(f"case:{mission_id}", case)
        summary = f"{case.trace.steps[0].explanation}. {case.plan.explanation}"
        if case.court_note:
            summary += f" Note: {case.court_note}."
        await ctx.request_info(
            request_data=ConsentRequest(
                mission_id=mission_id,
                summary=f"{summary} Shall I handle this for you?",
                amount_gbp=str(case.trace.amount_gbp),
                scopes=("file_claim",),
                proof_trace_json=case.trace.model_dump_json(),
                court_json=case.court_json or "",
                plan_json=case.plan_json or "",
            ),
            response_type=SignedApproval,
        )

    @response_handler
    async def answered(self, request: ConsentRequest, approval: SignedApproval, ctx: Ctx) -> None:
        mission_id = request.mission_id
        case: OfcomCase = ctx.get_state(f"case:{mission_id}")
        if not self.deps.verify_approval(approval):
            await self.move(mission_id, S.FAILED_SAFE, actor="system")
            message = "I couldn't verify that approval, so I did nothing."
            await ctx.yield_output(MissionOutcome(mission_id, S.FAILED_SAFE.value, message))
            return
        kind = ConsentKind.GRANT if approval.approved else ConsentKind.REVOKE
        ends = _consent_ends(case.plan) if approval.approved else None
        for scope in approval.scopes or request.scopes:
            await self.deps.repo.append_consent(ConsentEvent(
                mission_id=mission_id, scope=scope, kind=kind, at=self.deps.clock(),
                expires_at=ends, limits={k: Decimal(v) for k, v in approval.limits},
                device_sig=approval.device_sig,
            ))  # fmt: skip
        if not approval.approved:
            await self.move(mission_id, S.DECLINED, actor="user")
            message = "Stopped: you said no. Nothing was sent."
            await ctx.yield_output(MissionOutcome(mission_id, S.DECLINED.value, message))
            return
        await self.move(mission_id, S.RUNNING, actor="user")
        await ctx.send_message(case)


class Decide(_Step):
    """Wait while waiting pays; act on the day the plan names. Every wake re-plans from scratch."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_decide", deps)

    @handler
    async def decide(self, case: OfcomCase, ctx: Ctx) -> None:
        await self._next(case, ctx)

    async def _next(self, case: OfcomCase, ctx: Ctx) -> None:
        planned = plan_case(case, self.deps)
        case = case.with_(plan_json=planned.model_dump_json())
        mission_id = case.request.mission_id
        if planned.action_today == "wait" and case.replans < self.deps.horizon_days:
            await self.move(mission_id, S.WAITING)
            ctx.set_state(f"decide:{mission_id}", case)
            day = planned.next_decision_on or planned.horizon
            wake = datetime.combine(day, WAKE_AT, tzinfo=LONDON).astimezone(UTC)
            await ctx.request_info(
                request_data=TimerRequest(
                    mission_id=mission_id, wake_at=wake.isoformat(), reason="re-plan",
                    attempt=case.replans + 1, plan_json=case.plan_json or "",
                ),
                response_type=TimerFired,
            )  # fmt: skip
        elif planned.action_today in ("wait", "drop"):
            await self.move(mission_id, S.COMPLETED, actor="system")
            await ctx.yield_output(MissionOutcome(
                mission_id, S.COMPLETED.value, planned.explanation,
                plan_json=case.plan_json or "",
            ))  # fmt: skip
        else:
            await ctx.send_message(case.with_(chosen=planned.action_today, way=planned.way))

    @response_handler
    async def woke(self, timer: TimerRequest, fired: TimerFired, ctx: Ctx) -> None:
        mission_id = timer.mission_id
        case: OfcomCase = ctx.get_state(f"decide:{mission_id}")
        case = case.with_(replans=timer.attempt)
        await self.move(mission_id, S.RUNNING, actor="system")
        if await self.deps.credit_arrived(mission_id):  # paid on its own: nobody had to call
            await self.move(mission_id, S.COMPLETED, S.VERIFIED, actor="system")
            paid = case.with_(paid_amount_gbp=str(case.trace.amount_gbp), paid_on_its_own=True)
            await ctx.send_message(paid)
            return
        await self._next(case, ctx)


class Action(_Step):
    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_action", deps)

    @handler
    async def run(self, case: OfcomCase, ctx: Ctx) -> None:
        if case.paid_on_its_own:
            await ctx.send_message(case)
            return
        mission_id, trace = case.request.mission_id, case.trace
        consent = effective_consent(await self.deps.repo.consents(mission_id), self.deps.clock())
        if not consent.allows("file_claim"):  # checked again here, not only at the prompt
            await self.move(mission_id, S.FAILED_SAFE, actor="system")
            message = "Your consent has ended, so I stopped."
            await ctx.yield_output(MissionOutcome(mission_id, S.FAILED_SAFE.value, message))
            return
        receipt = await self.deps.claims.file_claim(
            operator=case.request.operator,
            mission_id=mission_id,
            proof_trace_id=trace.id,
            amount_gbp=trace.amount_gbp,
            idempotency_key=f"{mission_id}:{trace.id}:{case.chosen}",
        )
        today = self.deps.clock().astimezone(LONDON).date()
        way = next(
            (w for r in rights_for(case, self.deps) for w in r.ways if w.id == case.way), None
        )
        saved = YOU_COMPLAIN_MINUTES - (way.user_minutes if way else YOU_COMPLAIN_MINUTES)
        complained = case.chosen == "ofcom.complaint"
        await ctx.send_message(case.with_(
            receipt_json=receipt.model_dump_json(), minutes_saved=str(saved),
            happened=(*case.happened, "complaint_sent") if complained else case.happened,
            complaint_date=today.isoformat() if complained else case.complaint_date,
        ))  # fmt: skip
