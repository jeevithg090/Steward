"""Temporal memory in Postgres: the Graphiti fallback (TEMPO_TEMPORAL=sql, the default).

`memory_episodes` keeps each trusted episode; `temporal_facts` the facts derived from it, with
their validity windows. Deleting an episode cascades to its facts, then the survivors re-chain.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from tempo_memory.embedding import HashingEmbedder
from tempo_memory.entities import Episode
from tempo_memory.fallback_sql import TS, metadata
from tempo_memory.in_memory import utc_now
from tempo_memory.temporal import TemporalFact, derive, rank, reconcile

memory_episodes = sa.Table(
    "memory_episodes",
    metadata,
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("user_id", sa.String(64), nullable=False, index=True),
    sa.Column("event", sa.String(16), nullable=False),
    sa.Column("at", TS, nullable=False),
    sa.Column("payload", JSONB, nullable=False),
)

temporal_facts = sa.Table(
    "temporal_facts",
    metadata,
    sa.Column("id", sa.String(32), primary_key=True),
    sa.Column("user_id", sa.String(64), nullable=False, index=True),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("subject", sa.String(120), nullable=False),
    sa.Column("predicate", sa.String(32), nullable=False),
    sa.Column("object", sa.String(200), nullable=False),
    sa.Column("valid_from", TS, nullable=False),
    sa.Column("valid_to", TS),
    sa.Column("superseded_by", sa.String(32)),
    sa.Column(
        "episode_id",
        sa.String(64),
        sa.ForeignKey("memory_episodes.id", ondelete="CASCADE"),
        nullable=False,
    ),
)

Group = tuple[str, str, str]


def _fact(row: Any) -> TemporalFact:  # a Row of temporal_facts
    return TemporalFact.model_validate(row._asdict())


class SqlTemporal:
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

    async def write(self, episode: Episode) -> list[TemporalFact]:
        async with self.engine.begin() as conn:
            stored = await conn.execute(
                insert(memory_episodes)
                .values(
                    id=episode.id, user_id=episode.user_id, event=episode.event, at=episode.at,
                    payload=episode.model_dump(mode="json"),
                )
                .on_conflict_do_nothing()
            )  # fmt: skip
            if stored.rowcount == 0:  # a replayed episode
                where = temporal_facts.c.episode_id == episode.id
                return [
                    _fact(r) for r in (await conn.execute(sa.select(temporal_facts).where(where)))
                ]
            new = derive(episode)
            await conn.execute(temporal_facts.insert(), [f.model_dump() for f in new])
            await self._reconcile(conn, {(f.user_id, f.subject, f.predicate) for f in new})
            ids = [f.id for f in new]
            rows = await conn.execute(sa.select(temporal_facts).where(temporal_facts.c.id.in_(ids)))
            by_id = {f.id: f for f in map(_fact, rows)}
            return [by_id[i] for i in ids]

    async def search(
        self, user_id: str, query: str, *, as_of: datetime | None = None, limit: int = 5
    ) -> list[TemporalFact]:
        at = as_of or self.clock()
        stmt = sa.select(temporal_facts).where(
            temporal_facts.c.user_id == user_id,
            temporal_facts.c.valid_from <= at,
            sa.or_(temporal_facts.c.valid_to.is_(None), temporal_facts.c.valid_to > at),
        )
        async with self.engine.connect() as conn:
            valid = [_fact(r) for r in await conn.execute(stmt)]
        return rank(valid, query, self.embedder, limit)

    async def timeline(self, user_id: str) -> list[TemporalFact]:
        stmt = (
            sa.select(temporal_facts)
            .where(temporal_facts.c.user_id == user_id)
            .order_by(temporal_facts.c.valid_from, temporal_facts.c.id)
        )
        async with self.engine.connect() as conn:
            return [_fact(r) for r in await conn.execute(stmt)]

    async def forget_episode(self, user_id: str, episode_id: str) -> bool:
        async with self.engine.begin() as conn:
            gone = (
                await conn.execute(
                    sa.select(temporal_facts.c.user_id, temporal_facts.c.subject,
                              temporal_facts.c.predicate)
                    .where(temporal_facts.c.episode_id == episode_id,
                           temporal_facts.c.user_id == user_id)
                )
            ).all()  # fmt: skip
            deleted = await conn.execute(
                memory_episodes.delete().where(
                    memory_episodes.c.id == episode_id, memory_episodes.c.user_id == user_id
                )
            )
            await self._reconcile(conn, {(r.user_id, r.subject, r.predicate) for r in gone})
            return deleted.rowcount > 0

    async def forget_user(self, user_id: str) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(memory_episodes.delete().where(memory_episodes.c.user_id == user_id))

    async def _reconcile(self, conn: AsyncConnection, groups: set[Group]) -> None:
        for user_id, subject, predicate in groups:
            stmt = sa.select(temporal_facts).where(
                temporal_facts.c.user_id == user_id,
                temporal_facts.c.subject == subject,
                temporal_facts.c.predicate == predicate,
            )
            for f in reconcile(_fact(r) for r in await conn.execute(stmt)):
                await conn.execute(
                    temporal_facts.update()
                    .where(temporal_facts.c.id == f.id)
                    .values(valid_to=f.valid_to, superseded_by=f.superseded_by)
                )
