"""After the complaint: wait for the money with durable timers, then count what came back.

The same shape as the rail Watchdog (spec §16.5), for the Ofcom case. If the company still hasn't
paid, Tempo re-plans: the complaint has started the ombudsman's 8-week clock, so the person hears
the day that route opens.
"""

from __future__ import annotations

from datetime import UTC
from decimal import Decimal

from agent_framework import WorkflowContext, handler, response_handler

from tempo_core.ledger import LedgerEntry
from tempo_missions.clawback_ofcom.assess import plan_case
from tempo_missions.clawback_ofcom.messages import OfcomCase
from tempo_missions.clawback_rail.base import ClawbackDeps, S, _Step
from tempo_missions.clawback_rail.messages import MissionOutcome, TimerFired, TimerRequest

Ctx = WorkflowContext[OfcomCase, MissionOutcome]


class PaymentWatchdog(_Step):
    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_watchdog", deps)

    @handler
    async def watch(self, case: OfcomCase, ctx: Ctx) -> None:
        if case.paid_on_its_own:
            await ctx.send_message(case)
            return
        await self._arm(case, ctx, attempt=1)

    async def _arm(self, case: OfcomCase, ctx: Ctx, *, attempt: int) -> None:
        mission_id = case.request.mission_id
        await self.move(mission_id, S.WAITING)
        ctx.set_state(f"watch:{mission_id}", case)
        wake_at = (self.deps.clock() + self.deps.payment_check_after).astimezone(UTC)
        await ctx.request_info(
            request_data=TimerRequest(
                mission_id=mission_id, wake_at=wake_at.isoformat(),
                reason=f"check {case.request.operator} has paid", attempt=attempt,
                plan_json=case.plan_json or "",
            ),
            response_type=TimerFired,
        )  # fmt: skip

    @response_handler
    async def fired(self, timer: TimerRequest, fired: TimerFired, ctx: Ctx) -> None:
        mission_id = timer.mission_id
        case: OfcomCase = ctx.get_state(f"watch:{mission_id}").with_(payment_checks=timer.attempt)
        await self.move(mission_id, S.RUNNING, actor="system")
        status = await self.deps.claims.payment_status(case.receipt.reference)
        if status.paid and status.amount_gbp is not None:
            await self.move(mission_id, S.COMPLETED, S.VERIFIED, actor="system")
            await ctx.send_message(case.with_(paid_amount_gbp=str(status.amount_gbp)))
        elif timer.attempt < self.deps.max_payment_checks:
            await self._arm(case, ctx, attempt=timer.attempt + 1)
        else:
            await self.move(mission_id, S.COMPLETED, actor="system")
            await ctx.send_message(case)


class Ledger(_Step):
    """Counts the minutes Tempo saved, and the pounds only once the money has arrived."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ofcom_ledger", deps)

    @handler
    async def run(self, case: OfcomCase, ctx: Ctx) -> None:
        request, who = case.request, case.request.operator
        if case.paid_amount_gbp is not None:
            await self._paid(case)
        if case.paid_on_its_own:
            message = (
                f"{who} paid the £{case.paid_amount_gbp} on its own, so nobody had to call. "
                "I waited, and it was worth it."
            )
            state, reference = S.VERIFIED, None
        else:
            await self.deps.repo.add_ledger_entry(
                LedgerEntry(
                    mission_id=request.mission_id, at=self.deps.clock(),
                    minutes_returned=Decimal(case.minutes_saved),
                    key=f"{request.mission_id}:claimed",
                ),
                user_id=request.user_id, company=who,
            )  # fmt: skip
            receipt, reference = case.receipt, case.receipt.reference
            simulated = " (a simulated company)" if receipt.simulated else ""
            if case.paid_amount_gbp is not None:
                message = (
                    f"{who}{simulated} has paid you £{case.paid_amount_gbp} (reference "
                    f"{reference}). That's {case.minutes_saved} minutes of your time back."
                )
                state = S.VERIFIED
            else:
                message, state = self._unpaid(case, f"{who}{simulated}"), S.COMPLETED
        await ctx.yield_output(MissionOutcome(
            request.mission_id, state.value, message, amount_gbp=str(case.trace.amount_gbp),
            reference=reference, proof_trace_id=case.trace.id, plan_json=case.plan_json or "",
        ))  # fmt: skip

    async def _paid(self, case: OfcomCase) -> None:
        request = case.request
        await self.deps.repo.add_ledger_entry(
            LedgerEntry(
                mission_id=request.mission_id, at=self.deps.clock(),
                gbp_recovered=Decimal(case.paid_amount_gbp or "0"),
                key=f"{request.mission_id}:paid",
            ),
            user_id=request.user_id, company=request.operator,
        )  # fmt: skip

    def _unpaid(self, case: OfcomCase, who: str) -> str:
        """Still not paid after the complaint: say when the next route opens."""
        later = plan_case(case, self.deps)
        ombudsman = next((r for r in later.rights if r.id == "telecoms.ombudsman"), None)
        opens = ombudsman.opens_on if ombudsman else None
        then = f" You can go to the ombudsman from {opens:%-d %B}." if opens else ""
        return (
            f"I complained (reference {case.receipt.reference}), but {who} hasn't paid after "
            f"{case.payment_checks} checks.{then} I'll remind you."
        )
