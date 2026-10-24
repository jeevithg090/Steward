"""The payment Watchdog: wait for the money without holding anything in memory (spec §16.5).

The workflow asks for a timer with `request_info(TimerRequest)` and sleeps in its checkpoint.
The Gateway's scheduler answers with `TimerFired` when the time comes, even after a restart or a
deploy. Wake times are UTC instants, so the repeated hour tonight can't fire a check twice.
"""

from __future__ import annotations

from datetime import UTC

from agent_framework import WorkflowContext, handler, response_handler

from tempo_missions.clawback_rail.base import ClawbackDeps, S, _Step
from tempo_missions.clawback_rail.messages import MissionOutcome, RailCase, TimerFired, TimerRequest


class PaymentWatchdog(_Step):
    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("watchdog", deps)

    @handler
    async def watch(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        await self._arm(case, ctx, attempt=1)

    async def _arm(
        self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome], *, attempt: int
    ) -> None:
        mission_id = case.request.mission_id
        await self.move(mission_id, S.WAITING)
        ctx.set_state(f"watch:{mission_id}", case)
        wake_at = (self.deps.clock() + self.deps.payment_check_after).astimezone(UTC)
        await ctx.request_info(
            request_data=TimerRequest(
                mission_id=mission_id,
                wake_at=wake_at.isoformat(),
                reason=f"check {case.journey.operator_code} has paid",
                attempt=attempt,
            ),
            response_type=TimerFired,
        )

    @response_handler
    async def fired(
        self, timer: TimerRequest, fired: TimerFired, ctx: WorkflowContext[RailCase, MissionOutcome]
    ) -> None:
        mission_id = timer.mission_id
        case: RailCase = ctx.get_state(f"watch:{mission_id}").with_(payment_checks=timer.attempt)
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
