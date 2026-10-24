"""Postgres implementation of RepoPort (SQLAlchemy 2, asyncpg)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from tempo_adapters.db.models import CaseEvent, ConsentRow, MissionRow, TimeLedgerRow, User
from tempo_core.consent import ConsentEvent, ConsentKind
from tempo_core.errors import MissionNotFound, StaleMission
from tempo_core.ledger import LedgerEntry
from tempo_core.models import Mission, MissionState
from tempo_core.state import StateChanged


def make_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(
        database_url, pool_pre_ping=True, connect_args={"timeout": 10, "command_timeout": 15}
    )


class SqlRepo:
    def __init__(self, engine: AsyncEngine) -> None:
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def upsert_user(
        self, user_id: str, *, display_name: str, time_value_gbp_h: Decimal, language: str = "en-GB"
    ) -> None:
        values = {
            "display_name": display_name,
            "time_value_gbp_h": time_value_gbp_h,
            "language": language,
        }
        statement = insert(User).values(
            id=user_id, created_at=datetime.now(tz=UTC), accessibility_prefs={}, **values
        )
        async with self._sessions.begin() as session:
            await session.execute(
                statement.on_conflict_do_update(index_elements=[User.id], set_=values)
            )

    async def create_mission(self, mission: Mission) -> None:
        async with self._sessions.begin() as session:
            session.add(
                MissionRow(
                    id=mission.id,
                    user_id=mission.user_id,
                    skill_id=mission.skill_id,
                    goal=mission.goal,
                    state=mission.state.value,
                    entered_state_at=mission.entered_state_at,
                    created_at=mission.entered_state_at,
                )
            )

    async def get_mission(self, mission_id: str) -> Mission:
        async with self._sessions() as session:
            row = await session.get(MissionRow, mission_id)
        if row is None:
            raise MissionNotFound(mission_id)
        return _mission(row)

    async def record_transition(self, event: StateChanged, *, actor: str) -> Mission:
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(MissionRow)
                .where(
                    MissionRow.id == event.mission_id, MissionRow.state == event.from_state.value
                )
                .values(state=event.to_state.value, entered_state_at=event.at)
                .returning(MissionRow)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise StaleMission(
                    f"mission {event.mission_id} is not in {event.from_state.value} any more"
                )
            session.add(
                CaseEvent(
                    mission_id=event.mission_id,
                    at=event.at,
                    from_state=event.from_state.value,
                    to_state=event.to_state.value,
                    actor=actor,
                    latency_ms=event.latency_ms,
                )
            )
            return _mission(row)

    async def append_consent(self, event: ConsentEvent) -> None:
        async with self._sessions.begin() as session:
            session.add(
                ConsentRow(
                    mission_id=event.mission_id,
                    scope=event.scope,
                    kind=event.kind.value,
                    at=event.at,
                    expires_at=event.expires_at,
                    limits={
                        k: str(v) if isinstance(v, Decimal) else v for k, v in event.limits.items()
                    },
                    device_sig=event.device_sig,
                )
            )

    async def consents(self, mission_id: str) -> list[ConsentEvent]:
        async with self._sessions() as session:
            rows = await session.scalars(
                select(ConsentRow)
                .where(ConsentRow.mission_id == mission_id)
                .order_by(ConsentRow.id)
            )
            return [
                ConsentEvent(
                    mission_id=r.mission_id,
                    scope=r.scope,
                    kind=ConsentKind(r.kind),
                    at=r.at,
                    expires_at=r.expires_at,
                    limits={
                        k: v if isinstance(v, bool) else Decimal(v) for k, v in r.limits.items()
                    },
                    device_sig=r.device_sig,
                )
                for r in rows
            ]

    async def add_ledger_entry(
        self, entry: LedgerEntry, *, user_id: str, company: str | None = None
    ) -> None:
        async with self._sessions.begin() as session:
            session.add(
                TimeLedgerRow(
                    user_id=user_id,
                    mission_id=entry.mission_id,
                    at=entry.at,
                    company=company,
                    minutes_lost=entry.minutes_lost,
                    minutes_returned=entry.minutes_returned,
                    gbp_recovered=entry.gbp_recovered,
                )
            )


def _mission(row: MissionRow) -> Mission:
    return Mission(
        id=row.id,
        user_id=row.user_id,
        skill_id=row.skill_id,
        goal=row.goal,
        state=MissionState(row.state),
        entered_state_at=row.entered_state_at,
    )
