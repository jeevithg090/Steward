"""The Gateway's HTTP and WebSocket routes (build plan S3.5).

No `from __future__ import annotations` here: FastAPI resolves dependency annotations at
runtime, and the per-app dependencies below are local names.

| Route | Purpose | Security |
|---|---|---|
| POST /missions, GET /missions/{id}, POST /missions/{id}/stop | Mission Control | bearer token |
| POST /missions/ofcom | a missed engineer visit, planned with Rights Decay | bearer token |
| POST /missions/ofcom/read | read the "sorry we missed you" card (vision), then plan | bearer |
| POST /demo/clock, POST /demo/credit/{id} | demo only: jump ahead; the credit arrives | bearer |
| GET /mandates/{id}?digest=, POST /mandates/verify | a company: is it live, ours, enough? | none |
| POST /mandates/{id}/revoke | revoke a mandate (STOP revokes them all) | bearer token |
| POST /approvals/{request_id} | an answer from the web app | bearer (a yes: passkey, if set) |
| POST /scheduler/tick | fire due Watchdog timers now (demos) | bearer token |
| POST /voice/tools/{name} | ElevenLabs server tools | shared secret header |
| POST /voice/post-call | transcripts after a call | HMAC signature |
| GET /memories, POST /memories/{id}/correct | the Memory Card | bearer token |
| DELETE /memories/{id}, DELETE /timeline/{id} | forget, everywhere | bearer token |
| POST /sms/inbound | YES, NO, STOP, HELP, MEMORY, FORGET <thing>, CHECK <message>, TEACH | Twilio |
| POST /entitlement/screen | ten answers in, what's worth claiming out (not a decision) | bearer |
| POST /letters/pip | a PIP decision explained, its deadline, a drafted reconsideration | bearer |
| POST /scam/check, GET /scam/shield, POST /scam/feedback | Scam Shield (shield.py) | bearer |
| WS /events | live updates | token query parameter |
| /mesh/... | devices, pairing, passkey approvals, push (mesh_routes.py) | device token |
| GET /privacy | the Privacy Proof panel's facts | bearer token |
| POST /demo/memory | seed the demo's memories and timeline (TEMPO_DEMO=1 only) | bearer token |
| POST /chat | the web app's front door: one sentence in, what it did out (chat.py) | bearer |
| GET /voice/tts | whether the Gateway can speak (an ElevenLabs key is set) (tts.py) | bearer |
| POST /voice/tts | one sentence to audio/mpeg with the server's key (tts.py) | bearer token |
"""

import asyncio
import base64
import binascii
import hashlib
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any
from xml.sax.saxutils import escape

import httpx
import structlog
from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tempo_adapters.factory import (
    PROVIDER_NAMES,
    brain_provider,
    build_adapters,
    court_providers,
    model_ready,
    models_live,
)
from tempo_adapters.scam import Registers
from tempo_adapters.settings import Settings
from tempo_core.config import profile
from tempo_core.consent import effective_consent
from tempo_core.deadlines import mandatory_reconsideration
from tempo_core.decisions import (
    Evidence,
    PipDecision,
    draft_reconsideration,
    explain,
    unsupported_claims,
)
from tempo_core.entitlement import DISCLAIMER, Answers, Figures, pack, screen
from tempo_core.errors import MissionNotFound, VisionUnavailable
from tempo_core.intake import follow_up
from tempo_core.ledger import summarise
from tempo_core.profiles import ProfileCatalog
from tempo_core.signals import SignalSpec
from tempo_core.stalls import COUNTER_PLAY, Stall, classify
from tempo_core.voice_profile import VoiceProfile, how_to_speak, profile_from, to_initiation
from tempo_crypto.vault import VaultStore
from tempo_gateway.brain import Brain
from tempo_gateway.chat import chat_router, simulated_in
from tempo_gateway.clock import DemoClock
from tempo_gateway.connectors import ConnectorHub, connectors_router
from tempo_gateway.engines import OFCOM, RAIL
from tempo_gateway.events import EventBus
from tempo_gateway.letters import letters_router, payee_router
from tempo_gateway.mandates import MandateService, NoSigningKey
from tempo_gateway.mcp_server import mount_mcp
from tempo_gateway.memory import (
    Memory,
    caller,
    candidates_from_call,
    readback_question,
    write_episodes,
)
from tempo_gateway.mesh import Mesh
from tempo_gateway.mesh_routes import mesh_router, notify_devices
from tempo_gateway.missions import (
    BINDING_SCOPES,
    MissionService,
    MissionView,
    StartMission,
    StartOfcom,
    UnknownRequest,
    profile_refusal,
)
from tempo_gateway.privacy import privacy_proof
from tempo_gateway.profiles import profiles_router
from tempo_gateway.scheduler import run_scheduler
from tempo_gateway.security import (
    SeenKeys,
    elevenlabs_signature_ok,
    secret_matches,
    twilio_signature_ok,
)
from tempo_gateway.shield import ShieldService, shield_router
from tempo_gateway.tools import Toolbox
from tempo_gateway.tts import tts_router
from tempo_memory.entities import VoiceSet
from tempo_memory.extract import extract_candidates
from tempo_memory.service import MemoryCard, NeedsConsent, say_recalled
from tempo_memory.temporal import USUAL_VOICE, UntrustedEpisode, trusted_episode
from tempo_missions.clawback_rail import SignedApproval
from tempo_ports.vision import DocumentKind, VisionPort

log = structlog.get_logger("tempo.gateway")

VOICE_TOOLS = (
    "create_mission",
    "get_case_capsule",
    "log_stall",
    "record_reference",
    "record_consent",
    "request_human",
    "recall_memories",
    "forget_memory",
    "confirm_memory",
    "issue_mandate",  # a spoken yes on the landline becomes a Gateway-signed mandate
    "present_mandate",  # the Negotiator shows the company its authority
    "verify_mandate",  # the company's line checks it (the Sludge Arena verifier)
    "check_message",  # Scam Shield: the caller reads a message out; code answers (shield.py)
)

# One rule for yes on every door (docs/security.md): once a person has a passkey, only the passkey
# says yes. A text or a call that says yes is told so, in plain words, and their device is woken.
# A no or a STOP is taken on every door: ending a claim binds nobody.
SIGNED_YES = {
    "sms": "Tempo: You set up Face ID, so I can't take a yes by text.",
    "voice": "You set up Face ID, so I can't take a yes on a call.",
}
SAY_YES_THERE = "Open Tempo on your device and say yes with Face ID or your fingerprint."
REMINDED = "I've sent your device a reminder."
STILL_NO = {"sms": "Text NO or STOP to say no.", "voice": "You can still say no here."}


def signed_yes_needed(door: str, *, reminded: bool) -> str:
    """What the SMS and phone doors say to a yes only a passkey may give."""
    return " ".join([SIGNED_YES[door], SAY_YES_THERE, *([REMINDED] if reminded else []),
                     STILL_NO[door]])  # fmt: skip


class Answer(BaseModel):
    approved: bool
    limits: dict[str, Decimal] = {}


class DemoMemory(BaseModel):
    """Demo seeding (TEMPO_DEMO=1 only): words go through the Memory Gate, episodes through the
    same strict validation as the Gateway's own."""

    user_id: str
    said: list[str] = []
    episodes: list[dict[str, Any]] = []
    phone: str | None = None  # recognise this caller by number (the Patience Profile)
    display_name: str | None = Field(default=None, max_length=80)
    # Answer yes to every read-back these words raise, as if the person had said yes on a call.
    # Demo seeding only; the response lists what was confirmed, so nothing is hidden.
    confirm_readbacks: bool = False


class Initiation(BaseModel):
    """ElevenLabs' conversation-initiation webhook body (inbound Twilio/SIP calls). Every field is
    optional: a missing one must never stop a call, it only means Tempo's defaults."""

    model_config = ConfigDict(extra="ignore")

    caller_id: str = ""
    agent_id: str = ""
    called_number: str = ""
    call_sid: str = ""
    conversation_id: str = ""


class CardPhoto(BaseModel):
    """A photo of the card or text the provider left. Read by vision; nothing is kept."""

    image_b64: str = Field(max_length=10_000_000)
    mime_type: str = Field(default="image/png", pattern=r"^image/(png|jpeg|webp|heic)$")
    filename: str = Field(default="card.png", max_length=80)
    user_id: str
    display_name: str = Field(default="", max_length=80)  # "": they never gave one
    phone: str | None = None
    time_value_gbp_h: Decimal = Field(default=Decimal("18"), ge=0)


class MandateCheck(BaseModel):
    """A company asks: may this agent do this, for this much? (No login: it's a public check.)"""

    envelope: dict[str, Any]
    counterparty: str = Field(max_length=80)
    action: str = Field(max_length=40)
    amount_gbp: Decimal | None = None


class ClockMove(BaseModel):
    advance_days: int = Field(ge=0, le=400)


class PipLetter(BaseModel):
    decision_date: date  # the date on the decision letter
    daily_living_points: int = Field(ge=0, le=60)
    mobility_points: int = Field(ge=0, le=40)
    reference: str | None = Field(default=None, max_length=40)
    evidence: list[dict[str, str]] = []  # {"activity": ..., "what_happens": ...}


class Correction(BaseModel):
    user_id: str
    text: str = Field(min_length=1, max_length=200)


def _secret(value: Any) -> str | None:
    return value.get_secret_value() if value is not None else None


def create_app(
    service: MissionService,
    settings: Settings,
    bus: EventBus,
    *,
    memory: Memory | None = None,
    mesh: Mesh | None = None,
    holidays: frozenset[date] = frozenset(),
    signals: dict[str, SignalSpec] | None = None,
    entitlement: Figures | None = None,
    registers: Registers | None = None,
    registers_simulated: bool = True,
    vault: VaultStore | None = None,
    transparency: Path | None = None,
    scheduler_interval_s: float | None = None,
    mandates: MandateService | None = None,
    vision: VisionPort | None = None,
    greetings: Mapping[str, str] | None = None,
    profiles: ProfileCatalog | None = None,
    shield: ShieldService | None = None,
    connectors: ConnectorHub | None = None,  # Connectors and the sweep (connectors.py)
    chat_llm: Callable[[str], Awaitable[str | None]] | None = None,  # phrases small talk only
    chat_llm_kind: str | None = None,  # what /health says phrases it: "ollama", "cortex", …
    brain: Brain | None = None,  # the chat's brain: a language model holds the conversation
    toolbox: Toolbox | None = None,  # the brain's look-ups (tools/): started and stopped here
    http: httpx.AsyncClient | None = None,  # for /voice/tts; tests inject a mocked one
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        tasks = []
        if memory is not None:  # before recovery, so re-emitted events reach the timeline
            tasks.append(asyncio.create_task(write_episodes(
                bus, memory, user_for=service.user_for, company_for=service.company_for,
                clock=service.deps.clock,
            )))  # fmt: skip
        if mesh is not None:
            tasks.append(asyncio.create_task(notify_devices(bus, mesh, service)))
        await asyncio.sleep(0)  # let the subscribers start before recovery re-emits events
        await service.recover()  # re-emit what paused missions were waiting for
        if scheduler_interval_s is not None:
            tasks.append(asyncio.create_task(run_scheduler(service, scheduler_interval_s)))
        if toolbox is not None:  # the add-ons start in the background; native tools are ready now
            tasks.append(asyncio.create_task(toolbox.warm()))
        yield
        for task in tasks:
            task.cancel()
        if toolbox is not None:
            await toolbox.close()

    app = FastAPI(title="Tempo Gateway", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.web_origins.split(",") if o.strip()],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Tempo-Device"],
    )
    seen = SeenKeys()
    api_token = _secret(settings.tempo_api_token)
    deployment = profile(settings.tempo_deploy)  # an unknown mode fails here, at start-up
    if settings.tempo_region:  # the profile's region is a default; the real one wins
        deployment = replace(deployment, region=settings.tempo_region)
    extra = court_providers(settings) | (
        {thinker} if (thinker := brain_provider(settings)) else set()
    )
    if extra:  # an NVIDIA or OpenRouter juror, or the chat's brain, sees the person's words too
        region = deployment.region
        if not settings.tempo_region:  # name it where the data goes, only when it really does
            region = " and ".join([region, *(PROVIDER_NAMES[p] for p in sorted(extra))])
        deployment = replace(deployment, extra_ai=extra, region=region)

    def web_caller(authorization: Annotated[str | None, Header()] = None) -> str:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not secret_matches(token, api_token):
            raise HTTPException(401, "a valid bearer token is required")
        return "web:" + hashlib.sha256(token.encode()).hexdigest()[:12]

    Caller = Annotated[str, Depends(web_caller)]
    if mandates is not None:  # STOP revokes every mandate; Mission Control sees the newest
        service.on_stop = mandates.revoke_all
        service.mandate_summary = mandates.summary
    if profiles is not None:  # the claim guard enforces the same profiles the routes check
        service.profiles = profiles
    clock = service.deps.clock
    demo_clock = clock if isinstance(clock, DemoClock) and settings.tempo_demo else None
    simulated = simulated_in(settings)  # the honesty badge's list, shared with /chat
    replay = not models_live(settings)  # the model-backed parts are recorded
    small_talk = "replay" if replay else ("off" if chat_llm is None else chat_llm_kind or "model")
    endpoint = build_adapters(settings).model
    model = (  # the model behind the jurors, small talk and (cloud-gpu) photos, when it is real
        {"kind": endpoint.kind, "name": endpoint.model, "processor": endpoint.processor}
        if not replay and model_ready(settings)
        else None
    )

    @app.exception_handler(MissionNotFound)
    async def not_found(request: Request, exc: MissionNotFound) -> Response:
        return Response(status_code=404, content="mission not found")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        # The honesty badge: what is live and what is simulated in this run.
        return {
            "status": "ok",
            "mode": settings.tempo_mode,
            "demo": settings.tempo_demo,
            "simulated": simulated,
            "deploy": deployment.mode.value,
            "region": deployment.region,
            "third_parties": sorted(deployment.third_parties),
            "clock_offset_days": demo_clock.offset_days if demo_clock else 0,
            # what phrases small talk (replay, off, or the model) and what holds the conversation
            "chat": {"llm": small_talk}
            | ({"brain": f"{brain.provider}:{brain.model}"} if brain else {})
            | (
                {"tools": {"count": len(toolbox.names), "sources": toolbox.providers}}
                if toolbox and brain
                else {}
            ),
            # e.g. our own model on a RunPod GPU (plan.md §13), else null; with whether it answers
            "model": (
                model | (service.model_status.view() if service.model_status else {})
                if model
                else None
            ),
        }

    @app.post("/entitlement/screen")
    async def entitlement_screen(body: Answers, caller: Caller) -> dict[str, Any]:
        """Entitlement Check: screening, not a decision; each flag links the official checker."""
        if entitlement is None:
            raise HTTPException(404, "the entitlement figures aren't loaded")
        flags = screen(body, entitlement)
        return {
            "flags": [f.model_dump(mode="json") for f in flags],
            "disclaimer": DISCLAIMER,
            "pack": pack(body, flags, entitlement),
            "figures": {"tax_year": entitlement.tax_year, "demo_values": entitlement.demo_values},
        }

    @app.post("/letters/pip")
    async def pip_letter(body: PipLetter, caller: Caller) -> dict[str, Any]:
        """Letter Explainer + Decision Challenger: what the decision means, the deadline, and a
        reconsideration letter drafted only from the letter and the person's own words."""
        decision = PipDecision(
            f"{body.decision_date:%-d %B %Y}", body.daily_living_points, body.mobility_points,
            body.reference,
        )  # fmt: skip
        evidence = [
            Evidence(e.get("activity", ""), e.get("what_happens", "")) for e in body.evidence
        ]
        deadline = mandatory_reconsideration(body.decision_date, holidays)
        draft = draft_reconsideration(decision, evidence)
        return {
            "explanation": explain(decision, deadline),
            "deadline": deadline.deadline.isoformat(),
            "post_by": deadline.post_by.isoformat(),
            "draft": draft,
            "unsupported": unsupported_claims(draft, decision, evidence),  # always empty here
        }

    @app.get("/privacy")
    async def privacy(user_id: str, caller: Caller) -> dict[str, Any]:
        """The Privacy Proof panel: each line checked, not claimed."""
        return await privacy_proof(
            user_id, deployment=deployment, image_digest=settings.image_digest,
            transparency=transparency or Path("deploy/transparency"), mesh=mesh, vault=vault,
        )  # fmt: skip

    @app.get("/missions")
    async def list_missions(caller: Caller) -> list[MissionView]:
        return [await service.view(m) for m in reversed(service.mission_ids)]

    @app.get("/ledger")
    async def ledger(caller: Caller) -> dict[str, str]:
        totals = summarise(await service.deps.repo.ledger_entries())
        return {
            "minutes_returned": str(totals.minutes_returned),
            "hours_returned": str(totals.hours_returned),
            "gbp_recovered": str(totals.gbp_recovered.quantize(Decimal("0.01"))),
        }

    def profile_allows(profile_id: str | None, skill_id: str) -> None:
        """A mission may name a Tempo Profile. An unknown one, or one whose `may` lacks what the
        skill needs, is refused with 422 before anything starts; the detail is plain words."""
        if profile_id is not None and (profiles is None or profiles.get(profile_id) is None):
            raise HTTPException(422, f"no profile called {profile_id!r} is installed")
        reason = profile_refusal(profiles, profile_id, skill_id)
        if reason is not None:
            raise HTTPException(422, reason)

    @app.post("/missions", status_code=201)
    async def create_mission(body: StartMission, caller: Caller, response: Response) -> MissionView:
        """Idempotent per journey: this person's live mission for the same train comes back with
        200 instead of a second claim (one declined or failed safe doesn't count), even when the
        same request arrives twice at once."""
        profile_allows(body.profile_id, RAIL)
        view, started = await service.start_once(body)
        if not started:
            response.status_code = 200
        return view

    @app.post("/missions/ofcom", status_code=201)
    async def create_ofcom_mission(
        body: StartOfcom, caller: Caller, response: Response
    ) -> MissionView:
        """A missed engineer visit: Rights Decay decides whether to wait or act, and when.
        Idempotent per provider and day, as `/missions` is per journey."""
        profile_allows(body.profile_id, OFCOM)
        view, started = await service.start_once(body)
        if not started:
            response.status_code = 200
        return view

    @app.post("/missions/ofcom/read")
    async def read_card(body: CardPhoto, caller: Caller) -> dict[str, Any]:
        """The agent reads the card; Rights Decay plans. One read-back first if a fact is unsure."""
        if vision is None:
            raise HTTPException(404, "reading photos is off")
        try:
            facts = await vision.extract(
                base64.b64decode(body.image_b64, validate=True), mime_type=body.mime_type,
                kind=DocumentKind.MISSED_VISIT, filename=body.filename,
            )  # fmt: skip
        except (VisionUnavailable, binascii.Error) as exc:
            raise HTTPException(
                503, f"I couldn't read the card ({exc}). Tell me the date."
            ) from None
        found = {f.key: f for f in facts}
        read = [f.model_dump(mode="json") for f in facts]
        when, who = found.get("event_date"), found.get("operator")
        if when is None or who is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(when.value)):
            return {"facts": read, "question": "I couldn't read the provider or the date. What "
                    "does the card say?", "fact_key": "event_date", "visit": None}  # fmt: skip
        notice, ref = found.get("notice_hours"), found.get("account_ref")
        # A notice period the model gave in words stays text and unsure: read back, never a number.
        hours = notice.value if notice and isinstance(notice.value, Decimal) else None
        visit = StartOfcom(
            user_id=body.user_id, display_name=body.display_name, phone=body.phone,
            operator=str(who.value), event_date=str(when.value), notice_hours=hours,
            account_ref=str(ref.value) if ref else None, time_value_gbp_h=body.time_value_gbp_h,
            source=f"{body.filename}#vision",
        )  # fmt: skip
        question = follow_up(facts)
        if question is not None:  # one read-back; Mission Control starts it once confirmed
            return {"facts": read, "question": question.question, "fact_key": question.fact_key,
                    "visit": visit.model_dump(mode="json")}  # fmt: skip
        view, _ = await service.start_once(visit)  # the same card twice is the same mission
        return {"facts": read, "question": None, "mission": view.model_dump(mode="json")}

    @app.post("/demo/clock")
    async def move_clock(body: ClockMove, caller: Caller) -> dict[str, Any]:
        """Demo only: jump ahead (the badge says so), then fire whatever timers are now due."""
        if demo_clock is None:
            raise HTTPException(404, "the clock only moves in demo mode (TEMPO_DEMO=1)")
        now = demo_clock.advance(body.advance_days)
        bus.publish({"type": "clock_moved", "offset_days": demo_clock.offset_days})
        return {"now": now.isoformat(), "offset_days": demo_clock.offset_days,
                "fired": await service.tick()}  # fmt: skip

    def mandates_or_404() -> MandateService:
        if mandates is None:
            raise HTTPException(404, "mandates are off")
        return mandates

    @app.get("/mandates/{mandate_id}")
    async def mandate_status(mandate_id: str, digest: str | None = None) -> dict[str, str]:
        """Status only, never the mandate. With its digest, "active" only for the exact one."""
        return {"status": mandates_or_404().status(mandate_id, digest)}

    @app.post("/mandates/verify")
    async def verify_mandate(body: MandateCheck) -> dict[str, Any]:
        verdict = mandates_or_404().verify(
            body.envelope, counterparty=body.counterparty, action=body.action,
            amount_gbp=body.amount_gbp,
        )  # fmt: skip
        mandate = body.envelope.get("mandate") if isinstance(body.envelope, dict) else None
        bus.publish({
            "type": "mandate_verified" if verdict.ok else "mandate_refused",
            "mission_id": str(((mandate or {}).get("matter") or {}).get("mission_id", "")),
            "action": body.action, "reason": verdict.reason,
            "latency_ms": round(verdict.latency_ms, 3), "counterparty": body.counterparty,
        })  # fmt: skip
        return verdict.model_dump(mode="json")

    @app.post("/mandates/{mandate_id}/revoke")
    async def revoke_mandate(mandate_id: str, caller: Caller) -> dict[str, str]:
        status = await mandates_or_404().revoke(mandate_id, device_sig=caller)
        if status == "unknown":
            raise HTTPException(404, "no such mandate")
        bus.publish({"type": "mandate_revoked", "mandate_id": mandate_id})
        return {"status": status}

    @app.post("/demo/credit/{mission_id}")
    async def credit_arrives(mission_id: str, caller: Caller) -> dict[str, bool]:
        """Demo only: the provider's automatic credit shows up on the next bill."""
        if not settings.tempo_demo:
            raise HTTPException(404, "only in demo mode (TEMPO_DEMO=1)")
        await service.user_for(mission_id)  # 404 if there is no such mission
        service.credited.add(mission_id)
        return {"credited": True}

    @app.get("/missions/{mission_id}")
    async def get_mission(mission_id: str, caller: Caller) -> MissionView:
        return await service.view(mission_id)

    @app.post("/missions/{mission_id}/stop")
    async def stop_mission(mission_id: str, caller: Caller) -> MissionView:
        return await service.stop(mission_id, device_sig=caller)

    @app.post("/scheduler/tick")
    async def tick(caller: Caller) -> dict[str, list[str]]:
        """Fire the timers that are due now (the scheduler also does this every 30 s)."""
        return {"fired": await service.tick()}

    async def passkey_holder(mission_id: str) -> str | None:
        """The person behind this mission if they have a passkey: then only it can say yes."""
        if mesh is None:
            return None
        user_id = await service.user_for(mission_id)
        return user_id if mesh.has_passkey(user_id) else None

    async def remind(user_id: str) -> bool:
        """Wake the device that can sign (the push says only "sync"). Never fails the reply."""
        if mesh is None:
            return False
        try:
            return await mesh.notify(user_id) is not None
        except Exception as exc:  # a push failure must never stop an answer
            log.warning("push_failed", error_code=type(exc).__name__)
            return False

    @app.post("/approvals/{request_id}")
    async def approve(request_id: str, body: Answer, caller: Caller) -> MissionView:
        """An answer with the bearer. Once the person has a passkey, a yes must be signed on one
        of their devices (`/mesh/approvals`); a no is still taken here, as STOP is."""
        mission_id = service.mission_for_request(request_id)
        if body.approved and mission_id is not None and await passkey_holder(mission_id):
            raise HTTPException(403, "approve with your passkey on one of your devices")
        approval = SignedApproval(
            approved=body.approved,
            scopes=BINDING_SCOPES,
            device_sig=caller,
            limits=tuple((k, str(v)) for k, v in body.limits.items()),
        )
        try:
            return await service.answer(request_id, approval)
        except UnknownRequest:
            raise HTTPException(404, "nothing is waiting for this answer") from None

    def memory_or_404() -> Memory:
        if memory is None:
            raise HTTPException(404, "memory is off")
        return memory

    @app.get("/memories")
    async def memory_card(user_id: str, caller: Caller) -> MemoryCard:
        return await memory_or_404().card(user_id)

    @app.post("/memories/{item_id}/correct")
    async def correct_memory(item_id: str, body: Correction, caller: Caller) -> dict[str, Any]:
        try:
            item = await memory_or_404().correct(body.user_id, item_id, body.text)
        except KeyError:
            raise HTTPException(404, "no such memory") from None
        except NeedsConsent as exc:
            raise HTTPException(409, f"say yes to remembering {exc} details first") from None
        return item.model_dump(mode="json")

    @app.delete("/memories/{item_id}")
    async def forget_memory(item_id: str, user_id: str, caller: Caller) -> dict[str, bool]:
        return {"forgotten": await memory_or_404().forget_item(user_id, item_id)}

    @app.delete("/timeline/{episode_id}")
    async def forget_episode(episode_id: str, user_id: str, caller: Caller) -> dict[str, bool]:
        return {"forgotten": await memory_or_404().forget_episode(user_id, episode_id)}

    @app.post("/demo/memory")
    async def seed_memory(body: DemoMemory, caller: Caller) -> dict[str, Any]:
        if not settings.tempo_demo or memory is None:
            raise HTTPException(404, "seeding is only for demo mode (TEMPO_DEMO=1)")
        now = service.deps.clock()
        said = [
            c
            for text in body.said
            for c in extract_candidates(text, body.user_id, "user_voice", now)
        ]
        verdicts = await memory.propose(said)
        confirmed: list[str] = []
        while body.confirm_readbacks and memory.readbacks[body.user_id] and len(confirmed) < 20:
            answered = await memory.confirm(body.user_id, True)
            if answered is not None:
                confirmed.append(answered.text)
        if body.phone:
            service.register_phone(body.phone, body.user_id, body.display_name)
        try:
            episodes = [trusted_episode(e) for e in body.episodes]
        except UntrustedEpisode as exc:
            raise HTTPException(422, str(exc)) from None
        facts = [f for e in episodes for f in await memory.temporal.write(e)]
        seeded: dict[str, Any] = {"memories": [v.value for v in verdicts], "facts": len(facts)}
        if body.confirm_readbacks:
            seeded["confirmed"] = confirmed
        return seeded

    # The Patience Profile: how to speak with each caller, from what they told Tempo themselves.
    voice_greetings = dict(greetings or {})

    async def _voice_profile(user_id: str) -> VoiceProfile:
        if memory is None:
            return VoiceProfile()
        now = service.deps.clock()
        items = await memory.memory.list_for_user(user_id)
        live = [(i.category, i.text) for i in items if i.expires_at is None or i.expires_at > now]
        return profile_from(live)

    async def _note_voice(user_id: str, profile: VoiceProfile, conversation_id: str) -> None:
        """A dated timeline line for a call that sounds different, and one more when it goes back
        to the usual (after a forget), so the timeline never shows a setting that no longer applies.
        Memory must never stop a call, so a failed write is only logged."""
        if memory is None:
            return
        try:
            current = [
                f for f in await memory.temporal.timeline(user_id)
                if f.kind == "voice" and f.valid_to is None
            ]  # fmt: skip
            was_usual = not current or current[-1].object.startswith(USUAL_VOICE)
            if not profile.adjusted and was_usual:
                return
            call = re.sub(r"[^A-Za-z0-9_-]", "_", conversation_id)[:40] or uuid.uuid4().hex[:12]
            await memory.temporal.write(VoiceSet(
                id=f"voice_{call}", user_id=user_id, at=service.deps.clock(),
                language=profile.language, speed=profile.speed, voice=profile.voice,
                patience=profile.patience, prefers_text=profile.prefers_text,
            ))  # fmt: skip
        except Exception as exc:  # memory must never break a call
            log.warning("voice_profile_note_failed", error_code=type(exc).__name__)

    @app.post("/voice/initiation")
    async def voice_initiation(
        body: Initiation, x_tempo_voice_secret: Annotated[str | None, Header()] = None
    ) -> dict[str, Any]:
        """ElevenLabs calls this as an inbound call connects: who is it, and how to speak?"""
        if deployment.voice == "off":
            raise HTTPException(404, f"voice is off in {deployment.mode} mode")
        if not secret_matches(x_tempo_voice_secret, _secret(settings.voice_tool_secret)):
            raise HTTPException(401, "unknown caller")
        user_id = service.user_for_phone(body.caller_id) if body.caller_id else None
        profile = await _voice_profile(user_id) if user_id else VoiceProfile()
        voices = {"default": settings.elevenlabs_voice_tempo or "",
                  "low": settings.elevenlabs_voice_tempo_low or ""}  # fmt: skip
        answer = to_initiation(
            profile, user_id=user_id, display_name=service.name_for(user_id) if user_id else None,
            voices=voices, greetings=voice_greetings,
        )  # fmt: skip
        if user_id:
            await _note_voice(user_id, profile, body.conversation_id)
            if profile.adjusted:
                bus.publish({
                    "type": "profile_applied", "user_id": user_id, "language": profile.language,
                    "speed": str(profile.speed), "voice": profile.voice,
                    "patience": profile.patience, "prefers_text": str(profile.prefers_text).lower(),
                })  # fmt: skip
        log.info("voice_initiation", known=user_id is not None, adjusted=profile.adjusted)
        return answer

    @app.get("/voice/profile")
    async def voice_profile(user_id: str, caller: Caller) -> dict[str, Any]:
        """What Tempo would send ElevenLabs for this person, for Mission Control. Voice ids are
        shown as the names of their settings, never the ids themselves."""
        profile = await _voice_profile(user_id)
        names = {"default": "ELEVENLABS_VOICE_TEMPO", "low": "ELEVENLABS_VOICE_TEMPO_LOW"}
        return {
            "user_id": user_id,
            "display_name": service.name_for(user_id),
            "profile": profile.model_dump(mode="json"),
            "adjusted": profile.adjusted,
            "how_to_speak": how_to_speak(profile),
            "initiation": to_initiation(
                profile,
                user_id=user_id,
                display_name=service.name_for(user_id),
                voices=names,
                greetings=voice_greetings,
            ),
            "low_voice_configured": bool(settings.elevenlabs_voice_tempo_low),
        }

    @app.post("/voice/tools/{name}")
    async def voice_tool(
        name: str, request: Request, x_tempo_voice_secret: Annotated[str | None, Header()] = None
    ) -> dict[str, Any]:
        if deployment.voice == "off":
            raise HTTPException(404, f"voice is off in {deployment.mode} mode")
        if not secret_matches(x_tempo_voice_secret, _secret(settings.voice_tool_secret)):
            raise HTTPException(401, "unknown caller")
        if name not in VOICE_TOOLS:
            raise HTTPException(404, f"no voice tool {name!r}")
        try:
            return await _voice(name, await request.json())
        except ValidationError as exc:
            raise HTTPException(422, exc.errors(include_url=False)) from None

    async def _voice(name: str, body: dict[str, Any]) -> dict[str, Any]:
        if name == "check_message":  # Scam Shield: the caller's words in, the words to say out
            if shield is None:
                return {"say": "I can't check messages on this line yet."}
            user_id = str(
                body.get("user_id") or service.user_for_phone(str(body.get("phone", ""))) or ""
            )
            language = (await _voice_profile(user_id)).language if user_id else "en"
            checked = await shield.check(
                str(body.get("text", ""))[:2000], sender=str(body.get("sender") or "") or None,
                language=language, user_id=user_id or None, source="voice",
            )  # fmt: skip
            return {k: checked[k] for k in ("say", "level", "zone", "why", "confidence")}
        if name == "create_mission":
            start = StartMission.model_validate(body)
            refused = profile_refusal(profiles, start.profile_id, RAIL)
            if refused is not None:  # the same refusal the web gets, before anything starts
                return {"mission_id": None, "state": None, "say": refused}
            view, _ = await service.start_once(start)  # never twice, even at the same instant
            return {"mission_id": view.id, "state": view.state, "say": view.message}
        if name in ("recall_memories", "forget_memory", "confirm_memory"):
            return await _voice_memory(name, body)
        if name in ("issue_mandate", "present_mandate", "verify_mandate"):
            return await _voice_mandate(name, body)
        mission_id = str(body.get("mission_id", ""))
        if name == "get_case_capsule":
            view = await service.view(mission_id)
            return {"mission_id": mission_id, "state": view.state, "say": view.message}
        if name == "record_consent":
            request_id = service.pending_for(mission_id)
            if request_id is None:
                return {"say": "There's nothing waiting for your answer."}
            approved = bool(body.get("approved"))
            holder = await passkey_holder(mission_id) if approved else None
            if holder is not None:  # a spoken yes is not a passkey: nothing is answered
                view = await service.view(mission_id)
                said = signed_yes_needed("voice", reminded=await remind(holder))
                return {"mission_id": mission_id, "state": view.state, "say": said}
            sig = f"voice:{body.get('conversation_id', 'unknown')}"
            approval = SignedApproval(approved=approved, scopes=BINDING_SCOPES, device_sig=sig)
            view = await service.answer(request_id, approval)
            return {"mission_id": mission_id, "state": view.state, "say": view.message}
        event = {"type": name, **{k: str(v) for k, v in body.items()}}
        if name == "log_stall":  # the Stall Radar: trust the rules over the model's label
            stall = classify(event.get("quote", "")) or _known(event.get("category", ""))
            event["category"] = stall.value if stall else "unknown"
            event["counter"] = COUNTER_PLAY[stall] if stall else ""
        bus.publish(event)
        return {"ok": True}

    async def _voice_mandate(name: str, body: dict[str, Any]) -> dict[str, Any]:
        if mandates is None:
            return {"say": "I can't show my authority on this line yet."}
        mission_id = str(body.get("mission_id", ""))
        if name == "verify_mandate":
            heard = mandates.envelope(str(body.get("mandate_id", "")))  # read out on the call
            envelope = body.get("envelope") or (heard.model_dump(mode="json") if heard else {})
            check = MandateCheck(
                envelope=envelope,
                counterparty=str(body.get("counterparty", "")),
                action=str(body.get("action", "")),
                amount_gbp=body.get("amount_gbp"),
            )
            result = await verify_mandate(check)
            return {"say": result["message"], **result}
        if name == "present_mandate":
            signed = mandates.active_for(mission_id)
            if signed is None:
                return {"say": "I don't hold a signed mandate for this.", "error": "no mandate"}
            mandate_id = signed.mandate.mandate_id
            return {
                "say": f"My mandate is {mandate_id}. It covers this claim only.",
                "mandate_id": mandate_id, "envelope": signed.model_dump(mode="json"),
            }  # fmt: skip
        consent = effective_consent(await service.deps.repo.consents(mission_id), clock())
        matter = service.matter_for(mission_id)
        if not consent.allows("file_claim") or not matter.get("counterparty"):
            return {"say": "I need your yes first, so I haven't issued a mandate."}
        try:
            signed = mandates.issue_spoken(mandates.draft(
                mission_id=mission_id, user_id=await service.user_for(mission_id),
                display_name=str(body.get("display_name") or "the caller"),
                counterparty=str(matter["counterparty"]), skill_id=str(matter["skill_id"]),
                amount_gbp=Decimal(str(matter.get("amount_gbp") or "0")),
                rule_id=matter.get("rule_id"), account_ref=matter.get("account_ref"),
            ))  # fmt: skip
        except NoSigningKey:
            return {"say": "I can't issue a mandate on this line yet."}
        issued = signed.mandate.mandate_id
        bus.publish(
            {"type": "mandate_issued", "mission_id": mission_id, "mandate_id": issued,
             "assurance": "gateway-attested"}
        )  # fmt: skip
        return {
            "say": "Done. I hold your mandate for this claim only.",
            "mandate_id": signed.mandate.mandate_id,
        }

    async def _voice_memory(name: str, body: dict[str, Any]) -> dict[str, Any]:
        user_id = str(
            body.get("user_id") or service.user_for_phone(str(body.get("phone", ""))) or ""
        )
        if memory is None or not user_id:
            return {"say": "I can't look up what I remember right now."}
        if name == "recall_memories":
            recalled = await memory.recall(user_id)
            waiting = memory.readbacks[user_id]
            return {
                "say": say_recalled(recalled),
                "memories": [r.model_dump(mode="json") for r in recalled],
                "ask_first": readback_question(waiting[0]) if waiting else None,
            }
        if name == "confirm_memory":
            answered = await memory.confirm(user_id, bool(body.get("approved")))
            if answered is None:
                return {"say": "There's nothing waiting for your answer."}
            if body.get("approved"):
                return {"say": f"Thanks. I'll remember that: {answered.text}."}
            return {"say": "OK, I won't remember that."}
        forgotten = await memory.forget(user_id, str(body.get("thing", "")))
        if forgotten is None:
            return {"say": "I couldn't find that in what I remember."}
        return {"say": f"Done. I've forgotten: {forgotten.text}. It's gone from all your devices."}

    @app.post("/voice/post-call")
    async def post_call(
        request: Request, elevenlabs_signature: Annotated[str | None, Header()] = None
    ) -> dict[str, bool]:
        if deployment.voice == "off":
            raise HTTPException(404, f"voice is off in {deployment.mode} mode")
        body = await request.body()
        if not elevenlabs_signature_ok(
            _secret(settings.elevenlabs_webhook_secret), elevenlabs_signature, body
        ):
            raise HTTPException(401, "bad signature")
        payload = await request.json()
        data = payload.get("data") or {}
        conversation = str(data.get("conversation_id", ""))
        if conversation and seen.first_time(f"call:{conversation}"):
            bus.publish({"type": "call_ended", "conversation_id": conversation})
            # Only calls with the person: the Negotiator's calls are a company talking.
            inbound = settings.elevenlabs_agent_inbound_id
            if memory is not None and inbound and data.get("agent_id") == inbound:
                user_id, phone = caller(payload)
                user_id = user_id or (service.user_for_phone(phone) if phone else None)
                if user_id:
                    await memory.propose(
                        candidates_from_call(payload, user_id, service.deps.clock())
                    )
        return {"ok": True}

    @app.post("/sms/inbound")
    async def sms_inbound(
        request: Request, x_twilio_signature: Annotated[str | None, Header()] = None
    ) -> Response:
        form = {k: str(v) for k, v in (await request.form()).items()}
        url = settings.public_url.rstrip("/") + "/sms/inbound"
        if not twilio_signature_ok(
            _secret(settings.twilio_auth_token), url, form, x_twilio_signature
        ):
            raise HTTPException(403, "bad Twilio signature")
        if not seen.first_time(f"sms:{form.get('MessageSid', '')}"):
            return _twiml(None)  # Twilio retried; we already acted on it
        return _twiml(
            await _sms(form.get("From", ""), form.get("Body", ""), form.get("MessageSid", ""))
        )

    async def _sms(sender: str, text: str, sid: str) -> str:
        word = text.strip().split(" ")[0].upper() if text.strip() else ""
        if word == "CHECK":  # a forwarded message, checked the same way as every other door
            if shield is None:
                return "Tempo: I can't check messages right now."
            message = text.strip()[len("CHECK") :].strip()
            if not message:
                return "Tempo: text CHECK, then the message you're unsure about."
            user_id = service.user_for_phone(sender)
            language = (await _voice_profile(user_id)).language if user_id else "en"
            checked = await shield.check(message, language=language, user_id=user_id, source="sms")
            shield.remember_checked(sender, message)
            return (
                f"Tempo: {checked['say']} (Text TEACH within ten minutes if I may keep this "
                "message to learn from.)"
            )
        if word == "TEACH":  # keep the last checked message as a labelled example, by request
            kept = shield.teach(sender) if shield is not None else None
            if kept is None:
                return "Tempo: nothing to keep. Text CHECK and a message first, then TEACH."
            return (
                "Tempo: Thank you. I've kept that one message to learn from. "
                "FORGET TEACH removes it."
            )
        if text.strip().upper() == "FORGET TEACH":
            gone = shield.forget_teaching(sender) if shield is not None else 0
            return (
                f"Tempo: forgotten. The {gone} message(s) you taught me are gone."
                if gone
                else ("Tempo: nothing you taught me is kept, so nothing to forget.")
            )
        if word in ("MEMORY", "FORGET") and memory is not None:
            user_id = service.user_for_phone(sender)
            if user_id is None:
                return "Tempo: I don't know this number yet."
            if word == "MEMORY":
                return f"Tempo: {say_recalled(await memory.recall(user_id))}"
            thing = text.strip()[len("FORGET") :].strip()
            forgotten = await memory.forget(user_id, thing) if thing else None
            if forgotten is None:
                return "Tempo: I couldn't find that. Text MEMORY to see what I remember."
            return f"Tempo: forgotten: {forgotten.text}. It's gone from all your devices."
        missions = service.missions_for_phone(sender)
        if word == "HELP" or not missions:
            return (
                "Tempo: reply YES to approve, NO to decline, STOP to stop everything, "
                "MEMORY to hear what I remember, FORGET and a word to delete it, CHECK and a "
                "message you're unsure about."
            )
        latest = missions[-1]
        if word == "STOP":
            for mission_id in missions:
                await service.stop(mission_id, device_sig=f"sms:{sid}")
            return "Tempo: stopped. Nothing more will be sent."
        request_id = service.pending_for(latest)
        if word not in ("YES", "NO") or request_id is None:
            return "Tempo: there's nothing waiting for your answer."
        holder = await passkey_holder(latest) if word == "YES" else None
        if holder is not None:  # a text is not a passkey: nothing is answered
            return signed_yes_needed("sms", reminded=await remind(holder))
        approval = SignedApproval(
            approved=word == "YES", scopes=BINDING_SCOPES, device_sig=f"sms:{sid}"
        )
        view = await service.answer(request_id, approval)
        return f"Tempo: {view.message}"

    if mesh is not None:
        app.include_router(
            mesh_router(
                mesh, service, settings, web_caller, bus=bus, signals=signals, mandates=mandates,
                shield=shield,
            )
        )  # fmt: skip
    if shield is not None:  # Scam Shield: the check, the Shield log and feedback (shield.py)
        app.include_router(shield_router(shield, web_caller))
    if profiles is not None:  # Tempo Profiles: the catalogue, share codes and the import check
        app.include_router(
            profiles_router(
                profiles, web_caller, web_origin=settings.web_origins.split(",")[0].strip()
            )
        )
    if vision is not None:  # Read It To Me: a photographed letter, read back in plain words
        app.include_router(letters_router(vision, service.deps.rules.clocks, holidays, web_caller))
    if registers is not None:  # Before You Pay: Tempo never moves money; it checks the payee first
        app.include_router(
            payee_router(web_caller, registers=registers, registers_simulated=registers_simulated)
        )
    if connectors is not None:  # Connectors: read-only MCP servers and the sweep (plan.md §14)
        app.include_router(connectors_router(connectors, web_caller))
    # The web app's front door: the same services as the SMS and voice doors, one sentence at a time
    app.include_router(
        chat_router(
            service, web_caller, shield=shield, memory=memory, profiles=profiles,
            settings=settings, bus=bus, llm_say=chat_llm, simulated=simulated, mesh=mesh,
            connectors=connectors, brain=brain,
        )
    )  # fmt: skip
    # Tempo as an MCP server (plan.md §14): any MCP client may ask; none can approve (mcp_server.py)
    mount_mcp(
        app, web_caller=web_caller, public_url=settings.public_url, service=service, bus=bus,
        shield=shield, profiles=profiles, mandates=mandates, vision=vision, holidays=holidays,
        entitlement=entitlement,
    )  # fmt: skip
    app.include_router(tts_router(settings, web_caller, http))  # speech out, key on the server

    @app.websocket("/events")
    async def events(socket: WebSocket, token: str = "") -> None:
        if not secret_matches(token, api_token):
            await socket.close(code=4401)
            return
        await socket.accept()
        async with bus.subscribe() as queue:
            try:
                while True:
                    await socket.send_json(await queue.get())
            except WebSocketDisconnect:
                return

    return app


def _known(category: str) -> Stall | None:
    try:
        return Stall(category)
    except ValueError:
        return None


def _twiml(message: str | None) -> Response:
    body = f"<Message>{escape(message)}</Message>" if message else ""
    return Response(
        f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>',
        media_type="application/xml",
    )
