"""Tempo as an MCP server (plan.md §14): your AI can ask Tempo, never act for you.

No `from __future__ import annotations`: FastAPI and the MCP SDK read these annotations at runtime.

Any MCP client (Claude Code, Zed, Cursor, Claude Desktop through `mcp-remote`) connects to the
Gateway's `/mcp` with the web app's bearer token. It may check a message, read a letter, start a
claim, see a claim's status and the Time Ledger, screen entitlements and verify an Agent Passport
mandate. **No tool approves anything** (plan.md §1, decision 3: models read and plan; code decides
money, time and permissions). A started claim waits for the person's own yes, given on their own
device, so an assistant that asks Tempo can never spend her consent.

| Tool | Calls (the same as its HTTP route) | Read-only |
|---|---|---|
| check_message | `ShieldService.check` (POST /scam/check) | yes |
| read_letter | vision, then `tempo_core.letters.read_letter` (POST /letters/read) | yes |
| start_rail_claim | the profile check, then `MissionService.start_once` (POST /missions) | no |
| start_missed_visit_claim | the profile check, then `start_once` (POST /missions/ofcom) | no |
| claim_status | `MissionService.view` (GET /missions/{id}) | yes |
| money_returned | `tempo_core.ledger.summarise` (GET /ledger) | yes |
| screen_entitlements | `tempo_core.entitlement.screen` (POST /entitlement/screen) | yes |
| verify_mandate | `MandateService.verify` (POST /mandates/verify) | yes |

Resources: `tempo://rules/{rule_id}` (the rule in words, then its YAML) and
`tempo://profiles/{profile_id}` (the profile's view, as JSON). Prompts: `claim-a-late-train` and
`is-this-a-scam`. Every tool call publishes `{"type": "mcp_call", "tool": ..., "ok": ...}` on the
bus, never the arguments.

Mounting: `mount_mcp(app, ...)` includes one router. It serves `/mcp` (Streamable HTTP, stateless,
JSON responses, behind the bearer) and `GET /mcp/info`, and it carries the SDK session manager's
lifespan, which FastAPI merges into the app's own lifespan when the router is included. So the
whole wiring in `create_app` is that one call.
"""

import inspect
import json
import os
from collections.abc import AsyncIterator, Callable, Collection, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal, cast
from urllib.parse import urlsplit

import yaml
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field, ValidationError
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from tempo_core.entitlement import DISCLAIMER, Answers, Figures, screen
from tempo_core.errors import MissionNotFound, NotCovered
from tempo_core.ledger import summarise
from tempo_core.letters import read_letter
from tempo_core.profiles import ProfileCatalog
from tempo_core.rules import RulePackRegistry
from tempo_core.rules.registry import GENERATED
from tempo_core.rules.schema import ClockPack
from tempo_core.rules.words import rule_in_words
from tempo_core.skills import plain_reasons
from tempo_gateway.engines import OFCOM, RAIL
from tempo_gateway.events import EventBus
from tempo_gateway.letters import MAX_IMAGE_B64, MIME, Caller, Clocks, _facts, _image
from tempo_gateway.mandates import MandateService
from tempo_gateway.missions import (
    MissionService,
    MissionView,
    StartMission,
    StartOfcom,
    profile_refusal,
)
from tempo_gateway.shield import ShieldService
from tempo_ports.vision import VisionPort

INSTRUCTIONS = (
    "Tempo wins back money and time for a person. You may check messages, read letters, start "
    "claims and see their status. You can never approve a claim: the person approves on their "
    "own device."
)
TOOLS = (
    "check_message",
    "read_letter",
    "start_rail_claim",
    "start_missed_visit_claim",
    "claim_status",
    "money_returned",
    "screen_entitlements",
    "verify_mandate",
)
RESOURCES = ("tempo://rules/{rule_id}", "tempo://profiles/{profile_id}")
PROMPTS = ("claim-a-late-train", "is-this-a-scam")
NEEDS_CONSENT_FROM = "the person, on their own device"
WAYS = "the Tempo web app or Face ID"  # how a yes is given; never through an assistant
WAYS_WITH_TEXT = "the Tempo web app, Face ID, or by texting YES"
NO_CLAIM = "No claim has that id."
# A photo of a letter may be 8 MiB, so 11 MiB once base64-encoded; the SDK's default is 4 MiB.
MAX_BODY = MAX_IMAGE_B64 + 256 * 1024
LOOPBACK = ("127.0.0.1", "localhost", "[::1]")
EXTENSION = {mime: ext for ext, mime in MIME.items()}  # image/jpeg -> jpeg

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
# Starting a claim writes a mission but files nothing: the claim waits for the person's yes. The
# same journey twice is the same mission, so a retry is safe.
STARTS_A_CLAIM = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False
)

# The tools' inputs. Each claim's own model (StartMission, StartOfcom) still validates every value,
# exactly as the HTTP routes do; these only describe the inputs to the assistant.
MessageText = Annotated[
    str,
    Field(min_length=1, max_length=2000, description="The message, word for word as it arrived."),
]
Language = Annotated[
    str,
    Field(pattern=r"^[a-z]{2}$", description="Two-letter language for the reply, e.g. en, cy, pl."),
]
ImageB64 = Annotated[
    str,
    Field(
        min_length=1,
        description="The photo of the letter, base64-encoded (a data: URL is fine). 8 MB at most.",
    ),
]
ImageMime = Literal["image/png", "image/jpeg", "image/webp", "image/heic"]
UserId = Annotated[str, Field(description="Tempo's id for the person, e.g. u_margaret.")]
DisplayName = Annotated[str, Field(description="What the person likes to be called.")]
Crs = Annotated[str, Field(description="Three-letter station code, e.g. OXF or PAD.")]
Day = Annotated[str, Field(description="The day, as YYYY-MM-DD.")]
Departure = Annotated[str, Field(description="The train's timetabled departure, as HH:MM.")]
Fare = Annotated[Decimal, Field(description="What the ticket cost, in pounds, e.g. 28.40.")]
ProfileId = Annotated[
    str, Field(description="The Tempo Profile to work under, e.g. commuter. Leave out for none.")
]
Phone = Annotated[
    str,
    Field(description="Their mobile, for updates and a YES by text. Only a hash is kept."),
]
MissionId = Annotated[str, Field(description="The mission_id a start tool gave back.")]


def how_to_approve(name: str, *, by_text: bool) -> str:
    """What the assistant tells the person. Texting YES is offered only when it would work: the
    claim knows their number."""
    ways = WAYS_WITH_TEXT if by_text else WAYS
    return f"{name} approves on their own device: {ways}. An assistant cannot approve."


def build_mcp_server(
    *,
    service: MissionService,
    shield: ShieldService | None,
    profiles: ProfileCatalog | None,
    mandates: MandateService | None,
    vision: VisionPort | None,
    clocks: Clocks,
    holidays: Collection[date],
    entitlement: Figures | None,
    bus: EventBus,
    rules: RulePackRegistry,
    skills_root: Path | None = None,
) -> MCPServer[Any]:
    """The `tempo` MCP server over the Gateway's own services. `skills_root` is where the rule
    packs' YAML files are (default: `$TEMPO_HOME/skills`, else the repository's)."""
    server: MCPServer[Any] = MCPServer("tempo", instructions=INSTRUCTIONS)
    server.middleware.append(_announcer(bus))
    rule_files = _RuleFiles(skills_root or _repo() / "skills")
    tool = _registrar(server)

    def profile_allows(profile_id: str | None, skill_id: str) -> None:
        """The refusals `/missions` gives, in the same words (app.py `profile_allows`)."""
        if profile_id is not None and (profiles is None or profiles.get(profile_id) is None):
            raise ToolError(f"no profile called {profile_id!r} is installed")
        reason = profile_refusal(profiles, profile_id, skill_id)
        if reason is not None:
            raise ToolError(reason)

    def claim(view: MissionView, *, started: bool, name: str, phone: str | None) -> dict[str, Any]:
        texts = phone is not None and view.id in service.missions_for_phone(phone)
        shown = view.model_dump(mode="json")
        waiting = view.ask is not None  # a yes is being asked for, right now
        return {
            "mission_id": view.id,
            "state": shown["state"],
            "started": started,  # False: this journey already had a live claim, and here it is
            "message": view.message,
            "amount_gbp": view.amount_gbp,
            "proof": (shown["ask"] or {}).get("proof_trace"),
            "court": shown["court"],
            "needs_consent_from": NEEDS_CONSENT_FROM if waiting else None,
            "how_to_approve": how_to_approve(name, by_text=texts) if waiting else None,
        }

    @tool(READ_ONLY)
    async def check_message(text: MessageText, language: Language = "en") -> dict[str, Any]:
        """Check a text, email or message the person is unsure about, with Tempo's Scam Shield.
        It looks at the words, the links and the sender. It never calls a message safe."""
        if shield is None:
            raise ToolError("I can't check messages on this Gateway.")
        checked = await shield.check(text, language=language, source="mcp")
        return {key: checked[key] for key in ("level", "zone", "say", "reasons", "why", "advice")}

    @tool(READ_ONLY, name="read_letter")
    async def read_a_letter(
        image_base64: ImageB64, filename: str | None = None, mime_type: ImageMime | None = None
    ) -> dict[str, Any]:
        """Read a photographed letter: what it is, who sent it, any money owed either way, what
        must be done and by when. Anything Tempo is unsure of is listed. The photo isn't kept."""
        if vision is None:
            raise ToolError("Reading photos is off on this Gateway.")
        data, mime = _unwrapped(image_base64, mime_type)
        named = filename or f"letter.{EXTENSION.get(mime or '', 'png')}"
        try:
            facts = await _facts(vision, _image(data), named)
        except HTTPException as exc:  # the route's own words: too big, not whole, unreadable
            raise ToolError(str(exc.detail)) from None
        reading = read_letter(
            facts, today=datetime.now(UTC).date(), clocks=clocks, holidays=holidays
        )
        return reading.model_dump(mode="json")

    @tool(STARTS_A_CLAIM)
    async def start_rail_claim(
        user_id: UserId,
        display_name: DisplayName,
        origin_crs: Crs,
        destination_crs: Crs,
        travel_date: Day,
        departure: Departure,
        fare_gbp: Fare,
        profile_id: ProfileId | None = None,
        phone: Phone | None = None,
    ) -> dict[str, Any]:
        """Start a Delay Repay claim for a late UK train. Tempo checks the rail records and the
        operator's rule and works out what is owed. Then the claim waits: the person approves it
        on their own device, and this tool never can. The same journey twice is one claim."""
        request = _valid(
            StartMission, user_id=user_id, display_name=display_name, phone=phone,
            origin_crs=origin_crs, destination_crs=destination_crs, travel_date=travel_date,
            departure=departure, fare_gbp=fare_gbp, profile_id=profile_id,
        )  # fmt: skip
        profile_allows(request.profile_id, RAIL)
        view, started = await service.start_once(request)
        return claim(view, started=started, name=request.display_name, phone=request.phone)

    @tool(STARTS_A_CLAIM)
    async def start_missed_visit_claim(
        user_id: UserId,
        display_name: DisplayName,
        provider: Annotated[str, Field(description="The broadband or phone company.")],
        visit_date: Annotated[str, Field(description="The day of the missed visit, YYYY-MM-DD.")],
        notice_hours: Annotated[
            Decimal | None,
            Field(description="Hours of notice they gave, if they cancelled. Leave out if none."),
        ] = None,
        profile_id: ProfileId | None = None,
        phone: Phone | None = None,
    ) -> dict[str, Any]:
        """Start a claim for a broadband or phone engineer who didn't come. Tempo plans when to
        act. Nothing is sent until the person approves on their own device; this tool never can.
        The same provider and day twice is one claim."""
        request = _valid(
            StartOfcom, user_id=user_id, display_name=display_name, phone=phone,
            operator=provider, event_date=visit_date, notice_hours=notice_hours,
            source="an assistant, over MCP", profile_id=profile_id,
        )  # fmt: skip
        profile_allows(request.profile_id, OFCOM)
        view, started = await service.start_once(request)
        return claim(view, started=started, name=request.display_name, phone=request.phone)

    @tool(READ_ONLY)
    async def claim_status(mission_id: MissionId) -> dict[str, Any]:
        """Where a claim stands: its state, Tempo's latest message, the amount and the timeline."""
        try:
            view = await service.view(mission_id)
        except MissionNotFound:
            raise ToolError(NO_CLAIM) from None
        shown = view.model_dump(mode="json")
        return {
            "mission_id": view.id,
            "state": shown["state"],
            "message": view.message,
            "amount_gbp": view.amount_gbp,
            "timeline": shown["timeline"],
            "needs_consent_from": NEEDS_CONSENT_FROM if view.ask is not None else None,
        }

    @tool(READ_ONLY)
    async def money_returned() -> dict[str, str]:
        """The Time Ledger: the money and the hours Tempo has won back, counted once paid."""
        totals = summarise(await service.deps.repo.ledger_entries())
        return {  # the same three figures as GET /ledger
            "minutes_returned": str(totals.minutes_returned),
            "hours_returned": str(totals.hours_returned),
            "gbp_recovered": str(totals.gbp_recovered.quantize(Decimal("0.01"))),
        }

    @tool(READ_ONLY)
    async def screen_entitlements(
        age: Annotated[int, Field(description="How old they are.")],
        weekly_income_gbp: Annotated[
            Decimal, Field(description="Roughly what comes in each week, in pounds.")
        ],
        couple: Annotated[bool, Field(description="They live with a partner.")] = False,
        savings_gbp: Annotated[Decimal, Field(description="Roughly their savings.")] = Decimal(0),
        benefits: Annotated[
            list[str] | None, Field(description="Benefits they get now, e.g. Universal Credit.")
        ] = None,
        needs_care_day: Annotated[bool, Field(description="They need help in the day.")] = False,
        needs_care_night: Annotated[bool, Field(description="They need help at night.")] = False,
        care_months: Annotated[int, Field(description="Months they've needed that help.")] = 0,
        terminally_ill: bool = False,
        has_broadband_or_phone: bool = True,
    ) -> dict[str, Any]:
        """A quick check of benefits and discounts worth a look, from ten answers. It is
        screening, not a decision; each flag links the official checker."""
        if entitlement is None:
            raise ToolError("the entitlement figures aren't loaded")
        answers = _valid(
            Answers, age=age, couple=couple, weekly_income_gbp=weekly_income_gbp,
            savings_gbp=savings_gbp, benefits=frozenset(benefits or ()),
            needs_care_day=needs_care_day, needs_care_night=needs_care_night,
            care_months=care_months, terminally_ill=terminally_ill,
            has_broadband_or_phone=has_broadband_or_phone,
        )  # fmt: skip
        return {
            "flags": [flag.model_dump(mode="json") for flag in screen(answers, entitlement)],
            "disclaimer": DISCLAIMER,
            "figures": {"tax_year": entitlement.tax_year, "demo_values": entitlement.demo_values},
        }

    @tool(READ_ONLY)
    async def verify_mandate(
        envelope: Annotated[
            dict[str, Any] | str, Field(description="The signed mandate the agent showed you.")
        ],
        counterparty: Annotated[str, Field(max_length=80, description="Your company's name.")],
        action: Annotated[str, Field(max_length=40, description="What it wants to do: claim.")],
        amount_gbp: Annotated[Decimal | None, Field(description="The amount, if any.")] = None,
    ) -> dict[str, Any]:
        """For a company's agent: is this Agent Passport mandate genuine, live, issued by Tempo,
        and does it cover this action and amount? Fails closed."""
        if mandates is None:
            raise ToolError("mandates are off")
        verdict = mandates.verify(
            envelope, counterparty=counterparty, action=action, amount_gbp=amount_gbp
        )
        return verdict.model_dump(mode="json")

    @server.resource(
        "tempo://rules/{rule_id}", name="rule", mime_type="text/markdown",
        description="A rule pack: the rule in plain words, then the YAML Tempo runs.",
    )  # fmt: skip
    def rule(rule_id: str) -> str:
        try:
            pack = rules.by_id(rule_id)
        except NotCovered as exc:
            raise ResourceNotFoundError(str(exc)) from None
        words = (
            f"{pack.summary} Published at {pack.citation_url}."
            if isinstance(pack, ClockPack)
            else rule_in_words(pack)
        )
        source = rule_files.text(rule_id) or yaml.safe_dump(
            pack.model_dump(mode="json"), sort_keys=False, allow_unicode=True
        )
        return f"{words}\n\n```yaml\n{source.rstrip()}\n```\n"

    @server.resource(
        "tempo://profiles/{profile_id}", name="profile", mime_type="application/json",
        description="A Tempo Profile: what Tempo may and may not do, its limits and access needs.",
    )  # fmt: skip
    def profile(profile_id: str) -> str:
        found = profiles.get(profile_id) if profiles is not None else None
        if profiles is None or found is None:
            raise ResourceNotFoundError("no profile has this id")
        return json.dumps(profiles.view(found).model_dump(mode="json"), indent=2)

    @server.prompt(
        name="claim-a-late-train",
        description="Claim Delay Repay for a late UK train, with the start_rail_claim tool.",
    )
    def claim_a_late_train() -> str:
        return (
            "My train was late and I'd like to claim Delay Repay. Ask me, one question at a time, "
            "for anything you don't know yet: where I got on, where I was going, the day, the "
            "train's departure time and what the ticket cost. Then use Tempo's start_rail_claim "
            "tool. Tempo checks the rail records and works out what I'm owed, so don't work out "
            "an amount yourself. Tell me what Tempo said and how to approve. I approve the claim "
            "myself, on my own device. You can't approve it for me."
        )

    @server.prompt(
        name="is-this-a-scam",
        description="Check a message the person is unsure about, with the check_message tool.",
    )
    def is_this_a_scam(message: str = "") -> str:
        ask = (
            "Use Tempo's check_message tool on the exact words. Then tell me, in plain words, "
            "what Tempo says and why. Don't open any link in it, and don't reply to it."
        )
        if not message.strip():
            return f"I got a message and I'm not sure it's real. Ask me to paste it. {ask}"
        return f"I got this message and I'm not sure it's real. {ask}\n\nThe message:\n{message}"

    return server


def mcp_routes(
    server: MCPServer[Any], web_caller: Caller, public_url: str
) -> tuple[ASGIApp, APIRouter]:
    """The Streamable HTTP endpoint behind the bearer, and a router that serves it at `/mcp`,
    serves `GET /mcp/info`, and runs the SDK's session manager for the app's lifetime.

    Include the router; don't also mount the ASGI app (it is returned for tests and for serving
    elsewhere, where its caller must run `router.lifespan_context` itself). The endpoint is a
    route at exactly `/mcp`, not a mount, so `/mcp` never redirects to `/mcp/` and `/mcp/info`
    stays an ordinary route."""

    def fresh_manager() -> None:
        # Stateless with JSON replies: every POST stands alone (no session to keep or lose
        # across a restart or a tunnel), and the reply is one JSON body that any proxy carries.
        server.streamable_http_app(
            stateless_http=True, json_response=True, max_request_body_size=MAX_BODY,
            transport_security=_allowed_hosts(public_url),
        )  # fmt: skip

    fresh_manager()  # the SDK makes its session manager here; the lifespan replaces it

    @asynccontextmanager
    async def lifespan(_: Any) -> AsyncIterator[None]:
        """A session manager runs once, so each start of the app gets a fresh one."""
        fresh_manager()
        async with server.session_manager.run():
            yield

    async def endpoint(scope: Scope, receive: Receive, send: Send) -> None:
        await server.session_manager.handle_request(scope, receive, send)

    asgi_app = BearerOnly(endpoint, web_caller)
    router = APIRouter(lifespan=lifespan)
    # An object, not a function, so Starlette serves it as ASGI and accepts every method.
    router.add_route("/mcp", cast(Any, asgi_app), include_in_schema=False)

    @router.get("/mcp/info", dependencies=[Depends(web_caller)])
    async def mcp_info() -> dict[str, Any]:
        """For the web's MCP section: where to connect, and what an assistant may use."""
        return await describe(server, public_url)

    return asgi_app, router


def mount_mcp(
    app: FastAPI,
    *,
    web_caller: Caller,
    public_url: str,
    service: MissionService,
    bus: EventBus,
    shield: ShieldService | None = None,
    profiles: ProfileCatalog | None = None,
    mandates: MandateService | None = None,
    vision: VisionPort | None = None,
    holidays: Collection[date] = frozenset(),
    entitlement: Figures | None = None,
) -> MCPServer[Any]:
    """Serve Tempo's MCP server from this app: one call in `create_app`. Calling it twice on one
    app changes nothing."""
    existing = getattr(app.state, "mcp_server", None)
    if existing is not None:
        return cast(MCPServer[Any], existing)
    rules: RulePackRegistry = service.deps.rules
    server = build_mcp_server(
        service=service, shield=shield, profiles=profiles, mandates=mandates, vision=vision,
        clocks=rules.clocks, holidays=holidays, entitlement=entitlement, bus=bus, rules=rules,
    )  # fmt: skip
    _, router = mcp_routes(server, web_caller, public_url)
    app.include_router(router)  # FastAPI merges the router's lifespan into the app's
    app.state.mcp_server = server
    return server


async def describe(server: MCPServer[Any], public_url: str) -> dict[str, Any]:
    """`GET /mcp/info`: the endpoint, the transport, and the tools, resources and prompts."""
    tools = await server.list_tools()
    return {
        "url": public_url.rstrip("/") + "/mcp",
        "transport": "streamable-http",
        "tools": [
            {
                "name": tool.name,
                "description": " ".join((tool.description or "").split()),
                "read_only": bool(tool.annotations and tool.annotations.read_only_hint),
            }
            for tool in tools
        ],
        "resources": [t.uri_template for t in await server.list_resource_templates()],
        "prompts": [p.name for p in await server.list_prompts()],
    }


class BearerOnly:
    """The web's bearer in front of an ASGI app. It calls `web_caller` itself, so the token that
    opens Mission Control opens `/mcp`, compared in constant time, and nothing else does."""

    def __init__(self, app: ASGIApp, web_caller: Caller) -> None:
        self.app, self.web_caller = app, web_caller

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            try:
                self.web_caller(Headers(scope=scope).get("authorization"))
            except HTTPException as exc:
                refused = JSONResponse(
                    {"detail": exc.detail}, status_code=401, headers={"WWW-Authenticate": "Bearer"}
                )
                await refused(scope, receive, send)
                return
        await self.app(scope, receive, send)


def _registrar(
    server: MCPServer[Any],
) -> Callable[..., Callable[[Callable[..., Any]], Callable[..., Any]]]:
    """`@tool(annotations)`: `server.tool`, with the docstring as one plain line of description
    (the SDK would keep the docstring's indentation)."""

    def tool(
        annotations: ToolAnnotations, *, name: str | None = None
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def register(fn: Callable[..., Any]) -> Callable[..., Any]:
            described = " ".join(inspect.cleandoc(fn.__doc__ or "").split())
            server.add_tool(fn, name=name, description=described, annotations=annotations)
            return fn

        return register

    return tool


def _announcer(bus: EventBus) -> Any:
    """MCP middleware: one `mcp_call` event per tool call, ok or not, never the arguments. An
    unknown tool name is reported as "unknown", so a caller can't write into the event stream."""

    async def announce(ctx: ServerRequestContext[Any, Any], call_next: CallNext) -> HandlerResult:
        if ctx.method != "tools/call":
            return await call_next(ctx)
        name = (ctx.params or {}).get("name")
        tool = name if isinstance(name, str) and name in TOOLS else "unknown"
        ok = False
        try:
            result = await call_next(ctx)
            ok = not _is_error(result)
            return result
        finally:
            bus.publish({"type": "mcp_call", "tool": tool, "ok": ok})

    return announce


def _is_error(result: HandlerResult) -> bool:
    if isinstance(result, Mapping):
        return bool(result.get("isError") or result.get("is_error"))
    return bool(getattr(result, "is_error", False))


def _valid[M: BaseModel](model: type[M], **fields: Any) -> M:
    """The claim's own model checks the inputs, as the HTTP body does; the reason in plain words."""
    try:
        return model.model_validate(fields)
    except ValidationError as exc:
        raise ToolError(f"Some details don't look right: {plain_reasons(exc)}") from None


def _unwrapped(image: str, mime_type: str | None) -> tuple[str, str | None]:
    """Accept a data: URL as well as bare base64; its media type counts when none was given."""
    if image.startswith("data:") and "," in image:
        header, _, data = image.partition(",")
        given = header.removeprefix("data:").split(";")[0]
        return data, mime_type or (given if given in EXTENSION else None)
    return image, mime_type


def _allowed_hosts(public_url: str) -> TransportSecuritySettings:
    """DNS-rebinding protection: the Host must be this machine or the Gateway's public address
    (PUBLIC_URL, e.g. the live demo's tunnel). The bearer is still the real lock."""
    hosts = [*LOOPBACK, *(f"{host}:*" for host in LOOPBACK)]
    origins = [f"{scheme}://{host}{port}" for scheme in ("http", "https") for host in LOOPBACK
               for port in ("", ":*")]  # fmt: skip
    public = urlsplit(public_url)
    netloc = public.netloc.rpartition("@")[2]
    if netloc:
        bare = netloc[: -len(f":{public.port}")] if public.port is not None else netloc
        hosts += [netloc, bare, f"{bare}:*"]
        origins += [f"{public.scheme}://{netloc}"]
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=list(dict.fromkeys(hosts)),
        allowed_origins=list(dict.fromkeys(origins)),
    )


def _repo() -> Path:
    """The repository, or TEMPO_HOME in the container image (as main.REPO)."""
    return Path(os.environ.get("TEMPO_HOME") or Path(__file__).resolve().parents[4])


class _RuleFiles:
    """The YAML text of each rule pack, by id, read once from `skills/*/rules/*.yaml` (Skill
    Forge's drafts excluded, as the registry excludes them)."""

    def __init__(self, skills_root: Path) -> None:
        self._root = skills_root
        self._texts: dict[str, str] | None = None

    def text(self, rule_id: str) -> str | None:
        if self._texts is None:
            self._texts = {}
            for path in sorted(self._root.glob("**/rules/*.yaml")):
                if GENERATED in path.relative_to(self._root).parts:
                    continue
                text = path.read_text(encoding="utf-8")
                data = yaml.safe_load(text)
                if isinstance(data, dict) and isinstance(data.get("id"), str):
                    self._texts.setdefault(data["id"], text)
        return self._texts.get(rule_id)
