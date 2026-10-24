"""Graphiti on Neo4j (S3.8): needs `docker compose up -d neo4j` and Cortex keys, else skipped.

Graphiti's extraction is an LLM, so this checks the round trip and isolation, not exact wording;
the deterministic TemporalPort contract runs on the SQL fallback.
"""

from __future__ import annotations

import uuid

import pytest

from tempo_adapters.settings import Settings
from tempo_memory.graph_store import GraphitiTemporal, connect
from tempo_memory.temporal_contract import FIRST, MOVED

SETTINGS = Settings()
pytestmark = pytest.mark.skipif(
    not (SETTINGS.neo4j_uri and SETTINGS.neo4j_password and SETTINGS.cortex_base_url
         and SETTINGS.snowflake_pat),
    reason="needs Neo4j (NEO4J_URI, NEO4J_PASSWORD) and Cortex (SNOWFLAKE_ACCOUNT, SNOWFLAKE_PAT)",
)  # fmt: skip


async def test_graphiti_neo4j_roundtrip() -> None:
    assert SETTINGS.neo4j_uri and SETTINGS.neo4j_password and SETTINGS.cortex_base_url
    assert SETTINGS.snowflake_pat
    graphiti = connect(
        uri=SETTINGS.neo4j_uri,
        user=SETTINGS.neo4j_user,
        password=SETTINGS.neo4j_password.get_secret_value(),
        llm_base_url=SETTINGS.cortex_base_url,
        llm_api_key=SETTINGS.snowflake_pat.get_secret_value(),
        model=SETTINGS.cortex_fast_model,
    )
    await graphiti.build_indices_and_constraints()
    temporal = GraphitiTemporal(graphiti)
    user = f"it_{uuid.uuid4().hex[:8]}"
    first = FIRST.model_copy(update={"user_id": user, "id": f"{user}_1"})
    moved = MOVED.model_copy(update={"user_id": user, "id": f"{user}_2"})
    try:
        await temporal.write(first)
        await temporal.write(moved)

        timeline = await temporal.timeline(user)
        assert timeline
        assert {f.episode_id for f in timeline} <= {first.id, moved.id}
        assert await temporal.timeline("someone_else") == []
        assert await temporal.forget_episode(user, moved.id) is True
    finally:
        await temporal.forget_user(user)
        await graphiti.close()
