"""Mem0 settings (S3.7): telemetry off, files in our data dir, Postgres or embedded Qdrant."""

from __future__ import annotations

import os
from pathlib import Path

from tempo_memory.embedding import DIMS
from tempo_memory.mem0_store import OFFLINE_LLM_URL, load_mem0, mem0_config


def test_mem0_config_has_telemetry_disabled(tmp_path: Path) -> None:
    load_mem0(tmp_path)
    import mem0.memory.main as main
    import mem0.memory.setup as setup
    import mem0.memory.telemetry as telemetry

    assert os.environ["MEM0_TELEMETRY"] == "False"
    assert telemetry.MEM0_TELEMETRY is False
    assert main.MEM0_TELEMETRY is False
    assert Path(setup.mem0_dir) != Path.home() / ".mem0"


def test_offline_config_uses_embedded_qdrant_and_never_calls_a_model(tmp_path: Path) -> None:
    config = mem0_config(data_dir=tmp_path)

    assert config["vector_store"]["provider"] == "qdrant"
    assert config["vector_store"]["config"]["path"] == str(tmp_path / "qdrant")
    assert config["vector_store"]["config"]["embedding_model_dims"] == DIMS
    assert config["llm"]["config"]["openai_base_url"] == OFFLINE_LLM_URL
    assert config["history_db_path"] == str(tmp_path / "history.db")


def test_live_config_uses_pgvector_and_cortex(tmp_path: Path) -> None:
    config = mem0_config(
        data_dir=tmp_path,
        database_url="postgresql+asyncpg://tempo@db:5432/tempo",
        llm_base_url="https://acct.snowflakecomputing.com/api/v2/cortex/v1",
        llm_api_key="pat",
        embedder="gemini",
        embedder_api_key="key",
    )

    assert config["vector_store"] == {
        "provider": "pgvector",
        "config": {
            "collection_name": "tempo_memories",
            "embedding_model_dims": 768,
            "connection_string": "postgresql://tempo@db:5432/tempo",
        },
    }
    assert config["llm"]["config"]["openai_base_url"].endswith("/api/v2/cortex/v1")
    assert config["embedder"]["provider"] == "gemini"
    assert mem0_config(data_dir=tmp_path, embedder="fastembed")["embedder"]["config"] == {
        "model": "BAAI/bge-small-en-v1.5",
        "embedding_dims": 384,
    }
