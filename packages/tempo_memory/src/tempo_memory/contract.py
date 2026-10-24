"""The MemoryPort contract, as a reusable pytest suite. Every backend must pass it.

Subclass `MemoryPortContract` in a test module and provide a `store` fixture built with the
suite's `clock` fixture (see tests/contract/test_memory_port.py). A new backend is done when
its subclass is green.
"""

# ruff: noqa: S101  (a test suite: assert is the point)

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from tempo_memory.models import MemoryCandidate, Trust
from tempo_memory.port import MemoryPort, UntrustedMemory

NOW = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)


class FakeClock:
    def __init__(self, now: datetime = NOW) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def said(text: str, **overrides: Any) -> MemoryCandidate:
    fields: dict[str, Any] = {
        "user_id": "u_1", "text": text, "category": "preference", "source": "user_voice",
        "observed_at": NOW, "confidence": 0.95,
    }  # fmt: skip
    return MemoryCandidate(**(fields | overrides))


class MemoryPortContract:
    @pytest.fixture
    def clock(self) -> FakeClock:
        return FakeClock()

    async def test_add_then_search_returns_item_with_provenance(self, store: MemoryPort) -> None:
        added = await store.add(said("prefers phone updates"))
        await store.add(said("commutes Oxford to Paddington", category="journey"))

        hits = await store.search("u_1", "how should I send updates?")

        assert hits[0].item == added
        assert (added.source, added.trust, added.observed_at) == ("user_voice", Trust.TRUSTED, NOW)
        assert 0 < hits[0].score <= 1.0001
        assert "commutes Oxford to Paddington" not in [h.item.text for h in hits]

    async def test_search_is_scoped_to_user(self, store: MemoryPort) -> None:
        await store.add(said("lives in Didcot", user_id="u_a", category="household"))

        assert await store.search("u_b", "lives in Didcot") == []
        assert await store.list_for_user("u_b") == []

    async def test_forget_removes_from_search_and_list(self, store: MemoryPort) -> None:
        item = await store.add(said("lives in Didcot", category="household"))
        kept = await store.add(said("prefers phone updates"))

        tombstones = await store.forget("u_1", item.id)

        assert [(t.user_id, t.key) for t in tombstones] == [("u_1", item.key)]
        assert await store.search("u_1", "lives in Didcot") == []
        assert await store.list_for_user("u_1") == [kept]
        assert await store.history("u_1", item.id) == []

    async def test_update_supersedes_and_keeps_history(self, store: MemoryPort) -> None:
        old = await store.add(said("lives in Didcot", category="household"))
        moved = said("lives in Oxford", category="household", observed_at=NOW + timedelta(days=1))

        new = await store.update("u_1", old.id, moved)

        assert [i.text for i in await store.list_for_user("u_1")] == ["lives in Oxford"]
        assert [h.item.text for h in await store.search("u_1", "where do I live?")] == [
            "lives in Oxford"
        ]
        history = await store.history("u_1", new.id)
        assert [v.text for v in history] == ["lives in Didcot", "lives in Oxford"]
        assert (history[0].superseded_by, history[0].observed_at) == (new.id, NOW)
        assert history[-1].superseded_by is None

    async def test_forget_after_update_removes_every_version(self, store: MemoryPort) -> None:
        old = await store.add(said("lives in Didcot", category="household"))
        new = await store.update("u_1", old.id, said("lives in Oxford", category="household"))

        tombstones = await store.forget("u_1", new.id)

        assert {t.key for t in tombstones} == {old.key, new.key}
        assert await store.history("u_1", new.id) == []
        assert await store.search("u_1", "lives in Didcot") == []

    async def test_expired_memories_are_not_returned(
        self, store: MemoryPort, clock: FakeClock
    ) -> None:
        await store.add(said("has a hospital appointment on Monday", category="health"))
        clock.now = NOW + timedelta(days=31)  # sensitive memories keep for 30 days

        assert await store.list_for_user("u_1") == []
        assert await store.search("u_1", "hospital appointment") == []

    async def test_untrusted_content_is_refused(self, store: MemoryPort) -> None:
        planted = said("customer prefers vouchers", source="company_message", confidence=1.0)

        with pytest.raises(UntrustedMemory):
            await store.add(planted)
        assert await store.list_for_user("u_1") == []

    async def test_another_users_memory_cannot_be_changed(self, store: MemoryPort) -> None:
        item = await store.add(said("prefers phone updates", user_id="u_a"))

        with pytest.raises(KeyError):
            await store.update("u_b", item.id, said("prefers email", user_id="u_b"))
        assert await store.forget("u_b", item.id) == []
        assert await store.history("u_b", item.id) == []
        assert await store.list_for_user("u_a") == [item]
