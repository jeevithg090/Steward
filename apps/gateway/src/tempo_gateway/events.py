"""Live updates for Mission Control: every state change is published the moment it's written."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Any

from tempo_core.consent import ConsentEvent
from tempo_core.ledger import LedgerEntry
from tempo_core.models import Mission
from tempo_core.state import StateChanged
from tempo_ports.repo import RepoPort


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    def publish(self, event: dict[str, Any]) -> None:
        for queue in self._subscribers:
            queue.put_nowait(event)

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[dict[str, Any]]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)


class PublishingRepo:
    """A RepoPort that announces each transition on the bus after it's stored."""

    def __init__(self, inner: RepoPort, bus: EventBus) -> None:
        self._inner = inner
        self._bus = bus

    async def upsert_user(
        self, user_id: str, *, display_name: str, time_value_gbp_h: Decimal, language: str = "en-GB"
    ) -> None:
        await self._inner.upsert_user(
            user_id, display_name=display_name, time_value_gbp_h=time_value_gbp_h, language=language
        )

    async def create_mission(self, mission: Mission) -> None:
        await self._inner.create_mission(mission)
        self._bus.publish({"type": "mission_created", "mission_id": mission.id})

    async def get_mission(self, mission_id: str) -> Mission:
        return await self._inner.get_mission(mission_id)

    async def record_transition(self, event: StateChanged, *, actor: str) -> Mission:
        mission = await self._inner.record_transition(event, actor=actor)
        self._bus.publish(
            {
                "type": "state_changed",
                "mission_id": event.mission_id,
                "from": event.from_state.value,
                "to": event.to_state.value,
                "at": event.at.isoformat(),
                "latency_ms": event.latency_ms,
                "actor": actor,
            }
        )
        return mission

    async def case_events(self, mission_id: str) -> list[StateChanged]:
        return await self._inner.case_events(mission_id)

    async def append_consent(self, event: ConsentEvent) -> None:
        await self._inner.append_consent(event)

    async def consents(self, mission_id: str) -> list[ConsentEvent]:
        return await self._inner.consents(mission_id)

    async def ledger_entries(self, user_id: str | None = None) -> list[LedgerEntry]:
        return await self._inner.ledger_entries(user_id)

    async def add_ledger_entry(
        self, entry: LedgerEntry, *, user_id: str, company: str | None = None
    ) -> None:
        await self._inner.add_ledger_entry(entry, user_id=user_id, company=company)
        self._bus.publish({"type": "ledger", "mission_id": entry.mission_id})
