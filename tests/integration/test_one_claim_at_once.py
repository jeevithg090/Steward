"""Never the same claim twice, even at the same instant (docs/chat.md, "Never the same claim
twice"): two identical requests fired together make one mission, through one door or several.

The in-memory store answers without ever giving the event loop a turn, which hides the race;
Postgres doesn't. So the store here takes a moment over every call, as a database does, and the
control test shows that the old check-then-start really does claim twice under it.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services
from tempo_gateway.missions import MissionService, MissionView, StartMission, StartOfcom

TOKEN, VOICE = "mc-token", "voice-secret"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
USER = "u_margaret"
JOURNEY = {
    "user_id": USER, "display_name": "Margaret", "origin_crs": "OXF", "destination_crs": "PAD",
    "travel_date": "2026-10-23", "departure": "08:12", "fare_gbp": "28.40",
}  # fmt: skip
WITH_FARE = (
    "my 08:12 Oxford to Paddington was 38 minutes late on 23 October 2026, the ticket was £28.40"
)
VISIT = {
    "user_id": USER, "display_name": "Margaret", "operator": "Broadbandly",
    "event_date": "2026-10-19",
}  # fmt: skip


class SlowRepo:
    """The Gateway's store, but every call takes a moment to answer, as a database's does."""

    def __init__(self, inner: Any, delay_s: float = 0.005) -> None:
        self._inner, self._delay_s = inner, delay_s

    def __getattr__(self, name: str) -> Any:
        found = getattr(self._inner, name)
        if not inspect.iscoroutinefunction(found):
            return found

        async def slowly(*args: Any, **kwargs: Any) -> Any:
            await asyncio.sleep(self._delay_s)
            return await found(*args, **kwargs)

        return slowly


def make(tmp_path: Path) -> tuple[FastAPI, MissionService]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, voice_tool_secret=VOICE,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=3600,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    service.deps = replace(service.deps, repo=SlowRepo(service.deps.repo))
    return create_app(service, settings, bus, memory=memory), service


@asynccontextmanager
async def running(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    app, _ = make(tmp_path)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://gw") as client,
    ):
        yield client


async def chat(client: httpx.AsyncClient, text: str, user_id: str = USER) -> dict[str, Any]:
    r = await client.post(
        "/chat", headers=AUTH, json={"user_id": user_id, "display_name": "Margaret", "text": text}
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def missions(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = (await client.get("/missions", headers=AUTH)).json()
    return found


async def test_two_identical_chat_turns_at_the_same_instant_make_one_mission(
    tmp_path: Path,
) -> None:
    async with running(tmp_path) as client:
        first, second = await asyncio.gather(chat(client, WITH_FARE), chat(client, WITH_FARE))
        made = await missions(client)

    assert first["mission"]["id"] == second["mission"]["id"] == made[0]["id"]
    assert len(made) == 1
    assert first["ask"]["request_id"] == second["ask"]["request_id"]  # one ask, one yes to give
    replies = {first["reply"], second["reply"]}
    assert "I'm already on this one. It needs your OK." in replies
    assert first["ask"]["summary"] in replies  # the other turn is the one that started it


async def test_the_same_journey_through_three_doors_at_once_is_one_mission(tmp_path: Path) -> None:
    async with running(tmp_path) as client:
        typed, api, call = await asyncio.gather(
            chat(client, WITH_FARE),
            client.post("/missions", json=JOURNEY, headers=AUTH),
            client.post(
                "/voice/tools/create_mission", json=JOURNEY,
                headers={"X-Tempo-Voice-Secret": VOICE},
            ),
        )  # fmt: skip
        made = await missions(client)

    assert len(made) == 1
    assert typed["mission"]["id"] == api.json()["id"] == call.json()["mission_id"] == made[0]["id"]
    assert api.status_code in (200, 201)


async def test_the_same_missed_visit_twice_at_once_is_one_mission(tmp_path: Path) -> None:
    async with running(tmp_path) as client:
        one, two, typed = await asyncio.gather(
            client.post("/missions/ofcom", json=VISIT, headers=AUTH),
            client.post("/missions/ofcom", json={**VISIT, "operator": "BROADBANDLY"}, headers=AUTH),
            chat(client, "the Broadbandly engineer never came on 19 October 2026"),
        )
        made = await missions(client)

    assert len(made) == 1
    assert one.json()["id"] == two.json()["id"] == typed["mission"]["id"]
    assert sorted((one.status_code, two.status_code)) in ([200, 200], [200, 201])


async def test_two_people_at_the_same_instant_each_get_their_own_claim(tmp_path: Path) -> None:
    """The lock is per person and claim: someone else's identical journey is their own."""
    async with running(tmp_path) as client:
        margaret, ravi = await asyncio.gather(
            chat(client, WITH_FARE), chat(client, WITH_FARE, user_id="u_ravi")
        )

    assert margaret["mission"]["id"] != ravi["mission"]["id"]
    assert margaret["ask"] is not None and ravi["ask"] is not None


async def test_start_once_starts_one_of_five_and_hands_the_rest_the_same_mission(
    tmp_path: Path,
) -> None:
    _, service = make(tmp_path)
    request = StartMission.model_validate(JOURNEY)

    results = await asyncio.gather(*(service.start_once(request) for _ in range(5)))

    assert sum(started for _, started in results) == 1
    assert len({view.id for view, _ in results}) == 1
    assert len(service.mission_ids) == 1


async def test_a_different_claim_never_waits_on_the_lock(tmp_path: Path) -> None:
    _, service = make(tmp_path)
    journey = StartMission.model_validate(JOURNEY)
    visit = StartOfcom.model_validate(VISIT)
    other_train = StartMission.model_validate({**JOURNEY, "departure": "07:58"})

    results = await asyncio.gather(
        service.start_once(journey), service.start_once(visit), service.start_once(other_train)
    )

    assert all(started for _, started in results)
    assert len({view.id for view, _ in results}) == 3


async def test_without_the_lock_this_store_would_claim_twice(tmp_path: Path) -> None:
    """The control: the check and the start with nothing between them, as every door did before
    `start_once`. Under a store that takes a moment, both requests pass the check."""
    _, service = make(tmp_path)
    request = StartMission.model_validate(JOURNEY)

    async def unguarded() -> MissionView:
        return await service.duplicate_of(request) or await service.start(request)

    first, second = await asyncio.gather(unguarded(), unguarded())

    assert first.id != second.id  # two claims for one journey: the race start_once closes
