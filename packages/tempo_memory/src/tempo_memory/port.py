"""One MemoryPort for every personal-memory backend (Mem0, the SQL fallback, in-memory), so a
slow integration never blocks a mission. The contract suite runs against all of them."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from pydantic import BaseModel, ConfigDict

from tempo_memory.models import MemoryCandidate, MemoryItem, Tombstone, Trust

MIN_SCORE = 0.1  # below this a search hit is noise


class MemoryHit(BaseModel):
    model_config = ConfigDict(frozen=True)

    item: MemoryItem
    score: float


class UntrustedMemory(ValueError):
    """Raised by every store for an untrusted candidate: the Gate should never have sent it."""


class MemoryPort(Protocol):
    async def add(self, candidate: MemoryCandidate) -> MemoryItem: ...

    async def update(self, user_id: str, item_id: str, candidate: MemoryCandidate) -> MemoryItem:
        """Replace a memory ("That's wrong, I moved"). The old version stays in history."""
        ...

    async def search(self, user_id: str, query: str, *, limit: int = 5) -> list[MemoryHit]: ...

    async def list_for_user(self, user_id: str) -> list[MemoryItem]:
        """Current, unexpired memories, newest first."""
        ...

    async def history(self, user_id: str, item_id: str) -> list[MemoryItem]:
        """Every version of a memory, oldest first; earlier ones carry `superseded_by`."""
        ...

    async def forget(self, user_id: str, item_id: str) -> list[Tombstone]:
        """Hard-delete a memory and all its versions. Returns one tombstone per version's key,
        for the Mesh and the other stores; nothing of the content survives."""
        ...


class TombstoneLog(Protocol):
    async def record(self, tombstones: Sequence[Tombstone]) -> None: ...

    async def for_user(self, user_id: str) -> list[Tombstone]: ...


def admit(candidate: MemoryCandidate) -> None:
    if candidate.trust is Trust.UNTRUSTED:
        raise UntrustedMemory(f"{candidate.source} content is evidence, never a personal memory")
