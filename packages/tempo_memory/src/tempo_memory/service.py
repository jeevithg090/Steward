"""What the person sees and controls (spec §17.5): recall, forget, correct, and the Memory Card.

"Forget" is a hard delete everywhere: every version of a personal memory, or a timeline
episode and the facts derived from it, plus a content-free tombstone so other devices drop
their copies too (Mesh, S5.2).
"""

from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from tempo_core.consent import ConsentState
from tempo_memory.embedding import HashingEmbedder, cosine
from tempo_memory.gate import decide
from tempo_memory.in_memory import utc_now
from tempo_memory.models import MemoryCandidate, MemoryItem, Tombstone, Verdict
from tempo_memory.port import MemoryPort, TombstoneLog
from tempo_memory.provider import SPOKEN_BY
from tempo_memory.temporal import TemporalFact, TemporalPort

FORGET_MIN = 0.3  # how close "FORGET <thing>" must be to a memory to delete it


class Recalled(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["memory", "fact"]
    id: str
    text: str
    source: str  # in plain words: "you said, by voice", "Tempo's records"
    when: datetime


class CardMemory(BaseModel):
    item: MemoryItem
    earlier: list[MemoryItem]  # superseded versions, oldest first


class MemoryCard(BaseModel):
    memories: dict[str, list[CardMemory]]  # by category
    timeline: list[TemporalFact]  # every fact, superseded ones included


class Forgotten(BaseModel):
    kind: Literal["memory", "fact"]
    text: str


class NeedsConsent(Exception):
    """A correction to a sensitive memory needs the person's OK for that category first."""


async def _no_consent(user_id: str) -> ConsentState:
    return ConsentState(allowed=frozenset(), limits={})


def episode_key(episode_id: str) -> str:
    return hashlib.sha256(f"episode:{episode_id}".encode()).hexdigest()[:24]


class MemoryService:
    def __init__(
        self,
        memory: MemoryPort,
        temporal: TemporalPort,
        tombstones: TombstoneLog,
        *,
        consent: Callable[[str], Awaitable[ConsentState]] = _no_consent,
        embedder: HashingEmbedder | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self.memory, self.temporal, self.tombstones = memory, temporal, tombstones
        self.consent, self.clock = consent, clock
        self.embedder = embedder or HashingEmbedder()

    async def recall(self, user_id: str, *, limit: int = 5) -> list[Recalled]:
        """ "What do you remember about me?": the newest memories and current facts, with dates."""
        memories = [
            Recalled(kind="memory", id=i.id, text=i.text, when=i.observed_at,
                     source=SPOKEN_BY.get(i.source, i.source))
            for i in await self.memory.list_for_user(user_id)
        ]  # fmt: skip
        now = self.clock()
        facts = [
            Recalled(kind="fact", id=f.id, text=f.text, when=f.valid_from, source="Tempo's records")
            for f in await self.temporal.timeline(user_id)
            if f.true_at(now)
        ]
        return sorted(memories + facts, key=lambda r: r.when, reverse=True)[:limit]

    async def forget(self, user_id: str, thing: str) -> Forgotten | None:
        """ "Forget my address": the closest memory or timeline fact, if one is close enough."""
        hits = await self.memory.search(user_id, thing, limit=1)
        q = self.embedder.embed(thing)
        facts = [
            (cosine(q, self.embedder.embed(f"{f.kind} {f.text}")), f)
            for f in await self.temporal.timeline(user_id)
        ]
        best_fact = max(facts, key=lambda sf: sf[0], default=None)
        best_memory = hits[0] if hits else None
        if (
            best_fact is not None
            and best_fact[0] >= FORGET_MIN
            and (best_memory is None or best_fact[0] > best_memory.score)
        ):
            await self.forget_episode(user_id, best_fact[1].episode_id)
            return Forgotten(kind="fact", text=best_fact[1].text)
        if best_memory is not None and best_memory.score >= FORGET_MIN:
            await self.forget_item(user_id, best_memory.item.id)
            return Forgotten(kind="memory", text=best_memory.item.text)
        return None

    async def forget_item(self, user_id: str, item_id: str) -> bool:
        tombstones = await self.memory.forget(user_id, item_id)
        await self.tombstones.record(tombstones)
        return bool(tombstones)

    async def forget_episode(self, user_id: str, episode_id: str) -> bool:
        if not await self.temporal.forget_episode(user_id, episode_id):
            return False
        tombstone = Tombstone(user_id=user_id, key=episode_key(episode_id), at=self.clock())
        await self.tombstones.record([tombstone])
        return True

    async def correct(self, user_id: str, item_id: str, text: str) -> MemoryItem:
        """ "That's wrong, I moved": the new version replaces the old, which stays in history."""
        history = await self.memory.history(user_id, item_id)
        if not history:
            raise KeyError(item_id)
        current = history[-1]
        candidate = MemoryCandidate(
            user_id=user_id, text=text, category=current.category, source="user_web",
            observed_at=self.clock(), confidence=1.0,
        )  # fmt: skip
        if decide(candidate, await self.consent(user_id)) is not Verdict.STORE:
            raise NeedsConsent(current.category)
        return await self.memory.update(user_id, current.id, candidate)

    async def card(self, user_id: str) -> MemoryCard:
        grouped: dict[str, list[CardMemory]] = {}
        for item in await self.memory.list_for_user(user_id):
            earlier = (await self.memory.history(user_id, item.id))[:-1]
            grouped.setdefault(item.category, []).append(CardMemory(item=item, earlier=earlier))
        return MemoryCard(memories=grouped, timeline=await self.temporal.timeline(user_id))


def say_recalled(recalled: list[Recalled]) -> str:
    """For voice and SMS: short, plain, one line each, with the date and where it came from."""
    if not recalled:
        return "I don't remember anything about you yet."
    lines = [f"{r.text} ({r.source}, {r.when:%-d %b})" for r in recalled]
    return "Here's what I remember: " + "; ".join(lines) + "."
