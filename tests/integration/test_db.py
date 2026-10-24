import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from alembic import command
from tempo_adapters.db import SqlRepo
from tempo_core.consent import ConsentEvent, ConsentKind, effective_consent
from tempo_core.errors import MissionNotFound, StaleMission
from tempo_core.ledger import LedgerEntry
from tempo_core.models import Mission
from tempo_core.models import MissionState as S
from tempo_core.state import advance

from .conftest import alembic_config

T0 = datetime(2026, 10, 24, 12, 0, tzinfo=UTC)
PII = {"phone", "phone_number", "name", "display_name", "address", "postcode", "dob", "email"}


async def seed(repo: SqlRepo) -> Mission:
    await repo.upsert_user("u_1", display_name="Margaret", time_value_gbp_h=Decimal("18"))
    mission = Mission(
        id="m_1",
        user_id="u_1",
        skill_id="clawback.uk-rail-delay-repay",
        goal="Recover Delay Repay for the 08:12 on 23 Oct",
        entered_state_at=T0,
    )
    await repo.create_mission(mission)
    return mission


async def columns(engine: AsyncEngine, table: str) -> dict[str, str]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name = :t"
            ),
            {"t": table},
        )
        return {name: kind for name, kind in rows}


async def test_migrations_upgrade_downgrade_clean(migrated: str, engine: AsyncEngine) -> None:
    config = alembic_config(migrated)

    await asyncio.to_thread(command.downgrade, config, "base")  # alembic runs its own loop
    async with engine.connect() as conn:
        tables = set(
            (
                await conn.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
                )
            )
            .scalars()
            .all()
        )
        functions = (
            await conn.execute(
                text("SELECT count(*) FROM pg_proc WHERE proname = 'consents_append_only'")
            )
        ).scalar()
    await asyncio.to_thread(command.upgrade, config, "head")

    assert tables <= {"alembic_version"}
    assert functions == 0


async def test_consents_table_is_append_only(repo: SqlRepo, engine: AsyncEngine) -> None:
    await seed(repo)
    await repo.append_consent(
        ConsentEvent(
            mission_id="m_1", scope="file_claim", kind=ConsentKind.GRANT, at=T0, device_sig="sig"
        )
    )

    for statement in ("UPDATE consents SET scope = 'phone_company'", "DELETE FROM consents"):
        async with engine.begin() as conn:
            with pytest.raises(DBAPIError, match="append-only"):
                await conn.execute(text(statement))


async def test_consents_round_trip_and_still_merge_deny_wins(repo: SqlRepo) -> None:
    await seed(repo)
    grant = ConsentEvent(
        mission_id="m_1",
        scope="file_claim",
        kind=ConsentKind.GRANT,
        at=T0,
        limits={"auto_accept_max_gbp": Decimal("50.00"), "accept_vouchers": False},
        device_sig="sig",
    )
    stop = ConsentEvent(
        mission_id="m_1",
        scope="file_claim",
        kind=ConsentKind.REVOKE,
        at=T0 + timedelta(minutes=5),
        device_sig="sms:STOP",
    )
    await repo.append_consent(grant)
    await repo.append_consent(stop)

    stored = await repo.consents("m_1")

    assert stored == [grant, stop]
    assert not effective_consent(stored, T0 + timedelta(hours=1)).allows("file_claim")


async def test_case_event_written_per_transition(repo: SqlRepo, engine: AsyncEngine) -> None:
    mission = await seed(repo)
    state, at = mission.state, T0
    for target, seconds in ((S.UNDERSTOOD, 2), (S.PLANNED, 1), (S.APPRAISED, 3)):
        now = at + timedelta(seconds=seconds)
        mission = await repo.record_transition(
            advance("m_1", state, target, entered_at=at, now=now), actor="agent"
        )
        state, at = target, now

    async with engine.connect() as conn:
        events = (
            await conn.execute(
                text("SELECT from_state, to_state, latency_ms FROM case_events ORDER BY id")
            )
        ).all()

    assert mission.state is S.APPRAISED
    assert (await repo.get_mission("m_1")).entered_state_at == T0 + timedelta(seconds=6)
    assert [tuple(e) for e in events] == [
        ("received", "understood", 2000),
        ("understood", "planned", 1000),
        ("planned", "appraised", 3000),
    ]


async def test_a_stale_transition_is_refused_and_not_logged(
    repo: SqlRepo, engine: AsyncEngine
) -> None:
    await seed(repo)
    event = advance("m_1", S.RECEIVED, S.UNDERSTOOD, entered_at=T0, now=T0)
    await repo.record_transition(event, actor="agent")

    with pytest.raises(StaleMission):
        await repo.record_transition(event, actor="agent")  # a replayed webhook, say

    async with engine.connect() as conn:
        count = (await conn.execute(text("SELECT count(*) FROM case_events"))).scalar()
    assert count == 1


async def test_ledger_money_is_exact(repo: SqlRepo, engine: AsyncEngine) -> None:
    await seed(repo)
    await repo.add_ledger_entry(
        LedgerEntry(
            mission_id="m_1",
            at=T0,
            minutes_returned=Decimal("25.0"),
            gbp_recovered=Decimal("14.20"),
        ),
        user_id="u_1",
        company="GWR",
    )

    async with engine.connect() as conn:
        recovered = (await conn.execute(text("SELECT gbp_recovered FROM time_ledger"))).scalar()

    assert recovered == Decimal("14.20")
    assert (await columns(engine, "time_ledger"))["gbp_recovered"] == "numeric"


async def test_no_pii_columns_in_ledger_tables(engine: AsyncEngine) -> None:
    for table in ("time_ledger", "case_events", "stall_events", "consents"):
        assert set(await columns(engine, table)).isdisjoint(PII), table


async def test_an_unknown_mission_is_not_found(repo: SqlRepo) -> None:
    with pytest.raises(MissionNotFound):
        await repo.get_mission("m_404")


async def test_a_ledger_entry_with_the_same_key_is_recorded_once(
    repo: SqlRepo, engine: AsyncEngine
) -> None:
    await seed(repo)
    entry = LedgerEntry(mission_id="m_1", at=T0, minutes_returned=Decimal("20"), key="m_1:claimed")

    await repo.add_ledger_entry(entry, user_id="u_1", company="GW")
    await repo.add_ledger_entry(entry, user_id="u_1", company="GW")  # a replayed step
    await repo.add_ledger_entry(entry.model_copy(update={"key": None}), user_id="u_1")

    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT entry_key FROM time_ledger ORDER BY id"))).all()
    assert [r[0] for r in rows] == ["m_1:claimed", None]
