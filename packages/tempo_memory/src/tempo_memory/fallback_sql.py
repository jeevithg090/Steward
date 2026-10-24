"""Personal memory in Postgres with pgvector and our own embedding: works with no Mem0.

Embeddings are sent as text and cast to `vector` in SQL, so no driver codec is needed. Only
current, unexpired rows are searchable; superseded versions stay for the timeline until forgotten.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from tempo_memory.embedding import DIMS, HashingEmbedder
from tempo_memory.gate import to_item
from tempo_memory.in_memory import tombstones_for, utc_now, version_chain
from tempo_memory.models import MemoryCandidate, MemoryItem, Tombstone
from tempo_memory.port import MIN_SCORE, MemoryHit, admit

TS = sa.DateTime(timezone=True)
metadata = sa.MetaData(
    naming_convention={
        "ix": "ix_%(column_0_label)s",
        "pk": "pk_%(table_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    }
)

memories = sa.Table(
    "memories",
    metadata,
    sa.Column("id", sa.String(32), primary_key=True),
    sa.Column("user_id", sa.String(64), nullable=False, index=True),
    sa.Column("key", sa.String(24), nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    sa.Column("category", sa.String(32), nullable=False),
    sa.Column("source", sa.String(32), nullable=False),
    sa.Column("trust", sa.String(16), nullable=False),
    sa.Column("observed_at", TS, nullable=False),
    sa.Column("confidence", sa.Float, nullable=False),
    sa.Column("consent_scope", sa.String(64)),
    sa.Column("expires_at", TS),
    sa.Column("superseded_by", sa.String(32)),
    sa.Column("embedding", Vector(DIMS), nullable=False),
)

memory_tombstones = sa.Table(
    "memory_tombstones",  # a forget, with no content: who, which fact (a hash), when
    metadata,
    sa.Column("user_id", sa.String(64), primary_key=True),
    sa.Column("key", sa.String(24), primary_key=True),
    sa.Column("at", TS, primary_key=True),
)

ITEM_COLUMNS = [c for c in memories.c if c.name != "embedding"]


def _vector(values: list[float]) -> sa.Cast[Any]:
    text = "[" + ",".join(f"{v:.6f}" for v in values) + "]"
    return sa.cast(sa.literal(text, sa.Text), Vector(DIMS))


def _item(row: Any) -> MemoryItem:  # a Row with the ITEM_COLUMNS
    return MemoryItem.model_validate({c.name: getattr(row, c.name) for c in ITEM_COLUMNS})


class SqlMemory:
    def __init__(
        self,
        engine: AsyncEngine,
        *,
        embedder: HashingEmbedder | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.engine = engine
        self.embedder = embedder or HashingEmbedder()
        self.clock = clock

    async def add(self, candidate: MemoryCandidate) -> MemoryItem:
        async with self.engine.begin() as conn:
            return await self._insert(conn, candidate)

    async def update(self, user_id: str, item_id: str, candidate: MemoryCandidate) -> MemoryItem:
        async with self.engine.begin() as conn:
            old = await self._owned(conn, user_id, item_id)
            if old is None or candidate.user_id != user_id:
                raise KeyError(item_id)
            new = await self._insert(conn, candidate)
            await conn.execute(
                memories.update().where(memories.c.id == old.id).values(superseded_by=new.id)
            )
            return new

    async def search(self, user_id: str, query: str, *, limit: int = 5) -> list[MemoryHit]:
        q = self.embedder.embed(query)
        if not any(q):
            return []
        distance = memories.c.embedding.cosine_distance(_vector(q))
        stmt = (
            sa.select(*ITEM_COLUMNS, (1 - distance).label("score"))
            .where(self._current(user_id), distance <= 1 - MIN_SCORE)  # NaN never passes
            .order_by(distance)
            .limit(limit)
        )
        async with self.engine.connect() as conn:
            rows = (await conn.execute(stmt)).all()
        return [MemoryHit(item=_item(row), score=float(row.score)) for row in rows]

    async def list_for_user(self, user_id: str) -> list[MemoryItem]:
        stmt = (
            sa.select(*ITEM_COLUMNS)
            .where(self._current(user_id))
            .order_by(memories.c.observed_at.desc())
        )
        async with self.engine.connect() as conn:
            return [_item(row) for row in (await conn.execute(stmt)).all()]

    async def history(self, user_id: str, item_id: str) -> list[MemoryItem]:
        async with self.engine.connect() as conn:
            return await self._chain(conn, user_id, item_id)

    async def forget(self, user_id: str, item_id: str) -> list[Tombstone]:
        async with self.engine.begin() as conn:
            chain = await self._chain(conn, user_id, item_id)
            if not chain:
                return []
            await conn.execute(memories.delete().where(memories.c.id.in_([i.id for i in chain])))
        return tombstones_for(chain, self.clock())

    def _current(self, user_id: str) -> sa.ColumnElement[bool]:
        return sa.and_(
            memories.c.user_id == user_id,
            memories.c.superseded_by.is_(None),
            sa.or_(memories.c.expires_at.is_(None), memories.c.expires_at > self.clock()),
        )

    async def _insert(self, conn: AsyncConnection, candidate: MemoryCandidate) -> MemoryItem:
        admit(candidate)
        item = to_item(candidate, item_id=uuid.uuid4().hex)
        embedding = _vector(self.embedder.embed(item.text))
        await conn.execute(memories.insert().values(**item.model_dump(), embedding=embedding))
        return item

    async def _owned(self, conn: AsyncConnection, user_id: str, item_id: str) -> MemoryItem | None:
        stmt = sa.select(*ITEM_COLUMNS).where(
            memories.c.id == item_id, memories.c.user_id == user_id
        )
        row = (await conn.execute(stmt)).first()
        return None if row is None else _item(row)

    async def _chain(self, conn: AsyncConnection, user_id: str, item_id: str) -> list[MemoryItem]:
        item = await self._owned(conn, user_id, item_id)
        if item is None:
            return []
        stmt = sa.select(*ITEM_COLUMNS).where(memories.c.user_id == user_id)
        return version_chain(item, [_item(row) for row in (await conn.execute(stmt)).all()])


class SqlTombstones:
    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    async def record(self, tombstones: Sequence[Tombstone]) -> None:
        if not tombstones:
            return
        rows = [t.model_dump() for t in tombstones]
        async with self.engine.begin() as conn:
            await conn.execute(insert(memory_tombstones).values(rows).on_conflict_do_nothing())

    async def for_user(self, user_id: str) -> list[Tombstone]:
        stmt = sa.select(memory_tombstones).where(memory_tombstones.c.user_id == user_id)
        async with self.engine.connect() as conn:
            rows = (await conn.execute(stmt)).all()
        return [Tombstone(user_id=r.user_id, key=r.key, at=r.at) for r in rows]
