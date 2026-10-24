"""MissionService: starts missions, routes answers back in, and stops them on request.

Each mission has its own checkpoint folder, so "the latest checkpoint" always means this
mission's. A lock per mission stops two deliveries of the same answer from racing.
"""

from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from tempo_core.consent import ConsentEvent, ConsentKind
from tempo_core.errors import TempoError
from tempo_core.models import Mission, MissionState
from tempo_core.state import advance, allowed_next
from tempo_gateway.events import EventBus
from tempo_gateway.security import phone_hash
from tempo_missions.clawback_rail import (
    ClaimRequest,
    ClawbackDeps,
    RunResult,
    SignedApproval,
    build_clawback_workflow,
    checkpoint_storage,
    resume,
    start,
)

SKILL = "clawback.uk-rail-delay-repay"
BINDING_SCOPES = ("file_claim",)


class UnknownRequest(TempoError):
    """No mission is waiting for an answer with this request id."""


class StartMission(BaseModel):
    user_id: str
    display_name: str = Field(max_length=80)
    phone: str | None = None  # for SMS updates; only its hash is kept
    origin_crs: str = Field(pattern=r"^[A-Za-z]{3}$")
    destination_crs: str = Field(pattern=r"^[A-Za-z]{3}$")
    travel_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    departure: str = Field(pattern=r"^\d{2}:?\d{2}$")
    fare_gbp: Decimal = Field(ge=0)
    time_value_gbp_h: Decimal = Field(default=Decimal("18"), ge=0)


class ConsentAsk(BaseModel):
    request_id: str
    summary: str
    amount_gbp: str


class MissionView(BaseModel):
    id: str
    state: MissionState
    message: str | None = None
    ask: ConsentAsk | None = None
    outcome: dict[str, Any] | None = None
    timeline: list[dict[str, Any]] = []


class MissionService:
    def __init__(self, deps: ClawbackDeps, checkpoints: Path, bus: EventBus) -> None:
        self.deps = deps
        self._checkpoints = checkpoints
        self._bus = bus
        self._asks: dict[str, tuple[str, ConsentAsk]] = {}  # request id -> (mission, ask)
        self._outcomes: dict[str, dict[str, Any]] = {}
        self._by_phone: dict[str, list[str]] = defaultdict(list)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def start(self, request: StartMission) -> MissionView:
        mission_id = f"m_{uuid.uuid4().hex[:12]}"
        now = self.deps.clock()
        await self.deps.repo.upsert_user(
            request.user_id,
            display_name=request.display_name,
            time_value_gbp_h=request.time_value_gbp_h,
        )
        await self.deps.repo.create_mission(
            Mission(
                id=mission_id,
                user_id=request.user_id,
                skill_id=SKILL,
                goal=f"Delay Repay for the {request.departure} on {request.travel_date}",
                entered_state_at=now,
            )
        )
        if request.phone:
            self._by_phone[phone_hash(request.phone)].append(mission_id)
        claim = ClaimRequest(
            mission_id=mission_id,
            user_id=request.user_id,
            display_name=request.display_name,
            origin_crs=request.origin_crs.upper(),
            destination_crs=request.destination_crs.upper(),
            travel_date=request.travel_date,
            departure=request.departure,
            fare_gbp=str(request.fare_gbp),
            time_value_gbp_h=str(request.time_value_gbp_h),
        )
        async with self._locks[mission_id]:
            self._remember(mission_id, await start(self._workflow(mission_id), claim))
        return await self.view(mission_id)

    async def answer(self, request_id: str, approval: SignedApproval) -> MissionView:
        """Resume the waiting mission. A second delivery of the same answer changes nothing."""
        if request_id not in self._asks:
            raise UnknownRequest(request_id)
        mission_id = self._asks[request_id][0]
        async with self._locks[mission_id]:
            if request_id not in self._asks:  # answered while we waited for the lock
                return await self.view(mission_id)
            del self._asks[request_id]
            storage = checkpoint_storage(self._checkpoints / mission_id)
            self._remember(
                mission_id,
                await resume(self._workflow(mission_id), storage, {request_id: approval}),
            )
        return await self.view(mission_id)

    async def stop(self, mission_id: str, *, device_sig: str) -> MissionView:
        """The kill switch (spec §7.4): revoke every scope and stop wherever the mission is."""
        waiting = [rid for rid, (mid, _) in self._asks.items() if mid == mission_id]
        if waiting:
            no = SignedApproval(approved=False, scopes=BINDING_SCOPES, device_sig=device_sig)
            return await self.answer(waiting[0], no)
        async with self._locks[mission_id]:
            for scope in BINDING_SCOPES:
                await self.deps.repo.append_consent(
                    ConsentEvent(
                        mission_id=mission_id,
                        scope=scope,
                        kind=ConsentKind.REVOKE,
                        at=self.deps.clock(),
                        device_sig=device_sig,
                    )
                )
            mission = await self.deps.repo.get_mission(mission_id)
            if MissionState.FAILED_SAFE in allowed_next(mission.state):
                now = max(self.deps.clock(), mission.entered_state_at)
                await self.deps.repo.record_transition(
                    advance(
                        mission_id,
                        mission.state,
                        MissionState.FAILED_SAFE,
                        entered_at=mission.entered_state_at,
                        now=now,
                    ),
                    actor="user",
                )
        return await self.view(mission_id)

    async def recover(self) -> list[str]:
        """After a restart: re-emit the pending question of every mission still waiting for one.

        The question lives in the mission's checkpoint, so nothing the person was asked is lost.
        Returns the ids of the missions that are waiting again.
        """
        waiting = []
        for folder in sorted(p for p in self._checkpoints.glob("m_*") if p.is_dir()):
            mission = await self.deps.repo.get_mission(folder.name)
            if mission.state is not MissionState.AWAITING_CONSENT:
                continue
            async with self._locks[mission.id]:
                storage = checkpoint_storage(folder)
                self._remember(mission.id, await resume(self._workflow(mission.id), storage))
            waiting.append(mission.id)
        return waiting

    def remember_phone(self, mission_id: str, phone: str) -> None:
        self._by_phone[phone_hash(phone)].append(mission_id)

    def missions_for_phone(self, phone: str) -> list[str]:
        return list(self._by_phone.get(phone_hash(phone), []))

    def pending_for(self, mission_id: str) -> str | None:
        return next((rid for rid, (mid, _) in self._asks.items() if mid == mission_id), None)

    async def view(self, mission_id: str) -> MissionView:
        mission = await self.deps.repo.get_mission(mission_id)
        ask = next((a for mid, a in self._asks.values() if mid == mission_id), None)
        outcome = self._outcomes.get(mission_id)
        timeline = [
            {"to": e.to_state.value, "at": e.at.isoformat(), "latency_ms": e.latency_ms}
            for e in await self.deps.repo.case_events(mission_id)
        ]
        message = outcome["message"] if outcome else (ask.summary if ask else None)
        return MissionView(
            id=mission_id,
            state=mission.state,
            message=message,
            ask=ask,
            outcome=outcome,
            timeline=timeline,
        )

    def _workflow(self, mission_id: str) -> Any:
        return build_clawback_workflow(
            self.deps, checkpoint_storage(self._checkpoints / mission_id)
        )

    def _remember(self, mission_id: str, result: RunResult) -> None:
        for request_id, ask in result.pending:
            self._asks[request_id] = (
                mission_id,
                ConsentAsk(request_id=request_id, summary=ask.summary, amount_gbp=ask.amount_gbp),
            )
            self._bus.publish(
                {"type": "consent_requested", "mission_id": mission_id, "request_id": request_id}
            )
        if result.outcome is not None:
            self._outcomes[mission_id] = {
                "state": result.outcome.state,
                "message": result.outcome.message,
                "amount_gbp": result.outcome.amount_gbp,
                "reference": result.outcome.reference,
            }
            self._bus.publish(
                {"type": "outcome", "mission_id": mission_id, **self._outcomes[mission_id]}
            )


def utc_now() -> datetime:
    return datetime.now(tz=UTC)
