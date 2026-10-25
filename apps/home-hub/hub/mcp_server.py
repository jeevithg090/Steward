"""tempo-me: the Tempo memory as an MCP server, so any agent (the teammate's Conductor, Claude Desktop, ...)
reads the person's synced devices with the same tools as /api/ask, and records mission state.

    .venv/bin/python -m hub.mcp_server                 # stdio
    .venv/bin/python -m hub.mcp_server --http 8788     # streamable HTTP on 127.0.0.1 only (ssh -L from elsewhere)

Claude Desktop config (claude_desktop_config.json). It ignores "cwd", so pass PYTHONPATH and TEMPO_DB:
    {"mcpServers": {"tempo-me": {"command": "/ABS/PATH/tempo-hub/.venv/bin/python",
                                 "args": ["-m", "hub.mcp_server"],
                                 "env": {"PYTHONPATH": "/ABS/PATH/tempo-hub",
                                         "TEMPO_DB": "/ABS/PATH/tempo-hub/data/tempo.db"}}}}

Contract (spec §6.7, with start/end instead of from/to): get_timeline, search_memory, explain_source,
get_profile, check_consent, request_approval, append_event, request_forget, plus get_device_status and
search_events. Arguments a tool doesn't declare are an error (mcp would otherwise drop them silently), and
numbers are clamped. Vault events (health, location, notifications, desktop) are withheld unless
TEMPO_MCP_ALLOW_VAULT=1; results say how many. Agents never delete or decide: they only record requests.
"""
from __future__ import annotations

import contextlib
import os
import sys
from typing import Any

try:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as _Server
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP as _Server
    from mcp.server.fastmcp.exceptions import ToolError

from . import db, memory

with contextlib.redirect_stdout(sys.stderr):  # stdout is the MCP channel: nothing else may print there
    db.init()
print(f"[tempo-me] reading {db.DB_PATH}", file=sys.stderr)

mcp = _Server("tempo-me")


def _allow_vault() -> bool:
    return os.environ.get("TEMPO_MCP_ALLOW_VAULT") == "1"


def _person() -> str:
    """The person whose memory this is. Never creates one: an empty database means TEMPO_DB is wrong."""
    pid = os.environ.get("TEMPO_PERSON_ID")
    if pid:
        return pid
    row = db.conn().execute("SELECT id FROM persons ORDER BY created_at LIMIT 1").fetchone()
    if row is None:
        raise ToolError(f"No Tempo data in {db.DB_PATH}. Set TEMPO_DB to the hub's data/tempo.db "
                        "and PYTHONPATH to the tempo-hub folder.")
    return row["id"]


def _run(fn, *args: Any, **kwargs: Any) -> dict:
    """Call a memory function for the person; bad input comes back as a tool error the agent can read."""
    try:
        return fn(_person(), *args, **kwargs)
    except (ValueError, PermissionError) as exc:
        raise ToolError(str(exc)) from exc


# ---------- read ----------

@mcp.tool()
def get_device_status() -> dict:
    """List the person's connected devices and apps, when each last synced, and how many events each sent
    (for apps, only when vault data is allowed: an app's activity is private too)."""
    return _run(memory.get_device_status, allow_vault=_allow_vault())


@mcp.tool()
def get_timeline(start: str | None = None, end: str | None = None, kinds: list[str] | str | None = None,
                 limit: int = 40, hours: float | None = None) -> dict:
    """Events between start and end, newest first. start/end are ISO 8601 with an offset, e.g.
    '2026-10-25T01:00:00+01:00' (end defaults to now). Without start: the last `hours` (default 24, max 720).
    kinds are prefixes: ['health'] means health.*, ['location', 'mission']. Heartbeats (node.*) only when
    asked for. limit 1-200. Each event has id, ref, time (UTC), local (the person's clock; '(1st)'/'(2nd)'
    in the hour the clocks go back), class, trust_level and text."""
    return _run(memory.get_timeline, hours, kinds, limit, start, end, allow_vault=_allow_vault())


@mcp.tool()
def search_memory(query: str, start: str | None = None, end: str | None = None, limit: int = 20) -> dict:
    """Full-text search over the person's events (e.g. 'train delay', 'sleep'), newest first, optionally
    within start/end (ISO 8601). limit 1-200."""
    return _run(memory.search_events, query, limit, start, end, allow_vault=_allow_vault())


@mcp.tool()
def search_events(query: str, limit: int = 20, start: str | None = None, end: str | None = None) -> dict:
    """Same as search_memory (older name, kept for existing clients)."""
    return _run(memory.search_events, query, limit, start, end, allow_vault=_allow_vault())


@mcp.tool()
def explain_source(event_id: str | int | None = None, fact_or_event_id: str | int | None = None,
                   id: str | int | None = None) -> dict:  # noqa: A002 (the spec's §6.7 names)
    """Where one event came from (device, app, times, class, trust_level) and its payload. event_id is an
    id or a ref like '#42' from another tool's result (fact_or_event_id and id are accepted too)."""
    ref = next((v for v in (event_id, fact_or_event_id, id) if v not in (None, "")), None)
    if ref is None:
        raise ToolError("event_id is required: an id or a ref like '#42'")
    return _run(memory.explain_source, ref, allow_vault=_allow_vault())


@mcp.tool()
def get_profile() -> dict:
    """Derived facts about the person (steps, sleep, heart rate, workouts, location, apps), each with the
    event refs and ids it came from."""
    return _run(memory.get_profile, allow_vault=_allow_vault())


@mcp.tool()
def check_consent(scope: str) -> dict:
    """Is this agent allowed to use `scope` (e.g. 'rail.delay_repay')? Prototype stub: returns allowed and
    a reason. Vault scopes (health, location, ...) are refused while vault data is withheld."""
    return _run(memory.check_consent, scope, allow_vault=_allow_vault())


# ---------- write: requests and mission state only ----------

@mcp.tool()
def request_approval(mission_id: str, summary: str, amount_gbp: float | None = None, amount: float | None = None,
                     idempotency_key: str | None = None) -> dict:
    """Ask the person to approve a step, e.g. summary 'Claim £14.20 Delay Repay for the 08:12', amount_gbp
    14.20. Writes approval.requested and returns {status: 'pending', request_id, ref}. Nothing happens until
    the person approves or declines in Tempo; send the same request again to get the decision: status
    becomes 'approved', 'declined' or 'withdrawn' (append_event approval.withdrawn {request: ref} to withdraw).
    `amount` (§6.7) is the same as amount_gbp. idempotency_key names the request: resending with the same key
    returns the same request and its decision, even if the summary's wording changed."""
    return _run(memory.request_approval, mission_id, summary, amount_gbp if amount_gbp is not None else amount,
                idempotency_key=idempotency_key)


@mcp.tool()
def append_event(kind: str, payload: dict[str, Any] | None = None, body: dict[str, Any] | None = None,
                 event_id: str | None = None) -> dict:
    """Record mission state. kind must start with 'mission.' or 'agent.' (or be approval.requested /
    approval.withdrawn). payload (or body, the §6.7 name) is a JSON object up to 8 KB. event_id makes
    retries idempotent. Stored with trust_level 'agent'."""
    if payload is not None and body is not None:
        raise ToolError("Send payload or body, not both.")
    return _run(memory.append_event, kind, payload if payload is not None else body, event_id)


@mcp.tool()
def request_forget(ids: list[str] | str | None = None, category: str | None = None, reason: str = "",
                   what: str | None = None) -> dict:
    """Ask the PERSON to approve forgetting events: ids (ids or refs like '#42') or a category (a kind
    prefix such as 'location.'). Agents can never delete memory; this only records forget.requested.
    `what` is the old argument (a kind prefix or a topic) and still works."""
    topic = None
    if what and not (ids or category):
        if memory.is_category(what):
            category = what
        else:
            topic = what
    return _run(memory.request_forget, ids, category, reason, topic)


def _forbid_unknown_args() -> None:
    """mcp drops arguments a tool doesn't declare without a word (get_timeline(from=...) would quietly
    return the last 24 h). Make them a validation error the agent sees instead."""
    try:
        tools = mcp._tool_manager.list_tools()
    except AttributeError:
        return
    for t in tools:
        try:
            model = t.fn_metadata.arg_model
            model.model_config["extra"] = "forbid"
            model.model_rebuild(force=True)
            t.parameters["additionalProperties"] = False
        except Exception:  # an mcp version without these internals: still works, just lenient
            pass


_forbid_unknown_args()


def main(argv: list[str] | None = None) -> None:
    args = sys.argv[1:] if argv is None else argv
    if args[:1] != ["--http"]:
        mcp.run()
        return
    port = int(args[1]) if len(args) > 1 else 8788
    print(f"[tempo-me] streamable HTTP on http://127.0.0.1:{port} (this computer only)", file=sys.stderr)
    try:
        mcp.run("streamable-http", host="127.0.0.1", port=port)
    except TypeError:  # mcp 1.x takes host/port from settings
        mcp.settings.host, mcp.settings.port = "127.0.0.1", port
        mcp.run("streamable-http")


if __name__ == "__main__":
    main()
