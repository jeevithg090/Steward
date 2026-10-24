"""Temporal memory on Graphiti (Apache-2.0) and Neo4j 5.26: TEMPO_TEMPORAL=graphiti.

- One group per user (`group_id = user_id`), so one person's graph never answers for another.
- Only trusted, structured episodes are written (entities.py), as JSON with the event time as
  `reference_time`. Graphiti's LLM (Cortex, OpenAI-compatible) extracts entities and facts;
  edges it invalidates keep their window, which is what the as-of search reads.
- Embeddings and reranking use our offline embedder, so no second vendor key is needed.
- We use the library inside the Harness, never Graphiti's MCP server (no auth, per its README).
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterable
from datetime import datetime
from typing import TYPE_CHECKING, Any

from tempo_memory.embedding import HashingEmbedder, cosine
from tempo_memory.entities import ENTITY_TYPES, Episode
from tempo_memory.in_memory import utc_now
from tempo_memory.temporal import TemporalFact

if TYPE_CHECKING:
    from graphiti_core import Graphiti
    from graphiti_core.edges import EntityEdge


def _graphiti_classes() -> tuple[type[Any], type[Any], type[Any]]:
    os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
    from graphiti_core import Graphiti
    from graphiti_core.cross_encoder.client import CrossEncoderClient
    from graphiti_core.embedder.client import EmbedderClient

    return Graphiti, EmbedderClient, CrossEncoderClient


def connect(
    *,
    uri: str,
    user: str,
    password: str,
    llm_base_url: str,
    llm_api_key: str,
    model: str,
    small_model: str | None = None,
    embedder: HashingEmbedder | None = None,
) -> Graphiti:
    """(check) Cortex must accept `response_format: json_schema` for Graphiti's extraction."""
    graphiti_cls, embedder_base, reranker_base = _graphiti_classes()
    from graphiti_core.llm_client.config import LLMConfig
    from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

    hashing = embedder or HashingEmbedder()

    class OfflineEmbedder(embedder_base):  # type: ignore[misc,valid-type]
        async def create(self, input_data: Any) -> list[float]:
            text = input_data if isinstance(input_data, str) else " ".join(map(str, input_data))
            return hashing.embed(text)

        async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
            return [hashing.embed(t) for t in input_data_list]

    class OfflineReranker(reranker_base):  # type: ignore[misc,valid-type]
        async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
            q = hashing.embed(query)
            scored = [(p, cosine(q, hashing.embed(p))) for p in passages]
            return sorted(scored, key=lambda ps: ps[1], reverse=True)

    llm = OpenAIGenericClient(
        LLMConfig(api_key=llm_api_key, model=model, base_url=llm_base_url, small_model=small_model),
        structured_output_mode="json_schema",
    )
    graphiti: Graphiti = graphiti_cls(
        uri, user, password, llm_client=llm, embedder=OfflineEmbedder(),
        cross_encoder=OfflineReranker(),
    )  # fmt: skip
    return graphiti


class GraphitiTemporal:
    def __init__(self, graphiti: Graphiti, *, clock: Callable[[], datetime] = utc_now) -> None:
        self.graphiti = graphiti
        self.clock = clock

    async def write(self, episode: Episode) -> list[TemporalFact]:
        from graphiti_core.nodes import EpisodeType

        result = await self.graphiti.add_episode(
            name=f"{episode.event}:{episode.id}",
            episode_body=episode.model_dump_json(exclude={"id", "user_id"}),
            source=EpisodeType.json,
            source_description="Tempo case event (structured by Tempo's code, trusted)",
            reference_time=episode.at,
            group_id=episode.user_id,
            uuid=episode.id,
            entity_types=ENTITY_TYPES,
        )
        return await self._facts(episode.user_id, result.edges)

    async def search(
        self, user_id: str, query: str, *, as_of: datetime | None = None, limit: int = 5
    ) -> list[TemporalFact]:
        at = as_of or self.clock()
        edges = await self.graphiti.search(query, group_ids=[user_id], num_results=limit * 3)
        facts = await self._facts(user_id, edges)
        return [f for f in facts if f.true_at(at)][:limit]

    async def timeline(self, user_id: str) -> list[TemporalFact]:
        from graphiti_core.edges import EntityEdge

        edges = await EntityEdge.get_by_group_ids(self.graphiti.driver, [user_id])
        facts = await self._facts(user_id, edges)
        return sorted(facts, key=lambda f: (f.valid_from, f.id))

    async def forget_episode(self, user_id: str, episode_id: str) -> bool:
        from graphiti_core.errors import NodeNotFoundError
        from graphiti_core.nodes import EpisodicNode

        try:
            episode = await EpisodicNode.get_by_uuid(self.graphiti.driver, episode_id)
        except NodeNotFoundError:
            return False
        if episode.group_id != user_id:
            return False
        await self.graphiti.remove_episode(episode_id)  # its edges, and nodes only it mentioned
        return True

    async def forget_user(self, user_id: str) -> None:
        from graphiti_core.utils.maintenance.graph_data_operations import clear_data

        await clear_data(self.graphiti.driver, group_ids=[user_id])

    async def _facts(self, user_id: str, edges: Iterable[EntityEdge]) -> list[TemporalFact]:
        from graphiti_core.nodes import EntityNode

        edges = [e for e in edges if e.group_id == user_id]
        uuids = list({u for e in edges for u in (e.source_node_uuid, e.target_node_uuid)})
        names = {n.uuid: n.name for n in await EntityNode.get_by_uuids(self.graphiti.driver, uuids)}
        return [
            TemporalFact(
                id=e.uuid,
                user_id=user_id,
                kind=e.name.lower(),
                subject=names.get(e.source_node_uuid, "?"),
                predicate=e.name.lower(),
                object=names.get(e.target_node_uuid, "?"),
                valid_from=e.valid_at or e.created_at,
                valid_to=e.invalid_at or e.expired_at,
                episode_id=e.episodes[0] if e.episodes else "",
            )
            for e in edges
        ]
