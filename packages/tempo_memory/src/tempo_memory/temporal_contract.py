"""The TemporalPort contract as a reusable pytest suite (deterministic backends: the SQL
fallback and its in-process twin). Subclass it and provide a `temporal` fixture."""

# ruff: noqa: S101  (a test suite: assert is the point)

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from tempo_core.delays import LONDON
from tempo_memory.entities import AppointmentBooked, PromiseMade
from tempo_memory.temporal import TemporalPort


def london(day: int, hour: int = 9, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, 0, tzinfo=LONDON)


def booked(episode_id: str, *, at: datetime, day: int, **overrides: Any) -> AppointmentBooked:
    fields: dict[str, Any] = {
        "id": episode_id, "user_id": "u_1", "at": at, "company": "Broadbandly",
        "what": "engineer visit", "starts_at": london(day, 8), "ends_at": london(day, 12),
    }  # fmt: skip
    return AppointmentBooked(**(fields | overrides))


FIRST = booked("ep_1", at=london(10), day=12)  # booked on 10 Oct for 12 Oct
MOVED = booked("ep_2", at=london(15, 14), day=19)  # moved on 15 Oct to 19 Oct
PROMISE = PromiseMade(
    id="ep_3", user_id="u_1", at=london(24, 14), company="Broadbandly",
    amount_gbp=Decimal("73.67"), due_by=london(30, 0, month=11), reference="BB-4417",
)  # fmt: skip


class TemporalPortContract:
    async def test_new_appointment_supersedes_old_and_keeps_validity_window(
        self, temporal: TemporalPort
    ) -> None:
        await temporal.write(FIRST)
        await temporal.write(MOVED)

        old, new = await temporal.timeline("u_1")

        assert old.object == "12 Oct 2026 08:00 to 12:00"
        assert (old.valid_from, old.valid_to, old.superseded_by) == (FIRST.at, MOVED.at, new.id)
        assert (new.object, new.valid_to, new.superseded_by) == (
            "19 Oct 2026 08:00 to 12:00",
            None,
            None,
        )

    async def test_as_of_query_returns_fact_true_at_that_time(self, temporal: TemporalPort) -> None:
        await temporal.write(FIRST)
        await temporal.write(MOVED)

        def slots(facts: list[Any]) -> list[str]:
            return [f.object for f in facts]

        q = "my engineer appointment"
        assert slots(await temporal.search("u_1", q, as_of=london(13))) == [
            "12 Oct 2026 08:00 to 12:00"
        ]
        assert slots(await temporal.search("u_1", q, as_of=london(20))) == [
            "19 Oct 2026 08:00 to 12:00"
        ]
        assert await temporal.search("u_1", q, as_of=london(9)) == []  # not booked yet

    async def test_every_fact_links_to_episode(self, temporal: TemporalPort) -> None:
        written = [*await temporal.write(FIRST), *await temporal.write(PROMISE)]

        assert [f.episode_id for f in written] == ["ep_1", "ep_3"]
        assert written[1].text == "Broadbandly promised £73.67 by 30 Nov 2026, ref BB-4417"

    async def test_group_isolation_between_users(self, temporal: TemporalPort) -> None:
        await temporal.write(FIRST)
        await temporal.write(booked("ep_9", at=london(11), day=14, user_id="u_2"))

        assert [f.episode_id for f in await temporal.timeline("u_2")] == ["ep_9"]
        assert [
            f.episode_id for f in await temporal.search("u_2", "engineer visit", as_of=london(13))
        ] == ["ep_9"]
        assert await temporal.forget_episode("u_2", "ep_1") is False  # not theirs

    async def test_forget_user_item_removes_episode_and_derived_facts(
        self, temporal: TemporalPort
    ) -> None:
        await temporal.write(FIRST)
        await temporal.write(MOVED)

        assert await temporal.forget_episode("u_1", "ep_2") is True

        (only,) = await temporal.timeline("u_1")
        assert (only.episode_id, only.valid_to, only.superseded_by) == ("ep_1", None, None)
        assert await temporal.forget_episode("u_1", "ep_2") is False

    async def test_late_episode_lands_in_time_order(self, temporal: TemporalPort) -> None:
        await temporal.write(MOVED)  # another device synced the newer one first
        await temporal.write(FIRST)

        old, new = await temporal.timeline("u_1")

        assert (old.episode_id, old.valid_to, old.superseded_by) == ("ep_1", MOVED.at, new.id)
        assert new.valid_to is None

    async def test_replayed_episode_is_written_once(self, temporal: TemporalPort) -> None:
        first = await temporal.write(FIRST)
        again = await temporal.write(FIRST)

        assert [f.id for f in again] == [f.id for f in first]
        assert len(await temporal.timeline("u_1")) == 1

    async def test_promises_answer_what_was_promised_and_when(self, temporal: TemporalPort) -> None:
        await temporal.write(FIRST)
        await temporal.write(PROMISE)

        (hit, *_) = await temporal.search(
            "u_1", "What did Broadbandly promise me?", as_of=london(25)
        )

        assert (hit.kind, hit.valid_from) == ("promise", PROMISE.at)

    async def test_forget_user_removes_everything(self, temporal: TemporalPort) -> None:
        await temporal.write(FIRST)
        await temporal.write(PROMISE)

        await temporal.forget_user("u_1")

        assert await temporal.timeline("u_1") == []
