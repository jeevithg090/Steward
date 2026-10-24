"""Acting on a claim: ask for consent, file it once, and count the time saved."""

from __future__ import annotations

from decimal import Decimal

from agent_framework import WorkflowContext, handler, response_handler

from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.ledger import LedgerEntry
from tempo_missions.clawback_rail.base import ClawbackDeps, S, _Step
from tempo_missions.clawback_rail.messages import (
    ConsentRequest,
    MissionOutcome,
    RailCase,
    SignedApproval,
)


class Consent(_Step):
    """Nothing binding happens without the person's signed yes (spec §13)."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("consent", deps)

    @handler
    async def ask(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        mission_id = case.request.mission_id
        await self.move(mission_id, S.AWAITING_CONSENT)
        ctx.set_state(f"case:{mission_id}", case)
        summary = f"{case.trace.steps[0].explanation}. {case.explanation}"
        if case.court_note:
            summary += f" Note: {case.court_note}."
        await ctx.request_info(
            request_data=ConsentRequest(
                mission_id=mission_id,
                summary=f"{summary} Shall I claim £{case.trace.amount_gbp} for you?",
                amount_gbp=str(case.trace.amount_gbp),
                scopes=("file_claim",),
                proof_trace_json=case.trace.model_dump_json(),
                court_json=case.court_json or "",
            ),
            response_type=SignedApproval,
        )

    @response_handler
    async def answered(
        self,
        request: ConsentRequest,
        approval: SignedApproval,
        ctx: WorkflowContext[RailCase, MissionOutcome],
    ) -> None:
        mission_id = request.mission_id
        if not self.deps.verify_approval(approval):
            await self.move(mission_id, S.FAILED_SAFE, actor="system")
            await ctx.yield_output(
                MissionOutcome(
                    mission_id,
                    S.FAILED_SAFE.value,
                    "I couldn't verify that approval, so I did nothing.",
                )
            )
            return
        kind = ConsentKind.GRANT if approval.approved else ConsentKind.REVOKE
        for scope in approval.scopes or request.scopes:
            await self.deps.repo.append_consent(
                ConsentEvent(
                    mission_id=mission_id,
                    scope=scope,
                    kind=kind,
                    at=self.deps.clock(),
                    limits={k: Decimal(v) for k, v in approval.limits},
                    device_sig=approval.device_sig,
                )
            )
        if not approval.approved:
            await self.move(mission_id, S.DECLINED, actor="user")
            await ctx.yield_output(
                MissionOutcome(
                    mission_id, S.DECLINED.value, "Stopped: you said no. Nothing was sent."
                )
            )
            return
        await self.move(mission_id, S.RUNNING, actor="user")
        await ctx.send_message(ctx.get_state(f"case:{mission_id}"))


class Action(_Step):
    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("action", deps)

    @handler
    async def run(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        mission_id, trace = case.request.mission_id, case.trace
        consent = effective_consent(await self.deps.repo.consents(mission_id), self.deps.clock())
        if not consent.allows("file_claim"):  # checked again here, not only at the prompt
            await self.move(mission_id, S.FAILED_SAFE, actor="system")
            await ctx.yield_output(
                MissionOutcome(
                    mission_id, S.FAILED_SAFE.value, "Your consent has ended, so I stopped."
                )
            )
            return
        receipt = await self.deps.claims.file_claim(
            operator=case.journey.operator_code,
            mission_id=mission_id,
            proof_trace_id=trace.id,
            amount_gbp=trace.amount_gbp,
            idempotency_key=f"{mission_id}:{trace.id}",
        )
        await ctx.send_message(case.with_(receipt_json=receipt.model_dump_json()))


class Ledger(_Step):
    """Counts the minutes Tempo saved, and the pounds only once the money has arrived."""

    def __init__(self, deps: ClawbackDeps) -> None:
        super().__init__("ledger", deps)

    @handler
    async def run(self, case: RailCase, ctx: WorkflowContext[RailCase, MissionOutcome]) -> None:
        mission_id, receipt, operator = (
            case.request.mission_id,
            case.receipt,
            case.journey.operator_code,
        )
        await self.deps.repo.add_ledger_entry(
            LedgerEntry(
                mission_id=mission_id,
                at=self.deps.clock(),
                minutes_returned=Decimal(case.user_minutes_saved),
                key=f"{mission_id}:claimed",
            ),
            user_id=case.request.user_id,
            company=operator,
        )
        simulated = " (a simulated company)" if receipt.simulated else ""
        if case.paid_amount_gbp is None:
            message = (
                f"I've claimed £{receipt.amount_gbp} (reference {receipt.reference}), but "
                f"{operator}{simulated} hasn't paid after {case.payment_checks} checks. "
                "I'll chase it."
            )
            state = S.COMPLETED
        else:
            await self.deps.repo.add_ledger_entry(
                LedgerEntry(
                    mission_id=mission_id,
                    at=self.deps.clock(),
                    gbp_recovered=Decimal(case.paid_amount_gbp),
                    key=f"{mission_id}:paid",
                ),
                user_id=case.request.user_id,
                company=operator,
            )
            message = (
                f"{operator}{simulated} has paid you £{case.paid_amount_gbp} "
                f"(reference {receipt.reference}). That's {case.user_minutes_saved} minutes "
                "of your time back."
            )
            state = S.VERIFIED
        await ctx.yield_output(
            MissionOutcome(
                mission_id,
                state.value,
                message,
                amount_gbp=str(receipt.amount_gbp),
                reference=receipt.reference,
                proof_trace_id=case.trace.id,
            )
        )
