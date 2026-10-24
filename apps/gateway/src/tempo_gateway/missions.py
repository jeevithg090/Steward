"""MissionService: starts missions, routes answers back in, and stops them on request.

Each mission has its own checkpoint folder, so "the latest checkpoint" always means this
mission's. A lock per mission stops two deliveries of the same answer from racing.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import structlog
from opentelemetry import trace
from pydantic import BaseModel, Field

from tempo_adapters.telemetry import current_trace_id, mission_context
from tempo_core.consent import ConsentEvent, ConsentKind
from tempo_core.delays import LONDON
from tempo_core.errors import MissionNotFound, NotCovered, TempoError
from tempo_core.models import Mission, MissionState
from tempo_core.state import advance, allowed_next
from tempo_gateway.engines import ENGINES, OFCOM, RAIL, Engine
from tempo_gateway.events import EventBus
from tempo_gateway.security import phone_hash
from tempo_missions.clawback_ofcom import OfcomRequest
from tempo_missions.clawback_rail import (
    ClaimRequest,
    ClawbackDeps,
    RunResult,
    SignedApproval,
    TimerFired,
)

SKILL = RAIL
_tracer = trace.get_tracer("tempo.gateway")
log = structlog.get_logger(__name__)
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
    profile_id: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,40}$")  # a Tempo Profile


class StartOfcom(BaseModel):
    """A missed engineer visit (Rights Decay demo): what was read off the card, or said."""

    user_id: str
    display_name: str = Field(max_length=80)
    phone: str | None = None
    operator: str = Field(min_length=1, max_length=80)  # the provider, e.g. "Broadbandly"
    event_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")  # the day of the missed visit
    notice_hours: Decimal | None = Field(default=None, ge=0)  # None: nobody came, nobody called
    account_ref: str | None = Field(default=None, max_length=40)
    time_value_gbp_h: Decimal = Field(default=Decimal("18"), ge=0)
    hazard_id: str = "nyc311.hpd.all"
    source: str = Field(default="you", max_length=120)  # where the date came from
    profile_id: str | None = Field(default=None, pattern=r"^[a-z0-9-]{2,40}$")  # a Tempo Profile


class ConsentAsk(BaseModel):
    request_id: str
    summary: str
    amount_gbp: str
    proof_trace: dict[str, Any] | None = None
    court: dict[str, Any] | None = None  # the Consensus Court's votes, if it sat


class MissionView(BaseModel):
    id: str
    user_id: str | None = None
    state: MissionState
    message: str | None = None
    ask: ConsentAsk | None = None
    outcome: dict[str, Any] | None = None
    timeline: list[dict[str, Any]] = []
    trace_url: str | None = None  # the latest trace for this mission (Langfuse)
    court: dict[str, Any] | None = None  # how the Consensus Court voted, if it sat
    skill_id: str | None = None
    plan: dict[str, Any] | None = None  # Rights Decay: when to act, and why
    mandate: dict[str, Any] | None = None  # Agent Passport: the newest mandate for this mission
    profile_id: str | None = None  # the Tempo Profile this mission runs under, if one was chosen


class MissionService:
    def __init__(
        self,
        deps: ClawbackDeps,
        checkpoints: Path,
        bus: EventBus,
        *,
        trace_link: Callable[[str | None], str | None] = lambda _: None,
    ) -> None:
        self.deps = deps
        self._trace_link = trace_link
        self._traces: dict[str, str | None] = {}
        self._courts: dict[str, dict[str, Any]] = {}
        self._checkpoints = checkpoints
        self._bus = bus
        self._asks: dict[str, tuple[str, ConsentAsk]] = {}  # request id -> (mission, ask)
        self._timers: dict[str, tuple[str, datetime]] = {}  # request id -> (mission, wake at UTC)
        self._outcomes: dict[str, dict[str, Any]] = {}
        self._by_phone: dict[str, list[str]] = defaultdict(list)
        self._user_by_phone: dict[str, str] = {}
        self._names: dict[str, str] = {}  # user id -> what they like to be called (voice calls)
        self._companies: dict[str, str] = {}  # mission id -> the company, from its rule pack
        self._skills: dict[str, str] = {}  # mission id -> skill id (which workflow runs it)
        self._profiles: dict[str, str] = {}  # mission id -> the Tempo Profile it runs under
        self._plans: dict[str, dict[str, Any]] = {}  # mission id -> its latest Rights Decay plan
        self._reasons: dict[str, str] = {}  # mission id -> why its current timer is set
        self.credited: set[str] = set()  # demo: missions whose automatic credit has arrived
        self._matters: dict[str, dict[str, str | None]] = defaultdict(dict)  # for mandates
        # Agent Passport hooks (set by create_app when mandates are on): STOP revokes them all.
        self.on_stop: Callable[[str, str], Awaitable[object]] | None = None
        self.mandate_summary: Callable[[str], dict[str, Any] | None] | None = None
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self.mission_ids: list[str] = []  # newest last

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
        self.mission_ids.append(mission_id)
        self._skills[mission_id] = SKILL
        if request.profile_id:
            self._profiles[mission_id] = request.profile_id
        self._names[request.user_id] = request.display_name
        if request.phone:
            self._by_phone[phone_hash(request.phone)].append(mission_id)
            self._user_by_phone[phone_hash(request.phone)] = request.user_id
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
            with self._traced("start", mission_id):
                result = await self._engine(mission_id).start(self._workflow(mission_id), claim)
                self._remember(mission_id, result)
        return await self.view(mission_id)

    async def start_ofcom(self, request: StartOfcom) -> MissionView:
        """A missed engineer visit, planned with Rights Decay (build plan R5)."""
        mission_id = f"m_{uuid.uuid4().hex[:12]}"
        await self.deps.repo.upsert_user(
            request.user_id, display_name=request.display_name,
            time_value_gbp_h=request.time_value_gbp_h,
        )  # fmt: skip
        await self.deps.repo.create_mission(Mission(
            id=mission_id, user_id=request.user_id, skill_id=OFCOM,
            goal=f"Compensation for the missed engineer visit on {request.event_date}",
            entered_state_at=self.deps.clock(),
        ))  # fmt: skip
        self.mission_ids.append(mission_id)
        self._skills[mission_id] = OFCOM
        if request.profile_id:
            self._profiles[mission_id] = request.profile_id
        self._names[request.user_id] = request.display_name
        self._companies[mission_id] = request.operator
        self._matters[mission_id]["account_ref"] = request.account_ref
        if request.phone:
            self.remember_phone(mission_id, request.phone, request.user_id)
        notice = request.notice_hours
        work = OfcomRequest(
            mission_id=mission_id, user_id=request.user_id, display_name=request.display_name,
            operator=request.operator, event_date=request.event_date,
            notice_hours=str(notice) if notice is not None else None,
            time_value_gbp_h=str(request.time_value_gbp_h), account_ref=request.account_ref,
            hazard_id=request.hazard_id, source=request.source,
        )  # fmt: skip
        async with self._locks[mission_id]:
            with self._traced("start", mission_id):
                result = await self._engine(mission_id).start(self._workflow(mission_id), work)
                self._remember(mission_id, result)
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
            engine = self._engine(mission_id)
            storage = engine.storage(self._checkpoints / mission_id)
            with self._traced("answer", mission_id):
                result = await engine.resume(
                    self._workflow(mission_id), storage, {request_id: approval}
                )
            self._remember(mission_id, result)
        return await self.view(mission_id)

    async def stop(self, mission_id: str, *, device_sig: str) -> MissionView:
        """The kill switch (spec §7.4): revoke every scope and stop wherever the mission is."""
        if self.on_stop is not None:  # every mandate first: a company must see the STOP at once
            await self.on_stop(mission_id, device_sig)
        waiting = [rid for rid, (mid, _) in self._asks.items() if mid == mission_id]
        if waiting:
            no = SignedApproval(approved=False, scopes=BINDING_SCOPES, device_sig=device_sig)
            return await self.answer(waiting[0], no)
        async with self._locks[mission_id]:
            self._traces[mission_id] = None
            for request_id in [r for r, (m, _) in self._timers.items() if m == mission_id]:
                del self._timers[request_id]
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

    async def tick(self, now: datetime | None = None) -> list[str]:
        """Fire every timer that is due (the scheduler calls this every 30 s).

        Wake times are UTC instants and a fired timer is removed before the mission resumes,
        so a timer fires once, even in the hour the clocks go back.
        """
        now = now or self.deps.clock()
        fired = []
        for request_id, (mission_id, wake_at) in sorted(
            self._timers.items(), key=lambda t: t[1][1]
        ):
            if wake_at > now:
                continue
            async with self._locks[mission_id]:
                if self._timers.pop(request_id, None) is None:
                    continue
                engine = self._engine(mission_id)
                storage = engine.storage(self._checkpoints / mission_id)
                answer = {request_id: TimerFired(at=now.astimezone(UTC).isoformat())}
                with self._traced("timer", mission_id):
                    result = await engine.resume(self._workflow(mission_id), storage, answer)
                self._remember(mission_id, result)
            fired.append(mission_id)
        return fired

    async def recover(self) -> list[str]:
        """After a restart: re-emit what every paused mission was waiting for.

        A pending question or timer lives in the mission's checkpoint, so nothing is lost.
        Returns the ids of the missions that are waiting again.
        """
        waiting = []
        paused = (MissionState.AWAITING_CONSENT, MissionState.WAITING)
        for folder in sorted(p for p in self._checkpoints.glob("m_*") if p.is_dir()):
            try:
                mission = await self.deps.repo.get_mission(folder.name)
            except MissionNotFound:  # e.g. an in-memory store that didn't survive the restart
                log.warning("checkpoint_without_mission", mission_id=folder.name)
                continue
            if mission.id not in self.mission_ids:
                self.mission_ids.append(mission.id)  # list every mission the store still knows
            self._skills[mission.id] = mission.skill_id
            if mission.state not in paused:
                continue
            async with self._locks[mission.id]:
                engine = self._engine(mission.id)
                storage = engine.storage(folder)
                with self._traced("recover", mission.id):
                    result = await engine.resume(self._workflow(mission.id), storage, None)
                self._remember(mission.id, result)
            waiting.append(mission.id)
        return waiting

    def remember_phone(self, mission_id: str, phone: str, user_id: str | None = None) -> None:
        self._by_phone[phone_hash(phone)].append(mission_id)
        if user_id is not None:
            self._user_by_phone[phone_hash(phone)] = user_id

    def user_for_phone(self, phone: str) -> str | None:
        return self._user_by_phone.get(phone_hash(phone))

    def register_phone(self, phone: str, user_id: str, display_name: str | None = None) -> None:
        """Know a caller by their number before they have a mission (the Patience Profile).
        Only the number's hash is kept; it maps to no mission, so SMS YES finds nothing waiting."""
        self._user_by_phone[phone_hash(phone)] = user_id
        if display_name:
            self._names[user_id] = display_name

    def name_for(self, user_id: str) -> str | None:
        return self._names.get(user_id)

    async def user_for(self, mission_id: str) -> str:
        return (await self.deps.repo.get_mission(mission_id)).user_id

    def profile_for(self, mission_id: str) -> str | None:
        """The Tempo Profile a mission runs under, for the Harness that guards its calls."""
        return self._profiles.get(mission_id)

    def company_for(self, mission_id: str) -> str | None:
        return self._companies.get(mission_id)

    @contextmanager
    def _traced(self, operation: str, mission_id: str) -> Iterator[None]:
        """One trace per operation; the workflow's own spans nest inside it."""
        with (
            mission_context(mission_id),
            _tracer.start_as_current_span(f"tempo.mission.{operation}"),
        ):
            self._traces[mission_id] = current_trace_id()
            yield

    def missions_for_phone(self, phone: str) -> list[str]:
        return list(self._by_phone.get(phone_hash(phone), []))

    def mission_for_request(self, request_id: str) -> str | None:
        found = self._asks.get(request_id)
        return found[0] if found else None

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
        wake = next((w for m, w in self._timers.values() if m == mission_id), None)
        message = outcome["message"] if outcome else (ask.summary if ask else None)
        plan = self._plans.get(mission_id)
        if message is None and wake is not None:
            local = wake.astimezone(LONDON).strftime("%-d %b at %H:%M")
            if self._reasons.get(mission_id) == "re-plan":
                said = plan["explanation"] if plan else "I'm waiting, as planned."
                message = f"{said} Next check: {local}."
            elif self._skills.get(mission_id) == OFCOM:
                message = f"Complaint made. I'll check the money has arrived on {local}."
            else:
                message = f"Claim filed. I'll check the payment has arrived on {local}."
        return MissionView(
            skill_id=self._skills.get(mission_id),
            profile_id=self._profiles.get(mission_id),
            plan=plan,
            mandate=self.mandate_summary(mission_id) if self.mandate_summary else None,
            trace_url=self._trace_link(self._traces.get(mission_id)),
            court=self._courts.get(mission_id),
            id=mission_id,
            user_id=mission.user_id,
            state=mission.state,
            message=message,
            ask=ask,
            outcome=outcome,
            timeline=timeline,
        )

    def _company(self, rule_id: str) -> str:
        try:
            return str(self.deps.rules.by_id(rule_id).operator)
        except NotCovered:
            return rule_id.split(".")[1].upper() if "." in rule_id else rule_id

    def _engine(self, mission_id: str) -> Engine:
        return ENGINES[self._skills.get(mission_id, SKILL)]

    def _workflow(self, mission_id: str) -> Any:
        engine = self._engine(mission_id)
        return engine.build(self.deps, engine.storage(self._checkpoints / mission_id))

    def matter_for(self, mission_id: str) -> dict[str, str | None]:
        """What a mandate for this mission names: the company, the skill, the rule, the amount."""
        return {
            "counterparty": self._companies.get(mission_id),
            "skill_id": self._skills.get(mission_id, SKILL),
            **self._matters.get(mission_id, {}),
        }

    def _keep_plan(self, mission_id: str, plan_json: str) -> None:
        if plan_json:
            self._plans[mission_id] = json.loads(plan_json)

    def _remember(self, mission_id: str, result: RunResult) -> None:
        for request_id, ask in result.pending:
            trace = json.loads(ask.proof_trace_json) if ask.proof_trace_json else None
            if trace and trace.get("steps"):  # set at start for missions that know the company
                rule_id = trace["steps"][0]["rule_id"]
                self._companies.setdefault(mission_id, self._company(rule_id))
                self._matters[mission_id] |= {"rule_id": rule_id, "amount_gbp": ask.amount_gbp}
            self._keep_plan(mission_id, ask.plan_json)
            court = json.loads(ask.court_json) if ask.court_json else None
            if court is not None:
                self._courts[mission_id] = court
            self._asks[request_id] = (
                mission_id,
                ConsentAsk(
                    request_id=request_id,
                    summary=ask.summary,
                    amount_gbp=ask.amount_gbp,
                    proof_trace=trace,
                    court=court,
                ),
            )
            self._bus.publish(
                {"type": "consent_requested", "mission_id": mission_id, "request_id": request_id}
            )
        for request_id, timer in result.timers:
            self._timers[request_id] = (mission_id, datetime.fromisoformat(timer.wake_at))
            self._reasons[mission_id] = timer.reason
            self._keep_plan(mission_id, timer.plan_json)
            self._bus.publish(
                {"type": "timer_set", "mission_id": mission_id, "wake_at": timer.wake_at}
            )
        if result.outcome is not None:
            self._keep_plan(mission_id, result.outcome.plan_json)
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
