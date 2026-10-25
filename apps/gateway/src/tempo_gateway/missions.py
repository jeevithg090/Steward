"""MissionService: starts missions, routes answers back in, and stops them on request.

Each mission has its own checkpoint folder, so "the latest checkpoint" always means this
mission's. A lock per mission stops two deliveries of the same answer from racing.

A mission may run under a Tempo Profile. The routes refuse a profile that lacks a skill's needs
before anything starts (`profile_refusal`); the workflows' claim path is guarded as well
(`tempo_harness.GuardedClaims`), so a mission started here directly still can't file a claim its
profile forbids: the claim is refused at the tool and the mission fails safe in plain words.
Which profile each mission runs under, and what it is for (`mission_key`: the journey or the
visit), are kept in `missions.json` next to the checkpoints and read back by `recover()`, so a
restart neither drops the guard nor forgets a claim: `duplicate_of` finds the live mission for
the same journey, and the routes return it instead of claiming twice. Every door starts through
`start_once`, which holds a lock per person and claim around that check and the start, so two
identical requests at the same instant still make one mission.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import structlog
from opentelemetry import trace
from pydantic import BaseModel, Field

from tempo_adapters.model_status import ModelStatus
from tempo_adapters.telemetry import current_trace_id, mission_context
from tempo_core.consent import ConsentEvent, ConsentKind
from tempo_core.delays import LONDON
from tempo_core.errors import MissionNotFound, NotCovered, TempoError
from tempo_core.models import Mission, MissionState
from tempo_core.profiles import Profile, ProfileCatalog, refusal
from tempo_core.state import advance, allowed_next
from tempo_gateway.engines import ENGINES, OFCOM, RAIL, Engine
from tempo_gateway.events import EventBus
from tempo_gateway.security import phone_hash
from tempo_harness.claims_guard import ClaimRefused, GuardedClaims
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
# Which skill manifest (skills/<id>/skill.yaml) each mission's workflow belongs to: its `needs`
# are what a profile must allow before the mission starts.
MANIFESTS: Mapping[str, str] = {RAIL: "clawback-uk-rail", OFCOM: "clawback-ofcom"}
NEEDS_UNKNOWN = "I can't check what this needs against your profile, so I haven't started."
# Mission id -> {"key", "profile_id", "limit_named"}, beside the per-mission checkpoint folders.
MISSIONS_FILE = "missions.json"
# A mission that ended this way claimed nothing, so the same journey may be started again.
ENDED_WITHOUT_CLAIM = (MissionState.DECLINED, MissionState.FAILED_SAFE)


def profile_refusal(
    catalog: ProfileCatalog | None, profile_id: str | None, skill_id: str
) -> str | None:
    """Why a mission of this skill can't start under this profile, in plain words, or None.
    An unknown profile is the caller's own 422; this is only about what a known one allows."""
    profile = catalog.get(profile_id) if catalog is not None and profile_id else None
    if catalog is None or profile is None:
        return None
    manifest = catalog.skills.get(MANIFESTS.get(skill_id, ""))
    if manifest is None:
        return NEEDS_UNKNOWN  # fail closed: nothing starts on a guess
    return refusal(profile, manifest.needs)


def mission_key(request: StartMission | StartOfcom) -> str:
    """What makes two missions the same claim. A journey: its stations, its date and its departure
    as HHMM. A missed visit: the provider, ignoring case and spacing, and the day of the visit."""
    if isinstance(request, StartMission):
        return "|".join((
            RAIL, request.origin_crs.upper(), request.destination_crs.upper(),
            request.travel_date, request.departure.replace(":", ""),
        ))  # fmt: skip
    return "|".join((OFCOM, " ".join(request.operator.split()).casefold(), request.event_date))


class UnknownRequest(TempoError):
    """No mission is waiting for an answer with this request id."""


class StartMission(BaseModel):
    user_id: str
    display_name: str = Field(default="", max_length=80)  # "": they never gave one
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
    display_name: str = Field(default="", max_length=80)  # "": they never gave one
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
    amount_gbp: str | None = None  # paid, else asked; kept after the yes for a waiting claim


class MissionService:
    def __init__(
        self,
        deps: ClawbackDeps,
        checkpoints: Path,
        bus: EventBus,
        *,
        trace_link: Callable[[str | None], str | None] = lambda _: None,
        profiles: ProfileCatalog | None = None,
    ) -> None:
        self.deps = deps
        self.profiles = profiles  # the Tempo Profiles the claim guard reads (create_app sets it)
        self._limit_named: set[str] = set()  # missions whose consent ask named the profile limit
        self._profile_unknown: set[str] = set()  # recovered, but missions.json couldn't be read
        self._keys: dict[str, str] = {}  # mission id -> mission_key: what it claims
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
        self.model_status: ModelStatus | None = None  # set by main._build (plan.md §13.5)
        self._matters: dict[str, dict[str, str | None]] = defaultdict(dict)  # for mandates
        # Agent Passport hooks (set by create_app when mandates are on): STOP revokes them all.
        self.on_stop: Callable[[str, str], Awaitable[object]] | None = None
        self.mandate_summary: Callable[[str], dict[str, Any] | None] | None = None
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        # (user id, mission_key) -> held from the duplicate check until the mission has started
        self._claim_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)
        self.mission_ids: list[str] = []  # newest last

    async def start_once(self, request: StartMission | StartOfcom) -> tuple[MissionView, bool]:
        """Start this claim unless this person already has a live mission for it. Returns the
        mission and whether it is new.

        The check and the start hold one lock per person and claim (`mission_key`), so two
        identical requests at the same instant, through one door or two, make one mission: the
        second waits until the first has started, then gets it back. Other claims never wait.
        The lock is in this process, like the asks and timers: the Gateway runs as one process.
        """
        async with self._claim_locks[(request.user_id, mission_key(request))]:
            existing = await self.duplicate_of(request)
            if existing is not None:
                return existing, False
            if isinstance(request, StartMission):
                return await self.start(request), True
            return await self.start_ofcom(request), True

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
        self._keys[mission_id] = mission_key(request)
        self._save_facts()
        if request.display_name:  # a blank never replaces a name they gave
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
                engine, workflow = self._engine(mission_id), self._workflow(mission_id)
                await self._run(mission_id, engine.start(workflow, claim))
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
        self._keys[mission_id] = mission_key(request)
        self._save_facts()
        if request.display_name:  # a blank never replaces a name they gave
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
                engine, workflow = self._engine(mission_id), self._workflow(mission_id)
                await self._run(mission_id, engine.start(workflow, work))
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
            workflow = self._workflow(mission_id)
            with self._traced("answer", mission_id):
                await self._run(
                    mission_id, engine.resume(workflow, storage, {request_id: approval})
                )
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
            await self._to_failed_safe(mission_id, actor="user")
        return await self.view(mission_id)

    async def _to_failed_safe(self, mission_id: str, *, actor: str) -> None:
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
                actor=actor,
            )

    async def _run(self, mission_id: str, running: Awaitable[RunResult]) -> None:
        """Run or resume the workflow and remember what it asked for. A claim the profile guard
        refused stops the mission there: failed safe, in the guard's plain words, nothing filed."""
        try:
            result = await running
        except Exception as exc:
            refused = _refused(exc)
            if refused is None:
                raise
            log.warning("claim_refused", mission_id=mission_id, reason=refused.reason)
            await self._to_failed_safe(mission_id, actor="system")
            self._outcomes[mission_id] = {
                "state": MissionState.FAILED_SAFE.value, "message": refused.message,
                "amount_gbp": None, "reference": None,
            }  # fmt: skip
            self._bus.publish(
                {"type": "outcome", "mission_id": mission_id, **self._outcomes[mission_id]}
            )
            return
        self._remember(mission_id, result)

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
                workflow = self._workflow(mission_id)
                with self._traced("timer", mission_id):
                    await self._run(mission_id, engine.resume(workflow, storage, answer))
            fired.append(mission_id)
        return fired

    async def recover(self) -> list[str]:
        """After a restart: re-emit what every paused mission was waiting for.

        A pending question or timer lives in the mission's checkpoint, so nothing is lost; the
        profile each mission runs under, and what it claims, come back from `missions.json`.
        Returns the ids of the missions that are waiting again.
        """
        waiting = []
        paused = (MissionState.AWAITING_CONSENT, MissionState.WAITING)
        readable = self._load_facts()
        for folder in sorted(p for p in self._checkpoints.glob("m_*") if p.is_dir()):
            try:
                mission = await self.deps.repo.get_mission(folder.name)
            except MissionNotFound:  # e.g. an in-memory store that didn't survive the restart
                log.warning("checkpoint_without_mission", mission_id=folder.name)
                continue
            if mission.id not in self.mission_ids:
                self.mission_ids.append(mission.id)  # list every mission the store still knows
            self._skills[mission.id] = mission.skill_id
            if not readable and mission.id not in self._profiles:
                self._profile_unknown.add(mission.id)  # deny wins: its claim is refused
            if mission.state not in paused:
                continue
            async with self._locks[mission.id]:
                engine = self._engine(mission.id)
                storage = engine.storage(folder)
                workflow = self._workflow(mission.id)
                with self._traced("recover", mission.id):
                    await self._run(mission.id, engine.resume(workflow, storage, None))
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

    def _profile_of(self, mission_id: str) -> Profile | None:
        """The profile the claim guard enforces. A mission that names a profile nobody can find
        raises, and the guard refuses the claim: an unknown promise is never read as none."""
        if mission_id in self._profile_unknown:
            raise LookupError("the saved profiles couldn't be read after a restart")
        profile_id = self._profiles.get(mission_id)
        if profile_id is None:
            return None
        profile = self.profiles.get(profile_id) if self.profiles is not None else None
        if profile is None:
            raise LookupError(f"profile {profile_id!r} is not installed")
        return profile

    def _guard(self) -> GuardedClaims:
        return GuardedClaims(self.deps.claims, self._profile_of, self._limit_named.__contains__)

    async def duplicate_of(self, request: StartMission | StartOfcom) -> MissionView | None:
        """This person's live mission for the same journey or visit, if there is one: Tempo never
        claims the same thing twice. One that was declined or failed safe claimed nothing, so it
        doesn't count, and the newest live one wins. A door starts through `start_once`, which
        runs this check and the start under one lock."""
        key = mission_key(request)
        for mission_id in reversed(self.mission_ids):
            if self._keys.get(mission_id) != key:
                continue
            try:
                mission = await self.deps.repo.get_mission(mission_id)
            except MissionNotFound:
                continue
            if mission.user_id == request.user_id and mission.state not in ENDED_WITHOUT_CLAIM:
                return await self.view(mission_id)
        return None

    def _save_facts(self) -> None:
        """Write what each mission claims and the profile it runs under beside the checkpoints,
        atomically: a crash mid-write leaves the previous file, never half of one."""
        body = {
            mission_id: {
                "key": self._keys.get(mission_id),
                "profile_id": self._profiles.get(mission_id),
                "limit_named": mission_id in self._limit_named,
            }
            for mission_id in sorted(self._keys.keys() | self._profiles.keys())
        }
        self._checkpoints.mkdir(parents=True, exist_ok=True)
        path = self._checkpoints / MISSIONS_FILE
        partial = path.with_name(f".{MISSIONS_FILE}.{uuid.uuid4().hex[:8]}.tmp")
        partial.write_text(json.dumps(body, sort_keys=True), encoding="utf-8")
        os.replace(partial, path)

    def _load_facts(self) -> bool:
        """Read them back after a restart. False when the file exists but can't be read: the
        missions recovered then are treated as running under a profile nobody can find."""
        path = self._checkpoints / MISSIONS_FILE
        if not path.exists():
            return True
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            saved = {
                str(mission_id): (
                    _text_or_none(entry.get("key")), _text_or_none(entry.get("profile_id")),
                    bool(entry.get("limit_named")),
                )
                for mission_id, entry in data.items()
            }  # fmt: skip
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            log.error("missions_file_unreadable", error_code=type(exc).__name__)
            return False
        for mission_id, (key, profile_id, limit_named) in saved.items():
            if key is not None:
                self._keys.setdefault(mission_id, key)
            if profile_id is not None:
                self._profiles.setdefault(mission_id, profile_id)
            if limit_named:
                self._limit_named.add(mission_id)
        return True

    def ask_for(self, request_id: str) -> ConsentAsk | None:
        """The consent ask still waiting under this request id, if any."""
        found = self._asks.get(request_id)
        return found[1] if found else None

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
            amount_gbp=(outcome or {}).get("amount_gbp")
            or (ask.amount_gbp if ask else None)
            or self._matters.get(mission_id, {}).get("amount_gbp"),
        )

    def _company(self, rule_id: str) -> str:
        try:
            return str(self.deps.rules.by_id(rule_id).operator)
        except NotCovered:
            return rule_id.split(".")[1].upper() if "." in rule_id else rule_id

    def _engine(self, mission_id: str) -> Engine:
        return ENGINES[self._skills.get(mission_id, SKILL)]

    def _workflow(self, mission_id: str) -> Any:
        """The mission's workflow, its claims port wrapped in the profile guards."""
        engine = self._engine(mission_id)
        deps = replace(self.deps, claims=self._guard())
        return engine.build(deps, engine.storage(self._checkpoints / mission_id))

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
            summary = ask.summary
            note = self._limit_note(mission_id, ask.amount_gbp)
            if note is not None:  # above the profile's limit: the ask says so, in plain words
                summary = f"{summary} {note}"
                if mission_id not in self._limit_named:
                    self._limit_named.add(mission_id)
                    self._save_facts()
            self._asks[request_id] = (
                mission_id,
                ConsentAsk(
                    request_id=request_id,
                    summary=summary,
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

    def _limit_note(self, mission_id: str, amount_gbp: str) -> str | None:
        try:
            amount = Decimal(amount_gbp)
        except (InvalidOperation, ValueError):
            return None  # the guard refuses an amount it can't read when the claim is filed
        return self._guard().ask_note(mission_id, amount)


def _text_or_none(value: object) -> str | None:
    if value is not None and not isinstance(value, str):
        raise TypeError("expected text")
    return value


def _refused(exc: BaseException | None, depth: int = 0) -> ClaimRefused | None:
    """The guard's refusal inside whatever the workflow runtime raised around it."""
    if exc is None or depth > 8:
        return None
    if isinstance(exc, ClaimRefused):
        return exc
    if isinstance(exc, BaseExceptionGroup):
        for inner in exc.exceptions:
            found = _refused(inner, depth + 1)
            if found is not None:
                return found
    return _refused(exc.__cause__, depth + 1) or _refused(exc.__context__, depth + 1)


def utc_now() -> datetime:
    return datetime.now(tz=UTC)
