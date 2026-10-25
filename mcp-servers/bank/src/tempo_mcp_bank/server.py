"""MCP server over a CSV bank statement: list the transactions. Read-only, stdio."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TypedDict

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from tempo_mcp_bank.statement import newest_first, parse_day, parse_statement

KIND = "bank"
STATEMENT = "statement.csv"


class TransactionInfo(TypedDict):
    id: str
    date: str  # ISO, e.g. 2026-10-09
    description: str
    amount_gbp: str  # signed, two decimals: "+23.40" in, "-45.00" out


READ_ONLY = ToolAnnotations(
    read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False
)

server = MCPServer(
    "tempo-bank",
    instructions=(
        "List the transactions on the person's bank statement. Read-only: nothing here moves "
        "money, pays anyone or changes the account."
    ),
)


def data_dir() -> Path:
    """TEMPO_CONNECTOR_DATA, else fixtures/connectors/bank under TEMPO_HOME or this repository."""
    if folder := os.environ.get("TEMPO_CONNECTOR_DATA"):
        return Path(folder).expanduser()
    home = os.environ.get("TEMPO_HOME")
    root = Path(home) if home else Path(__file__).resolve().parents[4]
    return root / "fixtures" / "connectors" / KIND


@server.tool(annotations=READ_ONLY)
def list_transactions(since: str | None = None, limit: int = 50) -> list[TransactionInfo]:
    """Transactions on the statement, newest first. Money in is positive, money out negative.

    Args:
        since: only transactions on or after this ISO date, e.g. 2026-10-01
        limit: the most transactions to return
    """
    if limit < 1:
        raise ToolError("limit must be at least 1")
    path = data_dir() / STATEMENT
    if not path.is_file():
        raise ToolError(
            f"There is no statement at {path}. "
            f"Set TEMPO_CONNECTOR_DATA to a folder holding {STATEMENT}."
        )
    try:
        day = parse_day(since) if since else None
        transactions = parse_statement(path.read_text(encoding="utf-8-sig"))
    except ValueError as exc:
        raise ToolError(str(exc)) from exc
    return [
        {
            "id": t.id,
            "date": t.day.isoformat(),
            "description": t.description,
            "amount_gbp": t.amount_gbp,
        }
        for t in newest_first(transactions, day, limit)
    ]


def main() -> None:
    server.run()  # stdio
