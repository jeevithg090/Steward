"""Repository port: missions, their state history, consents and the Time Ledger."""

from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from tempo_core.consent import ConsentEvent
from tempo_core.ledger import LedgerEntry
from tempo_core.models import Mission
from tempo_core.state import StateChanged


class RepoPort(Protocol):
    async def upsert_user(
        self, user_id: str, *, display_name: str, time_value_gbp_h: Decimal, language: str = "en-GB"
    ) -> None: ...

    async def create_mission(self, mission: Mission) -> None: ...

    async def get_mission(self, mission_id: str) -> Mission:
        """Raises MissionNotFound."""
        ...

    async def record_transition(self, event: StateChanged, *, actor: str) -> Mission:
        """Move the mission and write its case event in one transaction.

        Raises StaleMission if the mission is no longer in `event.from_state`.
        """
        ...

    async def append_consent(self, event: ConsentEvent) -> None: ...

    async def consents(self, mission_id: str) -> list[ConsentEvent]: ...

    async def add_ledger_entry(
        self, entry: LedgerEntry, *, user_id: str, company: str | None = None
    ) -> None: ...
