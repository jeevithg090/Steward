"""The MemoryPort contract (S3.7) on Postgres: the pgvector fallback, and Mem0 on pgvector."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from sqlalchemy.ext.asyncio import AsyncEngine

from tempo_memory.contract import NOW, FakeClock, MemoryPortContract, said
from tempo_memory.fallback_sql import SqlMemory, SqlTombstones
from tempo_memory.mem0_store import Mem0Memory, mem0_config
from tempo_memory.models import Tombstone


def drop(table: str) -> sql.Composed:
    return sql.SQL("DROP TABLE IF EXISTS {}").format(sql.Identifier(table))


class TestSqlMemory(MemoryPortContract):
    @pytest.fixture
    def store(self, engine: AsyncEngine, clock: FakeClock) -> SqlMemory:
        return SqlMemory(engine, clock=clock)


class TestMem0OnPgvector(MemoryPortContract):
    @pytest.fixture
    def store(self, migrated: str, clock: FakeClock, tmp_path: Path) -> Iterator[Mem0Memory]:
        collection = f"mem0_test_{uuid.uuid4().hex[:8]}"
        config = mem0_config(data_dir=tmp_path, database_url=migrated, collection=collection)
        yield Mem0Memory.create(config, data_dir=tmp_path, clock=clock)
        with psycopg.connect(migrated.replace("+asyncpg", "")) as conn:
            conn.execute(drop(collection))  # Mem0 made it; tidy up


async def test_mem0_pgvector_roundtrip(migrated: str, tmp_path: Path) -> None:
    collection = f"mem0_test_{uuid.uuid4().hex[:8]}"
    config = mem0_config(data_dir=tmp_path, database_url=migrated, collection=collection)
    store = Mem0Memory.create(config, data_dir=tmp_path)

    item = await store.add(said("commutes Oxford to Paddington", category="journey"))
    hits = await store.search("u_1", "my commute to Paddington")

    assert [h.item for h in hits] == [item]
    with psycopg.connect(migrated.replace("+asyncpg", "")) as conn:
        count = sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(collection))
        (rows,) = conn.execute(count).fetchone() or (0,)
        conn.execute(drop(collection))
    assert rows == 1


async def test_tombstones_are_kept_without_content(engine: AsyncEngine) -> None:
    log = SqlTombstones(engine)
    stone = Tombstone(user_id="u_1", key=said("lives in Didcot").key, at=NOW)

    await log.record([stone, stone])  # a replayed forget is recorded once
    await log.record([Tombstone(user_id="u_2", key="k", at=NOW + timedelta(hours=1))])

    assert await log.for_user("u_1") == [stone]
