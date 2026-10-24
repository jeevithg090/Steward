"""The SQL fallback's in-process twin: same behaviour, no database. Tests and replay use it."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable, Sequence
from datetime import UTC, datetime

from tempo_memory.embedding import HashingEmbedder, cosine
from tempo_memory.gate import to_item
from tempo_memory.models import MemoryCandidate, MemoryItem, Tombstone
from tempo_memory.port import MIN_SCORE, MemoryHit, admit


def utc_now() -> datetime:
    return datetime.now(UTC)


def version_chain(item: MemoryItem, items: Iterable[MemoryItem]) -> list[MemoryItem]:
    """Every version linked to `item` through superseded_by, oldest first."""
    by_id = {i.id: i for i in items}
    older = {i.superseded_by: i for i in by_id.values() if i.superseded_by is not None}
    chain = [item]
    while (prev := older.get(chain[0].id)) is not None:
        chain.insert(0, prev)
    while (newer := chain[-1].superseded_by) is not None:
        chain.append(by_id[newer])
    return chain


def tombstones_for(chain: Sequence[MemoryItem], at: datetime) -> list[Tombstone]:
    keys = dict.fromkeys(item.key for item in chain)
    return [Tombstone(user_id=chain[0].user_id, key=key, at=at) for key in keys]


def is_current(item: MemoryItem, now: datetime) -> bool:
    return item.superseded_by is None and (item.expires_at is None or item.expires_at > now)


class InMemoryMemory:
    def __init__(
        self,
        *,
        embedder: HashingEmbedder | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.embedder = embedder or HashingEmbedder()
        self.clock = clock
        self.items: dict[str, MemoryItem] = {}
        self.vectors: dict[str, list[float]] = {}

    async def add(self, candidate: MemoryCandidate) -> MemoryItem:
        admit(candidate)
        item = to_item(candidate, item_id=uuid.uuid4().hex)
        self.items[item.id] = item
        self.vectors[item.id] = self.embedder.embed(item.text)
        return item

    async def update(self, user_id: str, item_id: str, candidate: MemoryCandidate) -> MemoryItem:
        old = self._owned(user_id, item_id)
        if old is None or candidate.user_id != user_id:
            raise KeyError(item_id)
        new = await self.add(candidate)
        self.items[old.id] = old.model_copy(update={"superseded_by": new.id})
        return new

    async def search(self, user_id: str, query: str, *, limit: int = 5) -> list[MemoryHit]:
        q, now = self.embedder.embed(query), self.clock()
        hits = [
            MemoryHit(item=item, score=cosine(q, self.vectors[item.id]))
            for item in self.items.values()
            if item.user_id == user_id and is_current(item, now)
        ]
        hits = [h for h in hits if h.score >= MIN_SCORE]
        return sorted(hits, key=lambda h: h.score, reverse=True)[:limit]

    async def list_for_user(self, user_id: str) -> list[MemoryItem]:
        now = self.clock()
        current = [i for i in self.items.values() if i.user_id == user_id and is_current(i, now)]
        return sorted(current, key=lambda i: i.observed_at, reverse=True)

    async def history(self, user_id: str, item_id: str) -> list[MemoryItem]:
        return self._chain(user_id, item_id)

    async def forget(self, user_id: str, item_id: str) -> list[Tombstone]:
        chain = self._chain(user_id, item_id)
        for item in chain:
            del self.items[item.id], self.vectors[item.id]
        return tombstones_for(chain, self.clock()) if chain else []

    def _owned(self, user_id: str, item_id: str) -> MemoryItem | None:
        item = self.items.get(item_id)
        return item if item is not None and item.user_id == user_id else None

    def _chain(self, user_id: str, item_id: str) -> list[MemoryItem]:
        item = self._owned(user_id, item_id)
        return [] if item is None else version_chain(item, self.items.values())


class InMemoryTombstones:
    def __init__(self) -> None:
        self.tombstones: list[Tombstone] = []

    async def record(self, tombstones: Sequence[Tombstone]) -> None:
        self.tombstones.extend(tombstones)

    async def for_user(self, user_id: str) -> list[Tombstone]:
        return [t for t in self.tombstones if t.user_id == user_id]
