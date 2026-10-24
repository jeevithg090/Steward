"""Rail sources against fixture responses (fixtures/rail), through httpx.MockTransport."""

from __future__ import annotations

import json
import socket
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest

from tempo_adapters.rail import HspSource, LiveRail, ReplayRail, RttSource, rail_port
from tempo_adapters.settings import Settings
from tempo_core.errors import RailDataUnavailable, ServiceNotFound

RAIL = Path(__file__).resolve().parents[2] / "fixtures" / "rail"
DAY = date(2026, 10, 23)

Handler = Callable[[httpx.Request], httpx.Response]


def load(*parts: str) -> Any:
    return json.loads(RAIL.joinpath(*parts).read_text())


def hsp_handler(seen: list[httpx.Request]) -> Handler:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/serviceMetrics"):
            return httpx.Response(200, json=load("hsp", "service_metrics_OXF_PAD_2026-10-23.json"))
        rid = json.loads(request.content)["rid"]
        path = RAIL / "hsp" / f"service_details_{rid}.json"
        return (
            httpx.Response(200, json=json.loads(path.read_text()))
            if path.exists()
            else httpx.Response(404)
        )

    return handle


def rtt_handler(seen: list[httpx.Request]) -> Handler:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/gb-nr/location":
            return httpx.Response(200, json=load("rtt", "location_OXF_PAD_2026-10-23.json"))
        identity = request.url.params["identity"]
        path = RAIL / "rtt" / f"service_{identity}.json"
        return (
            httpx.Response(200, json=json.loads(path.read_text()))
            if path.exists()
            else httpx.Response(404)
        )

    return handle


def hsp(handler: Handler, **kw: Any) -> HspSource:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return HspSource(http, base_url="https://hsp.example.test/api/v1", **({"api_key": "k"} | kw))


def rtt(handler: Handler) -> RttSource:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return RttSource(http, base_url="https://data.rtt.io", token="t-rtt")


def failing(status: int) -> Handler:
    return lambda request: httpx.Response(status)


# --- HSP -----------------------------------------------------------------------------------------


async def test_hsp_service_metrics_parsing() -> None:
    seen: list[httpx.Request] = []

    await hsp(hsp_handler(seen)).service_delay("OXF", "PAD", DAY, "08:12")

    metrics, details = seen
    assert json.loads(metrics.content) == {
        "from_loc": "OXF",
        "to_loc": "PAD",
        "from_time": "0811",
        "to_time": "0813",
        "from_date": "2026-10-23",
        "to_date": "2026-10-23",
        "days": "WEEKDAY",
    }
    assert metrics.headers["x-apikey"] == "k"
    assert json.loads(details.content) == {"rid": "202610230000001"}


async def test_hsp_service_details_actual_vs_scheduled() -> None:
    journey = await hsp(hsp_handler([])).service_delay("OXF", "PAD", DAY, "0812")

    assert journey.delay_minutes == 38
    assert journey.cancelled is False
    assert journey.source == "hsp:RID:202610230000001"
    assert journey.operator_code == "GW"
    assert journey.scheduled_arrival.isoformat() == "2026-10-23T08:50:00+01:00"
    assert journey.actual_arrival is not None
    assert journey.actual_arrival.isoformat() == "2026-10-23T09:28:00+01:00"


async def test_hsp_cancelled_service() -> None:
    journey = await hsp(hsp_handler([])).service_delay("OXF", "PAD", DAY, "17:42")

    assert journey.cancelled is True
    assert journey.delay_minutes is None
    assert journey.actual_arrival is None


async def test_hsp_uses_basic_auth_without_an_api_key() -> None:
    seen: list[httpx.Request] = []

    await hsp(hsp_handler(seen), api_key=None, basic_auth=("me", "pw")).service_delay(
        "OXF", "PAD", DAY, "08:12"
    )

    assert seen[0].headers["authorization"].startswith("Basic ")
    assert "x-apikey" not in seen[0].headers


async def test_hsp_unknown_departure_is_not_found() -> None:
    with pytest.raises(ServiceNotFound, match="0700"):
        await hsp(hsp_handler([])).service_delay("OXF", "PAD", DAY, "07:00")


# --- Realtime Trains -----------------------------------------------------------------------------


async def test_rtt_finds_the_service_and_its_delay() -> None:
    seen: list[httpx.Request] = []

    journey = await rtt(rtt_handler(seen)).service_delay("OXF", "PAD", DAY, "08:12")

    assert journey.delay_minutes == 38
    assert journey.source == "rtt:gb-nr:X00001:2026-10-23"
    line_up, service = seen
    assert line_up.headers["authorization"] == "Bearer t-rtt"
    assert line_up.url.params["filterTo"] == "PAD"
    assert line_up.url.params["timeFrom"] == "2026-10-23T08:12:00"
    assert service.url.params["identity"] == "X00001"
    assert service.url.params["departureDate"] == "2026-10-23"


async def test_rtt_cancelled_service() -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/gb-nr/location":
            body = load("rtt", "location_OXF_PAD_2026-10-23.json")
            meta = body["services"][0]["scheduleMetadata"]
            meta["identity"], meta["uniqueIdentity"] = "X00002", "gb-nr:X00002:2026-10-23"
            body["services"][0]["temporalData"]["departure"]["scheduleAdvertised"] = (
                "2026-10-23T17:42:00+01:00"
            )
            return httpx.Response(200, json=body)
        return httpx.Response(200, json=load("rtt", "service_X00002.json"))

    journey = await rtt(handle).service_delay("OXF", "PAD", DAY, "1742")

    assert journey.cancelled is True
    assert journey.delay_minutes is None


# --- live fallback -------------------------------------------------------------------------------


async def test_rtt_fallback_used_when_hsp_down() -> None:
    live = LiveRail([("hsp", hsp(failing(503))), ("rtt", rtt(rtt_handler([])))])

    journey = await live.service_delay("OXF", "PAD", DAY, "08:12")

    assert journey.source.startswith("rtt:")


async def test_a_network_error_also_falls_back() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    live = LiveRail([("hsp", hsp(broken)), ("rtt", rtt(rtt_handler([])))])

    assert (await live.service_delay("OXF", "PAD", DAY, "08:12")).delay_minutes == 38


async def test_both_sources_down_is_unavailable() -> None:
    live = LiveRail([("hsp", hsp(failing(500))), ("rtt", rtt(failing(502)))])

    with pytest.raises(RailDataUnavailable, match=r"HTTP 500.*HTTP 502"):
        await live.service_delay("OXF", "PAD", DAY, "08:12")


async def test_not_found_everywhere_is_not_found() -> None:
    live = LiveRail([("hsp", hsp(hsp_handler([]))), ("rtt", rtt(rtt_handler([])))])

    with pytest.raises(ServiceNotFound):
        await live.service_delay("OXF", "PAD", DAY, "06:00")


def test_live_rail_needs_a_source() -> None:
    with pytest.raises(ValueError, match="at least one source"):
        LiveRail([])


# --- replay --------------------------------------------------------------------------------------


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise AssertionError("replay mode must not touch the network")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.mark.usefixtures("no_network")
async def test_replay_mode_returns_fixture_without_network() -> None:
    port = rail_port(Settings(_env_file=None, tempo_mode="replay"))  # type: ignore[call-arg]

    journey = await port.service_delay("OXF", "PAD", DAY, "08:12")

    assert isinstance(port, ReplayRail)
    assert journey.delay_minutes == 38
    assert journey.source.startswith("synthetic:")  # never passed off as official data


async def test_replay_and_live_agree_on_the_same_journey() -> None:
    replayed = await ReplayRail.from_directory(RAIL / "replay").service_delay(
        "OXF", "PAD", DAY, "0812"
    )
    live = await hsp(hsp_handler([])).service_delay("OXF", "PAD", DAY, "0812")

    assert replayed.model_dump(exclude={"source"}) == live.model_dump(exclude={"source"})


async def test_replay_unknown_journey_is_not_found() -> None:
    with pytest.raises(ServiceNotFound):
        await ReplayRail.from_directory(RAIL / "replay").service_delay("OXF", "PAD", DAY, "05:55")


def test_live_mode_builds_hsp_then_rtt() -> None:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        tempo_mode="live",
        hsp_base_url="https://hsp.example.test/api/v1",
        hsp_api_key="k",
        rtt_token="t",
    )

    port = rail_port(settings)

    assert isinstance(port, LiveRail)
    assert [name for name, _ in port._sources] == ["hsp", "rtt"]


@pytest.mark.parametrize("bad", ["8:12", "0812x", "noon"])
async def test_bad_departure_times_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError, match="departure time"):
        await ReplayRail([]).service_delay("OXF", "PAD", DAY, bad)


async def test_a_404_is_not_found_and_a_non_json_body_is_unavailable() -> None:
    with pytest.raises(ServiceNotFound):
        await rtt(failing(404)).service_delay("OXF", "PAD", DAY, "08:12")
    html = hsp(lambda request: httpx.Response(200, text="<html>maintenance</html>"))
    with pytest.raises(RailDataUnavailable, match="not JSON"):
        await html.service_delay("OXF", "PAD", DAY, "08:12")


async def test_a_train_that_does_not_call_at_the_destination_is_not_found() -> None:
    with pytest.raises(ServiceNotFound, match="RDG"):
        await rtt(rtt_handler([])).service_delay("OXF", "RDG", DAY, "08:12")
    with pytest.raises(ServiceNotFound, match="SWI"):
        await hsp(hsp_handler([])).service_delay("OXF", "SWI", DAY, "08:12")
