"""The connector servers (mail, calendar, bank) as real stdio MCP servers, driven by the SDK's own
client against Margaret's fixtures, with the tool names and shapes of plan §14.2."""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult, TextContent

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "connectors"
OCTOBER = {"start": "2026-10-01", "end": "2026-11-01"}


@asynccontextmanager
async def connected(kind: str, env: dict[str, str] | None = None) -> AsyncIterator[ClientSession]:
    """Start `python -m tempo_mcp_<kind>` and talk to it over stdio. By default its data folder
    is the fixtures; pass `env` to choose (the SDK passes on only a safe few of our variables)."""
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", f"tempo_mcp_{kind}"],
        env={"TEMPO_CONNECTOR_DATA": str(FIXTURES / kind)} if env is None else env,
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        yield session


def rows(result: CallToolResult) -> list[dict[str, Any]]:
    """A list-returning tool's structured output, `{"result": [...]}`."""
    assert not result.is_error, result.content
    assert result.structured_content is not None
    found: list[dict[str, Any]] = result.structured_content["result"]
    return found


def one(result: CallToolResult) -> dict[str, Any]:
    assert not result.is_error, result.content
    assert result.structured_content is not None
    return result.structured_content


def error_text(result: CallToolResult) -> str:
    assert result.is_error
    [block] = result.content
    assert isinstance(block, TextContent)
    return block.text


@pytest.mark.parametrize(
    ("kind", "tools"),
    [
        ("mail", ["search_messages", "get_message"]),
        ("calendar", ["list_events"]),
        ("bank", ["list_transactions"]),
    ],
)
async def test_each_server_lists_its_tools_and_every_one_is_read_only(
    kind: str, tools: list[str]
) -> None:
    async with connected(kind) as session:
        listed = (await session.list_tools()).tools

    assert [t.name for t in listed] == tools
    for tool in listed:
        assert tool.annotations is not None
        assert tool.annotations.read_only_hint is True
        assert tool.annotations.destructive_hint is False
        assert tool.output_schema is not None  # typed output a client can rely on
        assert tool.description


async def test_mail_finds_the_eticket_and_reads_it() -> None:
    async with connected("mail") as session:
        found = rows(await session.call_tool("search_messages", {"query": "Trainline"}))
        ticket = one(await session.call_tool("get_message", {"id": "trainline-eticket-2026-10-21"}))
        everything = rows(await session.call_tool("search_messages", {}))
        recent = rows(await session.call_tool("search_messages", {"since": "2026-10-20"}))
        two = rows(await session.call_tool("search_messages", {"query": "", "limit": 2}))
        invite = one(
            await session.call_tool("get_message", {"id": "broadbandly-appointment-2026-10-12"})
        )

    assert [m["id"] for m in found] == ["trainline-eticket-2026-10-21"]
    assert found[0] == {
        "id": "trainline-eticket-2026-10-21",
        "from": "Trainline <tickets@trainline.example>",
        "subject": "Your e-ticket: Oxford to London Paddington, Fri 23 Oct",
        "date": "2026-10-21T19:04:12+01:00",
        "snippet": found[0]["snippet"],
    }
    assert found[0]["snippet"].startswith("Hello Margaret, Thanks for booking with Trainline.")

    assert set(ticket) == {"id", "from", "to", "subject", "date", "text", "attachments"}
    assert ticket["to"] == "Margaret <margaret@example.com>"
    assert "departs Oxford 08:12, arrives London Paddington 09:15" in ticket["text"]
    assert "Off-Peak Day Return, £28.40" in ticket["text"]
    assert "Booking reference: TL7Q2M" in ticket["text"]
    assert ticket["attachments"] == []

    assert [m["id"] for m in everything] == [  # newest first
        "hmrc-refund-scam-2026-10-24",
        "trainline-eticket-2026-10-21",
        "library-reminder-2026-10-20",
        "grandchild-photos-2026-10-18",
        "broadbandly-appointment-2026-10-12",
        "thames-water-2026-10-03",
    ]
    assert [m["id"] for m in recent] == [m["id"] for m in everything[:3]]
    assert [m["id"] for m in two] == [m["id"] for m in everything[:2]]
    assert invite["attachments"] == [
        {"filename": "engineer-visit.ics", "mime_type": "text/calendar"}
    ]
    assert "Account ref: BB-4417" in invite["text"]


async def test_mail_search_matches_subject_sender_and_text_in_any_case() -> None:
    async with connected("mail") as session:
        by_subject = rows(await session.call_tool("search_messages", {"query": "TAX REFUND"}))
        by_sender = rows(
            await session.call_tool("search_messages", {"query": "broadbandly.example"})
        )
        by_text = rows(await session.call_tool("search_messages", {"query": "five working days"}))
        html_only = one(
            await session.call_tool("get_message", {"id": "library-reminder-2026-10-20"})
        )

    assert [m["id"] for m in by_subject] == ["hmrc-refund-scam-2026-10-24"]
    assert [m["id"] for m in by_sender] == ["broadbandly-appointment-2026-10-12"]
    assert [m["id"] for m in by_text] == ["thames-water-2026-10-03"]
    assert "Middlemarch George Eliot" in html_only["text"]  # the HTML, stripped to text
    assert "<" not in html_only["text"] and "trackOpen" not in html_only["text"]


async def test_an_unknown_message_id_is_an_mcp_error() -> None:
    async with connected("mail") as session:
        unknown = await session.call_tool("get_message", {"id": "no-such-message"})
        outside = await session.call_tool("get_message", {"id": "../bank/statement"})
        bad_since = await session.call_tool("search_messages", {"since": "last Tuesday"})

    assert "no message with id 'no-such-message'" in error_text(unknown)
    assert "no message with id" in error_text(outside)  # ids are looked up, never made into paths
    assert "not an ISO date" in error_text(bad_since)


async def test_calendar_lists_octobers_events_with_the_engineer_visit() -> None:
    async with connected("calendar") as session:
        october = rows(await session.call_tool("list_events", OCTOBER))
        one_day = rows(
            await session.call_tool("list_events", {"start": "2026-10-19", "end": "2026-10-20"})
        )
        backwards = await session.call_tool(
            "list_events", {"start": "2026-11-01", "end": "2026-10-01"}
        )

    assert [e["title"] for e in october] == [
        "GP appointment",
        "Broadbandly engineer visit",
        "Train to London (08:12 from Oxford)",
        "Book club",
    ]
    visit = october[1]
    assert visit == {
        "uid": "broadbandly-visit-BB-4417@demo.tempo",
        "title": "Broadbandly engineer visit",
        "start": "2026-10-19T08:00:00+01:00",
        "end": "2026-10-19T13:00:00+01:00",
        "location": "Home",
        "description": visit["description"],
    }
    assert "BB-4417" in visit["description"]  # the event's own text, not its reminder's
    assert october[2]["start"] == "2026-10-23T08:12:00+01:00"
    assert october[3]["start"] == "2026-10-28T14:30:00+00:00"  # after the clocks go back
    assert [e["uid"] for e in one_day] == ["broadbandly-visit-BB-4417@demo.tempo"]
    assert "end must be after start" in error_text(backwards)


async def test_bank_lists_the_thames_water_refund_and_no_open_claims() -> None:
    async with connected("bank") as session:
        statement = rows(await session.call_tool("list_transactions", {}))
        again = rows(await session.call_tool("list_transactions", {}))
        recent = rows(
            await session.call_tool("list_transactions", {"since": "2026-10-20", "limit": 3})
        )

    assert len(statement) == 16
    [refund] = [t for t in statement if t["description"] == "THAMES WATER REFUND"]
    assert set(refund) == {"id", "date", "description", "amount_gbp"}
    assert (refund["date"], refund["amount_gbp"]) == ("2026-10-09", "+23.40")
    assert refund["id"].startswith("tx_")
    [broadband] = [t for t in statement if t["description"] == "BROADBANDLY DD"]
    assert (broadband["date"], broadband["amount_gbp"]) == ("2026-10-01", "-45.00")
    credits = {t["description"] for t in statement if t["amount_gbp"].startswith("+")}
    assert credits == {"DWP STATE PENSION", "THAMES WATER REFUND"}  # no GWR or Broadbandly money
    assert [t["date"] for t in statement] == sorted((t["date"] for t in statement), reverse=True)
    assert [t["id"] for t in statement] == [t["id"] for t in again]  # stable
    assert len({t["id"] for t in statement}) == len(statement)
    assert [t["date"] for t in recent] == ["2026-10-24", "2026-10-23", "2026-10-21"]


async def test_the_default_data_folder_is_the_repositorys_fixtures() -> None:
    async with connected("mail", env={}) as mail, connected("calendar", env={}) as calendar:
        found = rows(await mail.call_tool("search_messages", {"query": "Trainline"}))
        events = rows(await calendar.call_tool("list_events", OCTOBER))

    assert [m["id"] for m in found] == ["trainline-eticket-2026-10-21"]
    assert len(events) == 4


async def test_tempo_connector_data_points_a_server_at_another_folder(tmp_path: Path) -> None:
    (tmp_path / "statement.csv").write_text(
        "date,description,amount\n09/10/2026,CORNER SHOP,-£1.20\n", encoding="utf-8"
    )
    async with connected("bank", env={"TEMPO_CONNECTOR_DATA": str(tmp_path)}) as session:
        statement = rows(await session.call_tool("list_transactions", {}))
    async with connected("bank", env={"TEMPO_CONNECTOR_DATA": str(tmp_path / "gone")}) as session:
        missing = await session.call_tool("list_transactions", {})

    assert [(t["date"], t["description"], t["amount_gbp"]) for t in statement] == [
        ("2026-10-09", "CORNER SHOP", "-1.20")
    ]
    assert "Set TEMPO_CONNECTOR_DATA" in error_text(missing)
