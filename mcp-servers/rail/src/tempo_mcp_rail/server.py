"""MCP server wrapping Tempo's rail port (HSP, then Realtime Trains, or replay)."""

from __future__ import annotations

from datetime import date
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from tempo_adapters.rail import rail_port
from tempo_adapters.settings import Settings
from tempo_core.errors import RailDataUnavailable, ServiceNotFound

server = MCPServer(
    "tempo-rail",
    instructions="Look up how late a UK train was. Read-only; it never claims or contacts anyone.",
)


@server.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=True))
async def get_service_delay(
    origin_crs: str, destination_crs: str, date: str, scheduled_departure: str
) -> dict[str, Any]:
    """Scheduled vs actual arrival and delay_minutes for one train.

    Args:
        origin_crs: three-letter station code the train left from, e.g. OXF
        destination_crs: three-letter station code it was going to, e.g. PAD
        date: the day it ran, YYYY-MM-DD
        scheduled_departure: its timetabled departure from the origin, HH:MM
    """
    try:
        port = rail_port(Settings())
        journey = await port.service_delay(
            origin_crs.upper(), destination_crs.upper(), _day(date), scheduled_departure
        )
    except (ServiceNotFound, RailDataUnavailable, ValueError) as exc:
        raise ToolError(str(exc)) from exc  # anticipated: the model reads the message
    return journey.model_dump(mode="json")


def _day(value: str) -> date:
    return date.fromisoformat(value)


def main() -> None:
    server.run()  # stdio
