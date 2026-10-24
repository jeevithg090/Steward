"""Shared parts of the Clawback Rail steps: their dependencies and the safe state-change helper.

Every state change goes through `_Step.move`, which writes a case event and is safe to repeat: a
step re-run after a crash finds the mission already in its target state and carries on.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from agent_framework import Executor, WorkflowContext

from tempo_core.hazard import Hazard
from tempo_core.models import MissionState
from tempo_core.rules import RulePackRegistry
from tempo_core.state import advance
from tempo_missions.clawback_rail.messages import (
    MissionOutcome,
    RailCase,
    SignedApproval,
)
from tempo_missions.court import ConsensusCourt
from tempo_ports.claims import ClaimsPort
from tempo_ports.rail import RailDataPort
from tempo_ports.repo import RepoPort

S = MissionState
DO_IT_YOURSELF_MINUTES = Decimal(20)  # finding the form, the ticket and the times


# The way through a successful mission; anything off it is a side exit (declined, failed safe).
HAPPY_PATH = (
    S.RECEIVED, S.UNDERSTOOD, S.PLANNED, S.APPRAISED, S.AWAITING_CONSENT,
    S.RUNNING, S.COMPLETED, S.VERIFIED,
)  # fmt: skip


def _reached(current: MissionState, target: MissionState) -> bool:
    if current is target:
        return True
    return (
        current in HAPPY_PATH
        and target in HAPPY_PATH
        and HAPPY_PATH.index(current) > HAPPY_PATH.index(target)
    )


def _signed(approval: SignedApproval) -> bool:
    return bool(approval.device_sig)


async def _no_credit(mission_id: str) -> bool:
    return False


@dataclass
class ClawbackDeps:
    repo: RepoPort
    rail: RailDataPort
    rules: RulePackRegistry
    claims: ClaimsPort
    court: ConsensusCourt | None = None
    verify_approval: Callable[[SignedApproval], bool] = _signed  # the Mesh's signature check
    clock: Callable[[], datetime] = field(default=lambda: datetime.now(tz=UTC))
    payment_check_after: timedelta = timedelta(days=7)  # how long to wait before each check
    max_payment_checks: int = 4
    # Rights Decay (missions with clocks): hazard curves by id, bank holidays, the plan's horizon,
    # and whether the automatic credit has shown up (a bill read by vision, or open banking).
    hazards: Mapping[str, Hazard] = field(default_factory=dict)
    holidays: frozenset[date] = frozenset()
    horizon_days: int = 180
    credit_arrived: Callable[[str], Awaitable[bool]] = _no_credit


class _Step(Executor):
    def __init__(self, step_id: str, deps: ClawbackDeps) -> None:
        super().__init__(id=step_id)
        self.deps = deps

    async def move(self, mission_id: str, *path: MissionState, actor: str = "agent") -> None:
        """Walk the mission through `path`, skipping states it has already reached or passed.

        Replaying a step after a crash is a no-op. A finished mission (declined, failed safe or
        verified) never moves again: the transition is illegal, so nothing binding follows.
        """
        mission = await self.deps.repo.get_mission(mission_id)
        for target in path:
            if _reached(mission.state, target):
                continue
            now = max(self.deps.clock(), mission.entered_state_at)
            event = advance(
                mission_id, mission.state, target, entered_at=mission.entered_state_at, now=now
            )
            mission = await self.deps.repo.record_transition(event, actor=actor)

    async def stop(
        self, ctx: WorkflowContext[RailCase, MissionOutcome], mission_id: str, message: str
    ) -> None:
        """Decline in plain words: the mission walks to DECLINED and nothing is sent."""
        await self.move(mission_id, S.UNDERSTOOD, S.PLANNED, S.APPRAISED, S.DECLINED)
        await ctx.yield_output(MissionOutcome(mission_id, S.DECLINED.value, message))
