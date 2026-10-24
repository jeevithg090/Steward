"""Temporal memory: what was true, and when (spec §17.2 layer 4).

A newer fact about the same thing (the engineer slot moved) closes the old one's validity window
instead of deleting it, so "what was my appointment on 13 Oct?" has an answer and the Memory Card
can strike the old one through. The SQL fallback and Graphiti sit behind one TemporalPort.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime
from typing import Any, Protocol

import structlog
from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from tempo_core.delays import LONDON
from tempo_memory.embedding import HashingEmbedder, cosine
from tempo_memory.entities import (
    EPISODE,
    AppointmentBooked,
    DeadlineSet,
    Episode,
    OutcomeRecorded,
    PromiseMade,
    ReferenceGiven,
)
from tempo_memory.in_memory import utc_now
from tempo_memory.port import MIN_SCORE

log = structlog.get_logger("tempo.memory")
SINGLE_VALUED = frozenset({"scheduled_for", "promised", "due", "outcome"})  # newest wins


class TemporalFact(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    user_id: str
    kind: str  # the episode's event: appointment, promise, deadline, reference, outcome
    subject: str
    predicate: str
    object: str
    valid_from: AwareDatetime
    valid_to: AwareDatetime | None = None
    superseded_by: str | None = None
    episode_id: str

    @property
    def text(self) -> str:
        return f"{self.subject} {self.predicate.replace('_', ' ')} {self.object}"

    def true_at(self, at: datetime) -> bool:
        return self.valid_from <= at and (self.valid_to is None or at < self.valid_to)


class TemporalPort(Protocol):
    async def write(self, episode: Episode) -> list[TemporalFact]: ...

    async def search(
        self, user_id: str, query: str, *, as_of: datetime | None = None, limit: int = 5
    ) -> list[TemporalFact]:
        """Facts true at `as_of` (default: now) that match the query, best first."""
        ...

    async def timeline(self, user_id: str) -> list[TemporalFact]:
        """Every fact, superseded ones included, oldest first: the Memory Card's timeline."""
        ...

    async def forget_episode(self, user_id: str, episode_id: str) -> bool:
        """Hard-delete an episode and every fact derived from it."""
        ...

    async def forget_user(self, user_id: str) -> None: ...


class UntrustedEpisode(ValueError):
    pass


def trusted_episode(payload: Mapping[str, Any]) -> Episode:
    """Validate a payload as one of Tempo's own episodes; anything else is refused and audited."""
    try:
        return EPISODE.validate_python(payload)
    except ValidationError as e:
        log.warning("memory_rejected", reason="untrusted_episode", source=str(payload.get("event")))
        raise UntrustedEpisode("not a structured Tempo episode") from e


def _when(at: datetime) -> str:
    return at.astimezone(LONDON).strftime("%d %b %Y %H:%M")


def triples(episode: Episode) -> list[tuple[str, str, str]]:
    """The facts an episode states, in plain words (subject, predicate, object)."""
    match episode:
        case AppointmentBooked():
            slot = f"{_when(episode.starts_at)} to {_when(episode.ends_at)[-5:]}"
            return [(f"{episode.company} {episode.what}", "scheduled_for", slot)]
        case PromiseMade():
            ref = f", ref {episode.reference}" if episode.reference else ""
            due = _when(episode.due_by)[:11]
            return [(episode.company, "promised", f"£{episode.amount_gbp} by {due}{ref}")]
        case DeadlineSet():
            return [(episode.what, "due", _when(episode.due_at))]
        case ReferenceGiven():
            return [(episode.company, "reference", episode.reference)]
        case OutcomeRecorded():
            paid = f" £{episode.amount_gbp}" if episode.amount_gbp is not None else ""
            return [(episode.company, "outcome", f"{episode.state}{paid}")]


def derive(episode: Episode) -> list[TemporalFact]:
    return [
        TemporalFact(
            id=uuid.uuid4().hex, user_id=episode.user_id, kind=episode.event, subject=s,
            predicate=p, object=o, valid_from=episode.at, episode_id=episode.id,
        )
        for s, p, o in triples(episode)
    ]  # fmt: skip


def reconcile(group: Iterable[TemporalFact]) -> list[TemporalFact]:
    """Re-chain one (user, subject, predicate) group by time, whatever order facts arrived in:
    each single-valued fact is valid until the next one starts."""
    ordered = sorted(group, key=lambda f: (f.valid_from, f.id))
    if not ordered or ordered[0].predicate not in SINGLE_VALUED:
        return ordered
    nxt: list[TemporalFact | None] = [*ordered[1:], None]
    return [
        f.model_copy(
            update={
                "valid_to": n.valid_from if n else None,
                "superseded_by": n.id if n else None,
            }
        )
        for f, n in zip(ordered, nxt, strict=True)
    ]


def rank(
    facts: Iterable[TemporalFact], query: str, embedder: HashingEmbedder, limit: int
) -> list[TemporalFact]:
    q = embedder.embed(query)
    scored = [(cosine(q, embedder.embed(f"{f.kind} {f.text}")), f) for f in facts]
    scored = [(s, f) for s, f in scored if s >= MIN_SCORE]
    return [f for _, f in sorted(scored, key=lambda sf: sf[0], reverse=True)[:limit]]


class InMemoryTemporal:
    """The SQL fallback's in-process twin."""

    def __init__(
        self, *, embedder: HashingEmbedder | None = None, clock: Callable[[], datetime] = utc_now
    ) -> None:
        self.embedder = embedder or HashingEmbedder()
        self.clock = clock
        self.episodes: dict[str, Episode] = {}
        self.facts: dict[str, TemporalFact] = {}

    async def write(self, episode: Episode) -> list[TemporalFact]:
        if episode.id in self.episodes:
            return [f for f in self.facts.values() if f.episode_id == episode.id]  # replayed
        self.episodes[episode.id] = episode
        new = derive(episode)
        self.facts.update({f.id: f for f in new})
        self._reconcile({(f.user_id, f.subject, f.predicate) for f in new})
        return [self.facts[f.id] for f in new]

    async def search(
        self, user_id: str, query: str, *, as_of: datetime | None = None, limit: int = 5
    ) -> list[TemporalFact]:
        at = as_of or self.clock()
        valid = [f for f in self.facts.values() if f.user_id == user_id and f.true_at(at)]
        return rank(valid, query, self.embedder, limit)

    async def timeline(self, user_id: str) -> list[TemporalFact]:
        mine = [f for f in self.facts.values() if f.user_id == user_id]
        return sorted(mine, key=lambda f: (f.valid_from, f.id))

    async def forget_episode(self, user_id: str, episode_id: str) -> bool:
        episode = self.episodes.get(episode_id)
        if episode is None or episode.user_id != user_id:
            return False
        del self.episodes[episode_id]
        gone = [f for f in self.facts.values() if f.episode_id == episode_id]
        for f in gone:
            del self.facts[f.id]
        self._reconcile({(f.user_id, f.subject, f.predicate) for f in gone})
        return True

    async def forget_user(self, user_id: str) -> None:
        self.episodes = {k: e for k, e in self.episodes.items() if e.user_id != user_id}
        self.facts = {k: f for k, f in self.facts.items() if f.user_id != user_id}

    def _reconcile(self, groups: set[tuple[str, str, str]]) -> None:
        for user_id, subject, predicate in groups:
            group = [
                f
                for f in self.facts.values()
                if (f.user_id, f.subject, f.predicate) == (user_id, subject, predicate)
            ]
            self.facts.update({f.id: f for f in reconcile(group)})
