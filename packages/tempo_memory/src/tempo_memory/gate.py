"""The Memory Gate: what Tempo is allowed to remember (spec §17.3). Pure and fully tested.

Memory poisoning (planting "facts" through content an agent reads) is the newest attack on
assistants, so personal memory accepts only the person's own words and verified official data.
"""

from __future__ import annotations

from collections.abc import Iterable

from tempo_core.consent import ConsentState
from tempo_memory.models import TTL, MemoryCandidate, MemoryItem, Tombstone, Trust, Verdict

SENSITIVE: frozenset[str] = frozenset({"health", "immigration", "finance"})  # 30-day expiry
# Categories Tempo stores only after the person says yes to remembering them. `access` (how to
# speak with someone) is health-adjacent, so it is opt-in too, but it never expires.
OPT_IN: frozenset[str] = SENSITIVE | {"access"}
READ_BACK_BELOW = 0.8


def consent_scope(category: str) -> str:
    return f"memory.{category}"


def decide(candidate: MemoryCandidate, consent: ConsentState) -> Verdict:
    if candidate.trust is Trust.UNTRUSTED:
        return Verdict.EPISODE_ONLY
    if candidate.category in OPT_IN and not consent.allows(consent_scope(candidate.category)):
        # The person can opt in when they say it themselves; official data never forces it in.
        return Verdict.ASK_USER if candidate.source.startswith("user_") else Verdict.REJECT
    if candidate.confidence < READ_BACK_BELOW:
        return Verdict.ASK_USER
    return Verdict.STORE


def to_item(candidate: MemoryCandidate, *, item_id: str) -> MemoryItem:
    """The stored form of a candidate the gate said STORE to."""
    ttl = TTL[candidate.category]
    return MemoryItem(
        id=item_id,
        user_id=candidate.user_id,
        key=candidate.key,
        text=candidate.text,
        category=candidate.category,
        source=candidate.source,
        trust=candidate.trust,
        observed_at=candidate.observed_at,
        confidence=candidate.confidence,
        consent_scope=consent_scope(candidate.category) if candidate.category in OPT_IN else None,
        expires_at=candidate.observed_at + ttl if ttl is not None else None,
    )


def visible(items: Iterable[MemoryItem], tombstones: Iterable[Tombstone]) -> list[MemoryItem]:
    """Merge items with forgets: a tombstone hides every copy observed at or before it."""
    forgotten: dict[tuple[str, str], Tombstone] = {}
    for tombstone in tombstones:
        current = forgotten.get((tombstone.user_id, tombstone.key))
        if current is None or tombstone.at > current.at:
            forgotten[(tombstone.user_id, tombstone.key)] = tombstone
    return [
        item
        for item in items
        if (t := forgotten.get((item.user_id, item.key))) is None or item.observed_at > t.at
    ]
