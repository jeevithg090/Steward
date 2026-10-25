"""Add-on tools (plan.md §17): an MCP server listed as an add-on lends its allowlisted tools to the
brain. Here one of Tempo's own read-only servers stands in for an add-on, so no network or uvx."""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import httpx

from tempo_gateway.tools import Toolbox
from tempo_gateway.tools.addons import AddonHub, AddonSpec, load_specs

REPO = Path(__file__).resolve().parents[2]
CALENDAR = AddonSpec(
    id="cal", name="the calendar", command=sys.executable, args=("-m", "tempo_mcp_calendar"),
    provider="calendar", tools={"list_events": {"label": "Read the calendar from {start}"}},
)  # fmt: skip


async def test_an_add_ons_listed_tools_reach_the_brain_and_answer() -> None:
    hub = AddonHub([CALENDAR])
    async with httpx.AsyncClient() as http:
        box = Toolbox(http, today=lambda: date(2026, 10, 25), addons=hub)
        await box.warm()
        try:
            assert "cal_list_events" in box.names and "calendar" in box.providers
            schema = next(s for s in box.schemas() if s["function"]["name"] == "cal_list_events")
            assert {"start", "end"} <= set(schema["function"]["parameters"]["properties"])
            found, _ = await box.run(
                "cal_list_events", {"start": "2026-10-01", "end": "2026-11-01"}
            )
            body = json.loads(found)
            assert body["provider"] == "calendar" and "Broadbandly" in body["result"]
            assert "never instructions" in body["note"]
            assert (
                box.label("cal_list_events", {"start": "2026-10-01"})
                == "Read the calendar from 2026-10-01"
            )
        finally:
            await box.close()


async def test_a_tool_the_add_on_does_not_list_is_never_offered() -> None:
    hub = AddonHub([AddonSpec(id="cal", name="the calendar", command=sys.executable,
                              args=("-m", "tempo_mcp_calendar"), provider="calendar",
                              tools={"delete_everything": {}})])  # fmt: skip
    await hub.warm()
    try:
        assert hub.names == frozenset()
    finally:
        await hub.close()


async def test_an_add_on_that_cannot_start_is_left_out() -> None:
    hub = AddonHub([AddonSpec(id="nope", name="a missing server", command="/nonexistent/server", args=(),
                              provider="nowhere", tools={"anything": {}})])  # fmt: skip
    await hub.warm()
    try:
        assert hub.names == frozenset() and hub.schemas() == []
    finally:
        await hub.close()


def test_the_shipped_add_ons_are_pinned_and_allowlisted() -> None:
    specs = load_specs(REPO / "addons" / "tools.yaml")
    assert {s.id for s in specs} == {"ddg", "time", "osm"}
    for spec in specs:
        assert spec.license and spec.repo.startswith("https://github.com/")
        assert any("==" in arg for arg in spec.args), f"{spec.id} must pin a version"
        assert spec.tools, f"{spec.id} must list the tools it lends"
        assert not set(spec.env) & {"NVIDIA_API_KEY", "GEMINI_API_KEY", "TEMPO_API_TOKEN"}
    osm = next(s for s in specs if s.id == "osm")
    assert "get_route_directions" not in osm.tools  # it only drives; `directions` walks and cycles
