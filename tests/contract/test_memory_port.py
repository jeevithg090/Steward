"""The MemoryPort contract (S3.7) against the in-process fallback and real Mem0 (embedded
Qdrant, offline embedder). Postgres runs the same suite in tests/integration."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tempo_memory.contract import FakeClock, MemoryPortContract, said
from tempo_memory.in_memory import InMemoryMemory
from tempo_memory.mem0_store import Mem0Memory, mem0_config


class TestInMemory(MemoryPortContract):
    @pytest.fixture
    def store(self, clock: FakeClock) -> InMemoryMemory:
        return InMemoryMemory(clock=clock)


class TestMem0(MemoryPortContract):
    @pytest.fixture
    def store(self, clock: FakeClock, tmp_path: Path) -> Mem0Memory:
        return Mem0Memory.create(mem0_config(data_dir=tmp_path), data_dir=tmp_path, clock=clock)


async def test_mem0_forget_leaves_no_text_in_its_history(tmp_path: Path) -> None:
    store = Mem0Memory.create(mem0_config(data_dir=tmp_path), data_dir=tmp_path)
    item = await store.add(said("lives in Didcot", category="household"))
    await store.update("u_1", item.id, said("lives in Oxford", category="household"))

    await store.forget("u_1", item.id)

    rows = sqlite3.connect(tmp_path / "history.db").execute("SELECT * FROM history").fetchall()
    assert rows == []
