"""Tempo's MCP server from an assistant's side (plan.md §14): for the demo and the live session.

    uv run --no-sync python scripts/mcp_demo_client.py --url http://127.0.0.1:8000 --token devtoken

It connects with the MCP SDK's own client, lists the tools, checks the HMRC text, starts Margaret's
claim, prints how she approves it, and shows that an assistant can't: no tool approves, a made-up
one is refused, and the claim is still waiting for her yes. The token may come from
TEMPO_API_TOKEN instead of --token, which keeps it out of the process list.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import Any

import httpx2
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent

HMRC = (
    "HMRC: You are due a tax refund of 248.20 GBP. Claim within 24 hours at "
    "http://hmrc-refunds-gov.uk/claim"
)
MARGARET = {  # the demo's journey: recorded 38 minutes late
    "user_id": "u_margaret", "display_name": "Margaret", "origin_crs": "OXF",
    "destination_crs": "PAD", "travel_date": "2026-10-23", "departure": "08:12",
    "fare_gbp": "28.40",
}  # fmt: skip


def say(text: str = "", indent: int = 0) -> None:
    print(" " * indent + text, flush=True)


def words(result: CallToolResult) -> str:
    return " ".join(c.text for c in result.content if isinstance(c, TextContent))


async def call(session: ClientSession, tool: str, **arguments: Any) -> CallToolResult:
    result = await session.call_tool(tool, arguments)
    if not isinstance(result, CallToolResult):
        raise SystemExit(f"{tool} answered something unexpected.")
    return result


async def structured(session: ClientSession, tool: str, **arguments: Any) -> dict[str, Any]:
    result = await call(session, tool, **arguments)
    if result.is_error or not isinstance(result.structured_content, dict):
        raise SystemExit(f"{tool} failed: {words(result)}")
    return result.structured_content


async def run(url: str, token: str) -> None:
    base = url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx2.AsyncClient(headers=headers, timeout=60) as http:
        try:
            info = await http.get(f"{base}/mcp/info")
        except httpx2.HTTPError as exc:
            raise SystemExit(f"I couldn't reach Tempo at {base} ({type(exc).__name__}).") from None
        if info.status_code == 401:
            raise SystemExit("The Gateway refused that token.")
        if info.status_code == 404:
            raise SystemExit("This Gateway doesn't serve /mcp yet.")
        info.raise_for_status()
        endpoint = f"{base}/mcp"  # where this script is; /mcp/info names the public address
        say(f"Tempo's MCP server: {endpoint} ({info.json()['transport']})")

        async with (
            streamable_http_client(endpoint, http_client=http) as (read, write),
            ClientSession(read, write) as session,
        ):
            hello = await session.initialize()
            say(f"Connected to {hello.server_info.name}.")
            say(f"It says: {hello.instructions}", 2)

            say()
            say("1. The tools an assistant may use")
            tools = (await session.list_tools()).tools
            for tool in tools:
                kind = "reads" if tool.annotations and tool.annotations.read_only_hint else "starts"
                say(f"{tool.name:<26} {kind}", 2)
            approving = [t.name for t in tools if "approve" in t.name or "consent" in t.name]
            say("No tool approves anything." if not approving else f"UNEXPECTED: {approving}", 2)

            say()
            say("2. Check the HMRC text")
            say(f'"{HMRC}"', 2)
            verdict = await structured(session, "check_message", text=HMRC)
            say(f"Zone: {verdict['zone']}. Level: {verdict['level']}.", 2)
            say(f"Tempo says: {verdict['say']}", 2)

            say()
            say("3. Start Margaret's claim (the 08:12 Oxford to Paddington, 23 October, £28.40)")
            claim = await structured(session, "start_rail_claim", **MARGARET)
            mission_id = claim["mission_id"]
            new = "a new claim" if claim["started"] else "her claim already open for this journey"
            say(f"{mission_id}: {new}. State: {claim['state']}. Amount: £{claim['amount_gbp']}.", 2)
            say(f"Tempo says: {claim['message']}", 2)

            say()
            say("4. Who approves, and how")
            say(f"Needs consent from: {claim['needs_consent_from']}", 2)
            say(claim["how_to_approve"] or "Nothing is waiting for a yes.", 2)

            say()
            say("5. Can the assistant approve it anyway?")
            tried = await call(session, "approve_claim", mission_id=mission_id)
            say(f"It asks for approve_claim. The server says: {words(tried)}", 2)
            status = await structured(session, "claim_status", mission_id=mission_id)
            say(f"The claim is still {status['state']}: it waits for Margaret's own yes.", 2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Drive Tempo's MCP server like an assistant.")
    parser.add_argument("--url", default=os.environ.get("TEMPO_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--token", default=os.environ.get("TEMPO_API_TOKEN"))
    args = parser.parse_args()
    if not args.token:
        sys.exit("Give the Gateway's bearer token: --token, or TEMPO_API_TOKEN.")
    asyncio.run(run(args.url, args.token))


if __name__ == "__main__":
    main()
