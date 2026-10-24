"""Tempo Memory in the Gateway: building the stores, writing timeline episodes from mission
events, proposing memories from the person's own words after a call, and read-backs."""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from tempo_adapters.settings import Settings
from tempo_core.consent import ConsentState
from tempo_gateway.events import EventBus
from tempo_memory.entities import DeadlineSet, Episode, OutcomeRecorded, ReferenceGiven
from tempo_memory.extract import extract_candidates
from tempo_memory.fallback_sql import SqlMemory, SqlTombstones
from tempo_memory.gate import OPT_IN, consent_scope, decide
from tempo_memory.in_memory import InMemoryMemory, InMemoryTombstones
from tempo_memory.mem0_store import Mem0Memory, mem0_config
from tempo_memory.models import MemoryCandidate, Verdict
from tempo_memory.port import MemoryPort, TombstoneLog
from tempo_memory.service import MemoryService
from tempo_memory.temporal import InMemoryTemporal, TemporalPort
from tempo_memory.temporal_sql import SqlTemporal

log = structlog.get_logger("tempo.memory")
_SAFE_ID = re.compile(r"[^A-Za-z0-9_-]")


class Memory(MemoryService):
    """The MemoryService plus what only the Gateway knows: read-backs waiting for a yes, and
    the categories each person has opted in to (until the Mesh consent ledger, S5.2)."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, consent=self._consent_for, **kwargs)
        self.readbacks: dict[str, list[MemoryCandidate]] = defaultdict(list)
        self.opted_in: dict[str, set[str]] = defaultdict(set)

    async def _consent_for(self, user_id: str) -> ConsentState:
        return ConsentState(allowed=frozenset(self.opted_in[user_id]), limits={})

    async def propose(self, candidates: list[MemoryCandidate]) -> list[Verdict]:
        verdicts = []
        for candidate in candidates:
            verdict = decide(candidate, await self._consent_for(candidate.user_id))
            if verdict is Verdict.STORE:
                if all(
                    i.key != candidate.key
                    for i in await self.memory.list_for_user(candidate.user_id)
                ):
                    await self.memory.add(candidate)
            elif verdict is Verdict.ASK_USER:
                self.readbacks[candidate.user_id].append(candidate)
            else:
                log.info("memory_rejected", reason=verdict.value, source=candidate.source)
            verdicts.append(verdict)
        return verdicts

    async def confirm(self, user_id: str, approved: bool) -> MemoryCandidate | None:
        """The answer to "Shall I remember this?" for the oldest waiting read-back. A yes to a
        sensitive one is also the person's opt-in for that category."""
        if not self.readbacks[user_id]:
            return None
        candidate = self.readbacks[user_id].pop(0)
        if approved:
            if candidate.category in OPT_IN:
                self.opted_in[user_id].add(consent_scope(candidate.category))
            await self.propose([candidate.model_copy(update={"confidence": 1.0})])
        return candidate


def readback_question(candidate: MemoryCandidate) -> str:
    return f"Shall I remember this about you: {candidate.text}?"


def build_memory(settings: Settings, engine: AsyncEngine | None) -> Memory:
    """Postgres when DATABASE_URL is set (TEMPO_MEMORY=mem0 for Mem0 on pgvector), else in
    memory. TEMPO_TEMPORAL=graphiti needs Neo4j and Cortex; without them, the SQL fallback."""
    memory: MemoryPort
    temporal: TemporalPort
    tombstones: TombstoneLog
    if settings.tempo_memory == "mem0":
        data_dir = Path(settings.memory_dir)
        url = settings.database_url.get_secret_value() if settings.database_url else None
        memory = Mem0Memory.create(
            mem0_config(data_dir=data_dir, database_url=url), data_dir=data_dir
        )
    elif engine is not None:
        memory = SqlMemory(engine)
    else:
        memory = InMemoryMemory()
    temporal = SqlTemporal(engine) if engine is not None else InMemoryTemporal()
    if settings.tempo_temporal == "graphiti":
        temporal = _graphiti(settings) or temporal
    tombstones = SqlTombstones(engine) if engine is not None else InMemoryTombstones()
    return Memory(memory, temporal, tombstones)


def _graphiti(settings: Settings) -> TemporalPort | None:
    if not (settings.neo4j_uri and settings.neo4j_password and settings.cortex_base_url
            and settings.snowflake_pat):  # fmt: skip
        log.warning("memory_layer_skipped", reason="graphiti_not_configured", source="temporal")
        return None
    from tempo_memory.graph_store import GraphitiTemporal, connect

    return GraphitiTemporal(
        connect(
            uri=settings.neo4j_uri, user=settings.neo4j_user,
            password=settings.neo4j_password.get_secret_value(),
            llm_base_url=settings.cortex_base_url,
            llm_api_key=settings.snowflake_pat.get_secret_value(), model=settings.cortex_fast_model,
        )
    )  # fmt: skip


def episode_for(
    event: dict[str, Any], *, user_id: str, company: str | None, now: datetime
) -> list[Episode]:
    """Timeline episodes from the Gateway's mission events: structured by our code, trusted."""
    mission_id = str(event.get("mission_id", ""))
    base: dict[str, Any] = {"user_id": user_id, "mission_id": mission_id, "at": now}
    if event.get("type") == "timer_set":
        wake = datetime.fromisoformat(str(event["wake_at"]))
        return [DeadlineSet(id=_id(mission_id, "check"), what="payment check", due_at=wake, **base)]
    if event.get("type") != "outcome" or company is None:
        return []
    episodes: list[Episode] = []
    if event.get("reference"):
        episodes.append(ReferenceGiven(id=_id(mission_id, "ref"), company=company,
                                       reference=str(event["reference"]), **base))  # fmt: skip
    if event.get("state") in {"verified", "completed", "failed_safe"}:
        amount = event.get("amount_gbp") if event.get("state") == "verified" else None
        episodes.append(OutcomeRecorded(
            id=_id(mission_id, "outcome"), company=company, state=event["state"],
            amount_gbp=Decimal(str(amount)) if amount is not None else None, **base,
        ))  # fmt: skip
    return episodes


def _id(mission_id: str, what: str) -> str:
    return _SAFE_ID.sub("_", f"{mission_id}_{what}")[:64]


async def write_episodes(
    bus: EventBus,
    memory: MemoryService,
    *,
    user_for: Callable[[str], Any],
    company_for: Callable[[str], str | None],
    clock: Callable[[], datetime],
) -> None:
    """Runs for the Gateway's lifetime; a failed write is logged and never stops a mission."""
    async with bus.subscribe() as queue:
        while True:
            event = await queue.get()
            if event.get("type") not in {"timer_set", "outcome"}:
                continue
            mission_id = str(event.get("mission_id", ""))
            try:
                user_id = await user_for(mission_id)
                for episode in episode_for(
                    event, user_id=user_id, company=company_for(mission_id), now=clock()
                ):
                    await memory.temporal.write(episode)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # memory must never break a mission
                log.warning("memory_write_failed", error_code=type(e).__name__)


def user_turns(payload: dict[str, Any]) -> list[str]:
    """(check) The caller's own words from an ElevenLabs post-call transcript."""
    transcript = (payload.get("data") or {}).get("transcript") or []
    return [str(t.get("message") or "") for t in transcript if t.get("role") == "user"]


def caller(payload: dict[str, Any]) -> tuple[str | None, str | None]:
    """(check) The user id and phone our inbound agent was given as dynamic variables."""
    data = payload.get("data") or {}
    variables = (data.get("conversation_initiation_client_data") or {}).get(
        "dynamic_variables"
    ) or {}
    return variables.get("caller_id"), variables.get("system__caller_id")


def candidates_from_call(
    payload: dict[str, Any], user_id: str, now: datetime
) -> list[MemoryCandidate]:
    return [
        c
        for turn in user_turns(payload)
        for c in extract_candidates(turn, user_id, "user_voice", now)
    ]
