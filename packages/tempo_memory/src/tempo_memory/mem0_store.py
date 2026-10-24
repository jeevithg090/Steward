"""Personal memory on Mem0 (Apache-2.0), behind the same MemoryPort as the SQL fallback.

- Mem0 never extracts (`infer=False`): what becomes a memory is the Memory Gate's decision, not a
  model's. The LLM setting (Cortex) is there only because Mem0 requires one.
- Telemetry is off, and Mem0's files live in our data directory, not ~/.mem0.
- Provenance and earlier versions ride in the memory's metadata, so "forget" deletes them with
  it; Mem0's own history table keeps old text after a delete, so we purge those rows too.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from tempo_memory.embedding import DIMS, HashingEmbedder
from tempo_memory.gate import to_item
from tempo_memory.in_memory import is_current, tombstones_for, utc_now
from tempo_memory.models import MemoryCandidate, MemoryItem, Tombstone
from tempo_memory.port import MIN_SCORE, MemoryHit, admit

Embedder = Literal["hashing", "fastembed", "gemini"]
OFFLINE_LLM_URL = "http://127.0.0.1:9/v1"  # never called: infer=False
_PROVENANCE = "tempo"
_VERSIONS = "tempo_versions"


def load_mem0(data_dir: Path) -> Any:
    """Import Mem0 with telemetry off. Returns the AsyncMemory class."""
    os.environ["MEM0_TELEMETRY"] = "False"
    os.environ.setdefault("MEM0_DIR", str(data_dir.absolute()))
    import mem0.memory.main as main
    import mem0.memory.telemetry as telemetry

    telemetry.MEM0_TELEMETRY = False  # in case Mem0 was imported before us
    main.MEM0_TELEMETRY = False
    logging.getLogger("mem0").setLevel(logging.ERROR)  # optional-extra notices at start-up
    return main.AsyncMemory


def mem0_config(
    *,
    data_dir: Path,
    database_url: str | None = None,
    collection: str = "tempo_memories",
    llm_base_url: str | None = None,
    llm_api_key: str | None = None,
    llm_model: str = "claude-haiku-5-5",
    embedder: Embedder = "hashing",
    embedder_api_key: str | None = None,
) -> dict[str, Any]:
    """(check every key against Mem0's docs when upgrading; tested against mem0ai 2.2.1)"""
    dims, embedder_config = _embedder(embedder, embedder_api_key)
    store: dict[str, Any] = {"collection_name": collection, "embedding_model_dims": dims}
    if database_url is not None:  # pgvector on our Postgres (psycopg 3 URL)
        url = database_url.replace("postgresql+asyncpg://", "postgresql://")
        vector_store = {"provider": "pgvector", "config": store | {"connection_string": url}}
    else:  # embedded Qdrant on disk: no server
        qdrant = {"path": str(data_dir / "qdrant"), "on_disk": True}
        vector_store = {"provider": "qdrant", "config": store | qdrant}
    llm = {
        "model": llm_model,
        "api_key": llm_api_key or "unused",
        "openai_base_url": llm_base_url or OFFLINE_LLM_URL,
    }
    return {
        "vector_store": vector_store,
        "llm": {"provider": "openai", "config": llm},
        "embedder": embedder_config,
        "history_db_path": str(data_dir / "history.db"),
        "version": "v1.1",
    }


def _embedder(kind: Embedder, api_key: str | None) -> tuple[int, dict[str, Any]]:
    if kind == "fastembed":  # local ONNX; needs mem0ai[extras]
        config: dict[str, Any] = {"model": "BAAI/bge-small-en-v1.5", "embedding_dims": 384}
        return 384, {"provider": "fastembed", "config": config}
    if kind == "gemini":  # free tier; needs google-genai
        config = {"model": "models/gemini-embedding-001", "api_key": api_key, "embedding_dims": 768}
        return 768, {"provider": "gemini", "config": config}
    # Ours, swapped in after start-up; the placeholder provider is never called.
    return DIMS, {"provider": "openai", "config": {"api_key": "unused", "embedding_dims": DIMS}}


class _Mem0Embedding:
    """Mem0's embedder interface over our offline HashingEmbedder."""

    def __init__(self, embedder: HashingEmbedder) -> None:
        self.embedder = embedder

    def embed(self, text: str, memory_action: str | None = None) -> list[float]:
        return self.embedder.embed(text)


class Mem0Memory:
    def __init__(self, memory: Any, *, clock: Callable[[], datetime] = utc_now) -> None:
        self.memory = memory
        self.clock = clock

    @classmethod
    def create(
        cls,
        config: dict[str, Any],
        *,
        data_dir: Path,
        hashing: HashingEmbedder | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> Mem0Memory:
        data_dir.mkdir(parents=True, exist_ok=True)
        memory = load_mem0(data_dir).from_config(config)
        if config["embedder"]["provider"] == "openai":  # our placeholder: use the hashing one
            memory.embedding_model = _Mem0Embedding(hashing or HashingEmbedder())
        return cls(memory, clock=clock)

    async def add(self, candidate: MemoryCandidate) -> MemoryItem:
        admit(candidate)
        provenance = to_item(candidate, item_id="pending")
        result = await self.memory.add(
            candidate.text,
            user_id=candidate.user_id,
            metadata={_PROVENANCE: _provenance(provenance), _VERSIONS: []},
            infer=False,
        )
        return provenance.model_copy(update={"id": result["results"][0]["id"]})

    async def update(self, user_id: str, item_id: str, candidate: MemoryCandidate) -> MemoryItem:
        found = await self._get(user_id, item_id)
        if found is None or candidate.user_id != user_id:
            raise KeyError(item_id)
        admit(candidate)
        current, versions = found
        versions.append(current.model_copy(update={"superseded_by": item_id}))
        new = to_item(candidate, item_id=item_id)
        await self.memory.update(
            item_id,
            text=candidate.text,
            metadata={
                _PROVENANCE: _provenance(new),
                _VERSIONS: [v.model_dump(mode="json") for v in versions],
            },
        )
        return new

    async def search(self, user_id: str, query: str, *, limit: int = 5) -> list[MemoryHit]:
        found = await self.memory.search(
            query, top_k=limit * 2, filters={"user_id": user_id}, threshold=MIN_SCORE
        )
        now = self.clock()
        hits = [
            MemoryHit(item=item, score=float(row["score"]))
            for row in found["results"]
            if (item := _item(row)) is not None and is_current(item, now)
        ]
        return sorted(hits, key=lambda h: h.score, reverse=True)[:limit]

    async def list_for_user(self, user_id: str) -> list[MemoryItem]:
        found = await self.memory.get_all(filters={"user_id": user_id}, top_k=1000)
        now = self.clock()
        items = [i for row in found["results"] if (i := _item(row)) is not None]
        return sorted(
            [i for i in items if is_current(i, now)], key=lambda i: i.observed_at, reverse=True
        )

    async def history(self, user_id: str, item_id: str) -> list[MemoryItem]:
        found = await self._get(user_id, item_id)
        if found is None:
            return []
        current, versions = found
        return [*versions, current]

    async def forget(self, user_id: str, item_id: str) -> list[Tombstone]:
        chain = await self.history(user_id, item_id)
        if not chain:
            return []
        await self.memory.delete(item_id)
        db = self.memory.db  # Mem0 keeps the old and new text of every change here
        with db._lock:
            db.connection.execute("DELETE FROM history WHERE memory_id = ?", (item_id,))
            db.connection.commit()
        return tombstones_for(chain, self.clock())

    async def _get(self, user_id: str, item_id: str) -> tuple[MemoryItem, list[MemoryItem]] | None:
        row = await self.memory.get(item_id)
        item = None if row is None else _item(row)
        if item is None or item.user_id != user_id:
            return None
        versions = row.get("metadata", {}).get(_VERSIONS, [])
        return item, [MemoryItem.model_validate(v) for v in versions]


def _provenance(item: MemoryItem) -> dict[str, Any]:
    return item.model_dump(mode="json", exclude={"id", "user_id", "text"})


def _item(row: dict[str, Any]) -> MemoryItem | None:
    """A Mem0 row as a MemoryItem; rows Tempo didn't write (no provenance) are ignored."""
    provenance = (row.get("metadata") or {}).get(_PROVENANCE)
    if provenance is None:
        return None
    return MemoryItem.model_validate(
        {**provenance, "id": row["id"], "user_id": row["user_id"], "text": row["memory"]}
    )
