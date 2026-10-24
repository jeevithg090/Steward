"""The rail MCP server, in process and as a real stdio server listed by an MCP client."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.server.mcpserver.exceptions import ToolError

from tempo_mcp_rail.server import server

QUERY = {
    "origin_crs": "oxf",
    "destination_crs": "pad",
    "date": "2026-10-23",
    "scheduled_departure": "08:12",
}


@pytest.fixture(autouse=True)
def replay_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEMPO_MODE", "replay")


def _payload(result: Any) -> dict[str, Any]:
    if isinstance(result, tuple):  # (content, structured) in some SDK versions
        result = result[0]
    content = getattr(result, "content", result)
    data: dict[str, Any] = json.loads(content[0].text)
    return data


async def test_the_tool_is_read_only_and_documented() -> None:
    [tool] = await server.list_tools()

    assert tool.name == "get_service_delay"
    assert tool.annotations is not None
    assert tool.annotations.read_only_hint is True
    assert "delay_minutes" in (tool.description or "")
    assert set(tool.input_schema["required"]) == set(QUERY)


async def test_get_service_delay_in_replay_mode() -> None:
    journey = _payload(await server.call_tool("get_service_delay", QUERY))

    assert journey["delay_minutes"] == 38
    assert journey["origin_crs"] == "OXF"  # codes are upper-cased
    assert journey["source"].startswith("synthetic:")


async def test_an_unknown_train_is_a_clear_tool_error() -> None:
    with pytest.raises(ToolError, match="no recorded journey") as err:
        await server.call_tool("get_service_delay", QUERY | {"scheduled_departure": "05:55"})
    assert type(err.value) is ToolError  # anticipated, so the model sees the message


async def test_a_bad_date_is_a_clear_tool_error() -> None:
    with pytest.raises(ToolError, match="Invalid isoformat"):
        await server.call_tool("get_service_delay", QUERY | {"date": "23/10/2026"})


async def test_the_server_runs_over_stdio_and_is_listed_by_an_mcp_client() -> None:
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "tempo_mcp_rail"],
        env={**os.environ, "TEMPO_MODE": "replay"},
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("get_service_delay", QUERY)

    assert [t.name for t in tools.tools] == ["get_service_delay"]
    assert json.loads(result.content[0].text)["delay_minutes"] == 38
    assert not result.is_error
