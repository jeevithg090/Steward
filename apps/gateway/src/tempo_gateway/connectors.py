"""Connectors: Tempo as an MCP client that finds money you're owed (plan.md §14).

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | What |
|---|---|
| GET /connectors?user_id= | each connector: connected or not, what it may read, what it has read |
| POST /connectors/{id}/connect, /disconnect {user_id} | turn one on or off for this person |
| POST /connectors/sweep {user_id} | read what the connected ones allow; return what was found |

Each connector is a small read-only MCP server (`mcp-servers/{mail,calendar,bank}`), listed in
`connectors/connectors.yaml`. A read starts the server over stdio, initialises, calls, and closes:
simple and robust. Only the tools on a connector's `read_tools` allowlist are ever called; any
other is refused before a server starts. A read gives up after 20 seconds.

What a connector returns is evidence, never instructions. Code reads it (`tempo_core.findings`);
it is never logged, never kept (only counts and times are), never written to Tempo Memory and
never sent to a model. The bus hears `connector_read {connector, items}` and `sweep_done
{findings}`, never contents.

A sweep checks a ticket the way a claim is checked: the Gateway's own rail port (the one the
rail mission's Intake step asks), then the rule pack, `claimable_delay` and
`evaluate_delay_repay`, so a finding's amount is the amount the claim will ask for. The `rail`
connector entry says whether the sweep may ask, and counts the trains it asked about. A
suspicious email goes to `ShieldService.check(..., source="connector")`. Nothing is started.
"""

import asyncio
import json
import os
import sys
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

import structlog
import yaml
from fastapi import APIRouter, Depends, HTTPException, Query
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from tempo_core.delays import LONDON, claimable_delay
from tempo_core.errors import NotCovered, RailDataUnavailable, ServiceNotFound
from tempo_core.findings import (
    BankTransaction,
    CalendarEvent,
    Finding,
    MailMessage,
    TicketFacts,
    credits_in,
    engineer_visit_finding,
    in_order,
    late_train_finding,
    looks_like_refund,
    money_arrived_finding,
    promised_by,
    scam_candidates,
    scam_finding,
    tickets_in,
    visits_in,
)
from tempo_core.models import Fact
from tempo_core.rules import NotEligible, RulePackRegistry, evaluate_delay_repay
from tempo_gateway.events import EventBus
from tempo_gateway.missions import MissionService, StartMission, StartOfcom
from tempo_gateway.shield import ShieldService
from tempo_ports.rail import RailDataPort

log = structlog.get_logger("tempo.connectors")

READ_TIMEOUT_S = 20.0
MAIL_LIMIT = 20  # the newest emails a sweep opens
BANK_LIMIT = 100
CALENDAR_BACK = timedelta(days=365)  # a missed visit can be claimed long after
CALENDAR_AHEAD = timedelta(days=90)
SHIELD_CHARS = 2000  # what Scam Shield reads of an email, as POST /scam/check allows
USER_ID = r"^[A-Za-z0-9_-]{1,64}$"
Kind = Literal["mail", "calendar", "bank", "rail"]
# Places, as the chat says them: "your email, calendar and bank".
PLACE: dict[str, str] = {"mail": "email", "calendar": "calendar", "bank": "bank"}


class ConnectorSpec(BaseModel):
    """One entry of connectors/connectors.yaml."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,30}$")
    name: str = Field(min_length=1, max_length=40)
    kind: Kind
    module: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.]*$")  # run as `python -m <module>`
    data_env: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]*$")
    scopes: tuple[str, ...] = Field(min_length=1)  # plain words, shown as written
    read_tools: tuple[str, ...] = Field(min_length=1)  # the allowlist
    default_connected: bool = False


class ConnectorsConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    connectors: tuple[ConnectorSpec, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> "ConnectorsConfig":
        ids = [c.id for c in self.connectors]
        if len(set(ids)) != len(ids):
            raise ValueError("each connector needs its own id")
        return self

    @classmethod
    def load(cls, path: Path) -> "ConnectorsConfig":
        return cls.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


class UnknownConnector(LookupError):
    """No connector has this id."""


class ToolRefused(PermissionError):
    """The tool isn't on the connector's read-only allowlist: nothing was started."""


class ConnectorFailed(RuntimeError):
    """The connector answered with an error, or not at all. Says which, never what it read."""


Call = Callable[[str, dict[str, Any]], Awaitable[Any]]


class ConnectorHub:
    """Who has connected what (in memory, per person), the reads, and the sweep."""

    def __init__(
        self,
        config: ConnectorsConfig,
        *,
        repo: Path,
        shield: ShieldService | None,
        rail_port: RailDataPort,
        rules: RulePackRegistry,
        clock: Callable[[], datetime],
        bus: EventBus,
        missions: MissionService | None = None,  # read only: is a claim already under way?
        data_root: Path | None = None,  # the folders the servers read; default the demo data
        env: Mapping[str, str] | None = None,  # extra environment for every server
        timeout_s: float = READ_TIMEOUT_S,
    ) -> None:
        self.config, self.shield, self.rail, self.rules = config, shield, rail_port, rules
        self.clock, self.bus, self.missions, self.timeout_s = clock, bus, missions, timeout_s
        self.specs = {c.id: c for c in config.connectors}
        demo = repo / "fixtures" / "connectors"
        self.data_root = data_root or demo
        self.simulated = self.data_root.resolve() == demo.resolve()
        self.env = dict(env or {})
        self._connected: dict[str, set[str]] = {}
        self._read: dict[tuple[str, str], tuple[int, str]] = {}  # (user, id) -> (items, last at)

    # --- connected or not ------------------------------------------------------------------------

    def spec(self, connector_id: str) -> ConnectorSpec:
        try:
            return self.specs[connector_id]
        except KeyError:
            raise UnknownConnector(connector_id) from None

    def connected(self, user_id: str) -> set[str]:
        """This person's connected connectors; the demo connects the defaults for everyone."""
        if user_id not in self._connected:
            self._connected[user_id] = {c.id for c in self.config.connectors if c.default_connected}
        return self._connected[user_id]

    def connect(self, user_id: str, connector_id: str) -> dict[str, Any]:
        self.connected(user_id).add(self.spec(connector_id).id)
        return self.view(user_id, connector_id)

    def disconnect(self, user_id: str, connector_id: str) -> dict[str, Any]:
        self.connected(user_id).discard(self.spec(connector_id).id)
        return self.view(user_id, connector_id)

    def view(self, user_id: str, connector_id: str) -> dict[str, Any]:
        spec = self.spec(connector_id)
        items, last = self._read.get((user_id, spec.id), (0, None))
        return {
            "id": spec.id, "name": spec.name, "kind": spec.kind,
            "connected": spec.id in self.connected(user_id), "scopes": list(spec.scopes),
            "tools": list(spec.read_tools), "last_read_at": last, "items_read": items,
        }  # fmt: skip

    def listing(self, user_id: str) -> dict[str, Any]:
        return {
            "connectors": [self.view(user_id, c.id) for c in self.config.connectors],
            "simulated": self.simulated,
        }

    # --- reading ---------------------------------------------------------------------------------

    async def call(
        self,
        connector_id: str,
        tool: str,
        args: Mapping[str, Any] | None = None,
        *,
        user_id: str | None = None,
    ) -> Any:
        """One read-only tool call in its own session. A tool off the allowlist is refused
        before anything starts."""
        spec = self.spec(connector_id)
        self._allowed(spec, tool)
        data = await self._session(spec, lambda call: call(tool, dict(args or {})))
        self._note(user_id, spec, _count(data))
        return data

    def _allowed(self, spec: ConnectorSpec, tool: str) -> None:
        if tool not in spec.read_tools:
            raise ToolRefused(f"{spec.name} may only use {', '.join(spec.read_tools)}")

    async def _session[T](self, spec: ConnectorSpec, work: Callable[[Call], Awaitable[T]]) -> T:
        """Start the server, initialise, do the work, close: one stdio session, at most
        `timeout_s` long. The server's stderr goes nowhere: it could quote what it read."""
        env = {**self.env, **({spec.data_env: str(self.data_root / spec.kind)}
                              if spec.data_env else {})}  # fmt: skip
        params = StdioServerParameters(command=sys.executable, args=["-m", spec.module], env=env)
        try:
            async with asyncio.timeout(self.timeout_s):
                with open(os.devnull, "w") as quiet:  # noqa: ASYNC230 (opening /dev/null)
                    async with (
                        stdio_client(params, errlog=quiet) as (read, write),
                        ClientSession(read, write) as session,
                    ):
                        await session.initialize()

                        async def call(tool: str, args: dict[str, Any]) -> Any:
                            self._allowed(spec, tool)
                            result = await session.call_tool(tool, args)
                            if result.is_error:
                                raise ConnectorFailed(f"{spec.name} could not {tool}")
                            return _payload(result.structured_content, result.content)

                        return await work(call)
        except Exception as exc:  # a refusal stays one; anything else is "not answering"
            raise _failed(spec, exc, self.timeout_s) from None

    def _note(self, user_id: str | None, spec: ConnectorSpec, items: int) -> None:
        """Count what was read and when; publish the count. Never the contents."""
        key = (user_id or "", spec.id)
        before, _ = self._read.get(key, (0, None))
        self._read[key] = (before + items, self.clock().isoformat())
        self.bus.publish({"type": "connector_read", "connector": spec.id, "items": items,
                          "user_id": user_id or ""})  # fmt: skip

    async def _mail(self, spec: ConnectorSpec) -> list[MailMessage]:
        async def work(call: Call) -> list[MailMessage]:
            rows = await call("search_messages", {"limit": MAIL_LIMIT})
            ids = [str(r["id"]) for r in rows if isinstance(r, dict) and r.get("id")]
            return _rows(MailMessage, [await call("get_message", {"id": i}) for i in ids])

        return await self._session(spec, work)

    async def _calendar(self, spec: ConnectorSpec) -> list[CalendarEvent]:
        today = self.clock().astimezone(LONDON).date()
        window = {"start": (today - CALENDAR_BACK).isoformat(),
                  "end": (today + CALENDAR_AHEAD).isoformat()}  # fmt: skip
        rows = await self._session(spec, lambda call: call("list_events", window))
        return _rows(CalendarEvent, rows)

    async def _bank(self, spec: ConnectorSpec) -> list[BankTransaction]:
        rows = await self._session(spec, lambda call: call("list_transactions",
                                                           {"limit": BANK_LIMIT}))  # fmt: skip
        return _rows(BankTransaction, rows)

    async def _read_kind(self, user_id: str, kind: Kind, read: dict[str, int]) -> list[Any] | None:
        """Everything one connected connector allows, or None when none of this kind is
        connected. A connector that fails reads as empty: the sweep carries on without it."""
        spec = next((c for c in self.config.connectors
                     if c.kind == kind and c.id in self.connected(user_id)), None)  # fmt: skip
        if spec is None:
            return None
        readers: dict[str, Callable[[ConnectorSpec], Awaitable[list[Any]]]] = {
            "mail": self._mail, "calendar": self._calendar, "bank": self._bank,
        }  # fmt: skip
        try:
            items = await readers[kind](spec)
        except Exception as exc:  # one connector down never stops the sweep
            log.warning("connector_failed", connector=spec.id, error_code=type(exc).__name__)
            items = []
        self._note(user_id, spec, len(items))
        read[spec.id] = len(items)
        return items

    # --- the sweep -------------------------------------------------------------------------------

    async def sweep(self, user_id: str) -> dict[str, Any]:
        """Read what each connected connector allows, find what's worth a look, start nothing.
        Returns `{findings, read, took_ms}`; findings in order: late train, engineer visit,
        scam, money arrived."""
        started = time.perf_counter()
        on = self.connected(user_id)
        read = {c.id: 0 for c in self.config.connectors if c.id in on}
        mail, events, bank = await asyncio.gather(
            self._read_kind(user_id, "mail", read),
            self._read_kind(user_id, "calendar", read),
            self._read_kind(user_id, "bank", read),
        )
        messages: list[MailMessage] = mail or []
        today = self.clock().astimezone(LONDON).date()
        found: list[Finding] = []
        rail = next((c for c in self.config.connectors if c.kind == "rail" and c.id in on), None)
        if rail is not None and messages:
            tickets = tickets_in(messages)
            found += [f for t in tickets if (f := await self._late_train(user_id, t))]
            self._note(user_id, rail, len(tickets))
            read[rail.id] = len(tickets)
        for visit in visits_in(events or []):
            under_way = await self._under_way(
                StartOfcom(user_id=user_id, display_name="Friend", operator=visit.provider,
                           event_date=visit.day.isoformat())
            )  # fmt: skip
            if finding := engineer_visit_finding(visit, today, under_way=under_way):
                found.append(finding)
        if self.shield is not None:
            for message in scam_candidates(messages):
                verdict = await self.shield.check(
                    f"{message.subject}\n{message.body}"[:SHIELD_CHARS], sender=message.sender,
                    user_id=user_id, source="connector",
                )  # fmt: skip
                if finding := scam_finding(message, verdict):
                    found.append(finding)
        for credit in credits_in(bank or []):
            promise = promised_by(credit, messages)
            if promise is not None or looks_like_refund(credit):
                found.append(money_arrived_finding(credit, promise))
        findings = in_order(found)
        took_ms = round((time.perf_counter() - started) * 1000)
        self.bus.publish({"type": "sweep_done", "findings": len(findings), "user_id": user_id})
        log.info("sweep_done", findings=len(findings), took_ms=took_ms)
        return {"findings": [f.model_dump(mode="json") for f in findings], "read": read,
                "took_ms": took_ms}  # fmt: skip

    async def _late_train(self, user_id: str, ticket: TicketFacts) -> Finding | None:
        """The same check a claim makes: the rail port, the operator's pack, the claimable delay
        and the rule engine. A train the records don't have, or one not late enough, is no
        finding."""
        try:
            journey = await self.rail.service_delay(
                ticket.origin_crs, ticket.destination_crs, ticket.travel_date, ticket.departure
            )
            pack = self.rules.delay_repay(journey.operator_code)
        except (ServiceNotFound, RailDataUnavailable, NotCovered):
            return None
        except Exception as exc:  # a live rail source that fails is no finding, not a 500
            log.warning("sweep_rail_failed", error_code=type(exc).__name__)
            return None
        delay = claimable_delay(pack, delay=journey.delay_minutes, cancelled=journey.cancelled)
        if delay is None:
            return None
        facts = (
            Fact(key="arrival_delay_min", value=delay, source=journey.source, confidence=1.0),
            Fact(key="fare_gbp", value=ticket.fare_gbp, source="your ticket", confidence=1.0),
        )
        result = evaluate_delay_repay(
            pack, delay_minutes=delay, fare_gbp=ticket.fare_gbp, facts=facts,
            trace_id=f"pt_sweep_{ticket.item}"[:64],
        )  # fmt: skip
        if isinstance(result, NotEligible) or result.amount_gbp <= 0:
            return None
        under_way = await self._under_way(
            StartMission(
                user_id=user_id, display_name="Friend", origin_crs=ticket.origin_crs,
                destination_crs=ticket.destination_crs, travel_date=ticket.travel_date.isoformat(),
                departure=ticket.departure, fare_gbp=ticket.fare_gbp,
            )
        )  # fmt: skip
        return late_train_finding(
            ticket, journey.delay_minutes, result.amount_gbp, cancelled=journey.cancelled,
            under_way=under_way,
        )  # fmt: skip

    async def _under_way(self, request: StartMission | StartOfcom) -> bool:
        """Is this person's claim for this journey or visit already live? The one-claim check
        (`MissionService.duplicate_of`, keyed by `mission_key`), read and never changed."""
        if self.missions is None:
            return False
        return await self.missions.duplicate_of(request) is not None


def places(read: Mapping[str, int], hub: ConnectorHub) -> list[str]:
    """The places a sweep looked, in plain words, in the config's order: email, calendar, bank."""
    kinds = [hub.specs[c].kind for c in read if c in hub.specs]
    return [PLACE[c.kind] for c in hub.config.connectors if c.kind in PLACE and c.kind in kinds]


def _payload(structured: Any, content: Iterable[Any]) -> Any:
    """A tool's answer: its structured content (a list comes wrapped as {"result": [...]}), else
    the JSON in its text."""
    if isinstance(structured, dict):
        return structured["result"] if set(structured) == {"result"} else structured
    if structured is not None:
        return structured
    texts = [str(c.text) for c in content if getattr(c, "type", "") == "text"]
    parsed = [json.loads(t) for t in texts]
    return parsed[0] if len(parsed) == 1 else parsed


def _rows[M: BaseModel](model: type[M], rows: Any) -> list[M]:
    """The rows that read as this model; one odd row is skipped, never the whole connector."""
    found: list[M] = []
    for row in rows if isinstance(rows, list) else []:
        try:
            found.append(model.model_validate(row))
        except ValidationError:
            continue
    return found


def _count(data: Any) -> int:
    if isinstance(data, list):
        return len(data)
    return 0 if data is None else 1


def _failed(spec: ConnectorSpec, exc: Exception, timeout_s: float) -> Exception:
    """What a failed read raises: anyio's task groups wrap what the work raised, so unwrap it;
    a refusal or a connector's own failure stays as it is; the rest says only which connector
    and what kind of failure, never what the server said."""
    leaf: BaseException = exc
    while isinstance(leaf, BaseExceptionGroup) and leaf.exceptions:
        leaf = leaf.exceptions[0]
    if isinstance(leaf, ToolRefused | ConnectorFailed):
        return leaf
    if isinstance(leaf, TimeoutError):
        return ConnectorFailed(f"{spec.name} took longer than {timeout_s:g}s")
    return ConnectorFailed(f"{spec.name} is not answering ({type(leaf).__name__})")


def build_connectors(
    repo: Path,
    service: MissionService,
    shield: ShieldService | None,
    bus: EventBus,
    *,
    mode: str | None = None,
    config_path: Path | None = None,
    data_root: Path | None = None,
) -> ConnectorHub | None:
    """The hub as `main.build` makes it: connectors/connectors.yaml, the service's own rail port,
    rule packs and clock, and the one-claim check. `mode` (TEMPO_MODE) is passed to the servers,
    so a rail lookup through MCP replays when the Gateway does. None when there is no config
    (an image built without `connectors/`): the Gateway runs, the chat says how to connect."""
    path = config_path or repo / "connectors" / "connectors.yaml"
    if not path.is_file():
        log.info("connectors_off", reason="no connectors.yaml")
        return None
    config = ConnectorsConfig.load(path)
    return ConnectorHub(
        config, repo=repo, shield=shield, rail_port=service.deps.rail, rules=service.deps.rules,
        clock=service.deps.clock, bus=bus, missions=service, data_root=data_root,
        env={"TEMPO_MODE": mode} if mode else None,
    )  # fmt: skip


class UserBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(pattern=USER_ID)


def connectors_router(hub: ConnectorHub, web_caller: Any) -> APIRouter:
    router = APIRouter(prefix="/connectors")
    Caller = Annotated[str, Depends(web_caller)]

    def found(connector_id: str) -> str:
        if connector_id not in hub.specs:
            raise HTTPException(404, "no connector has this id")
        return connector_id

    @router.get("")
    async def listing(
        caller: Caller, user_id: Annotated[str, Query(pattern=USER_ID)]
    ) -> dict[str, Any]:
        """The connectors, what each may read (in plain words), and what each has read."""
        return hub.listing(user_id)

    @router.post("/sweep")
    async def sweep(body: UserBody, caller: Caller) -> dict[str, Any]:
        """Read what the connected connectors allow and say what's worth a look. Starts
        nothing: each finding's action is the person's to take."""
        return await hub.sweep(body.user_id)

    @router.post("/{connector_id}/connect")
    async def connect(connector_id: str, body: UserBody, caller: Caller) -> dict[str, Any]:
        return hub.connect(body.user_id, found(connector_id))

    @router.post("/{connector_id}/disconnect")
    async def disconnect(connector_id: str, body: UserBody, caller: Caller) -> dict[str, Any]:
        return hub.disconnect(body.user_id, found(connector_id))

    return router
