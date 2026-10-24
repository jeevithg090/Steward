"""In-memory RepoPort for replay mode and tests: the same rules as the Postgres repo."""

from __future__ import annotations

from decimal import Decimal

from tempo_core.consent import ConsentEvent
from tempo_core.errors import MissionNotFound, StaleMission
from tempo_core.ledger import LedgerEntry
from tempo_core.models import Mission
from tempo_core.state import StateChanged


class InMemoryRepo:
    def __init__(self) -> None:
        self.users: dict[str, dict[str, object]] = {}
        self.missions: dict[str, Mission] = {}
        self.case_events_log: list[tuple[StateChanged, str]] = []
        self.consent_events: list[ConsentEvent] = []
        self.ledger: list[tuple[LedgerEntry, str, str | None]] = []

    async def upsert_user(
        self, user_id: str, *, display_name: str, time_value_gbp_h: Decimal, language: str = "en-GB"
    ) -> None:
        self.users[user_id] = {
            "display_name": display_name,
            "time_value_gbp_h": time_value_gbp_h,
            "language": language,
        }

    async def create_mission(self, mission: Mission) -> None:
        if mission.id in self.missions:
            raise ValueError(f"mission {mission.id} already exists")
        self.missions[mission.id] = mission

    async def get_mission(self, mission_id: str) -> Mission:
        try:
            return self.missions[mission_id]
        except KeyError:
            raise MissionNotFound(mission_id) from None

    async def record_transition(self, event: StateChanged, *, actor: str) -> Mission:
        mission = await self.get_mission(event.mission_id)
        if mission.state is not event.from_state:
            raise StaleMission(f"mission {event.mission_id} is not in {event.from_state} any more")
        moved = mission.model_copy(update={"state": event.to_state, "entered_state_at": event.at})
        self.missions[mission.id] = moved
        self.case_events_log.append((event, actor))
        return moved

    async def case_events(self, mission_id: str) -> list[StateChanged]:
        return [e for e, _ in self.case_events_log if e.mission_id == mission_id]

    async def append_consent(self, event: ConsentEvent) -> None:
        self.consent_events.append(event)

    async def consents(self, mission_id: str) -> list[ConsentEvent]:
        return [e for e in self.consent_events if e.mission_id == mission_id]

    async def add_ledger_entry(
        self, entry: LedgerEntry, *, user_id: str, company: str | None = None
    ) -> None:
        if entry.key is not None and any(e.key == entry.key for e, _, _ in self.ledger):
            return
        self.ledger.append((entry, user_id, company))
