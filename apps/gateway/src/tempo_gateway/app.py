"""The Gateway's HTTP and WebSocket routes (build plan S3.5).

No `from __future__ import annotations` here: FastAPI resolves dependency annotations at
runtime, and the per-app dependencies below are local names.

| Route | Purpose | Security |
|---|---|---|
| POST /missions, GET /missions/{id}, POST /missions/{id}/stop | Mission Control | bearer token |
| POST /approvals/{request_id} | an answer from the web app | bearer token (passkeys: S5.2) |
| POST /scheduler/tick | fire due Watchdog timers now (demos) | bearer token |
| POST /voice/tools/{name} | ElevenLabs server tools | shared secret header |
| POST /voice/post-call | transcripts after a call | HMAC signature |
| GET /memories, POST /memories/{id}/correct | the Memory Card | bearer token |
| DELETE /memories/{id}, DELETE /timeline/{id} | forget, everywhere | bearer token |
| POST /sms/inbound | YES / NO / STOP / HELP / MEMORY / FORGET <thing> | Twilio signature |
| WS /events | live updates | token query parameter |
| /mesh/... | devices, pairing, passkey approvals, push (mesh_routes.py) | device token |
| POST /demo/memory | seed the demo's memories and timeline (TEMPO_DEMO=1 only) | bearer token |
"""

import asyncio
import hashlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Annotated, Any
from xml.sax.saxutils import escape

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
from pydantic import BaseModel, Field, ValidationError

from tempo_adapters.settings import Settings
from tempo_core.errors import MissionNotFound
from tempo_core.ledger import summarise
from tempo_core.stalls import COUNTER_PLAY, Stall, classify
from tempo_gateway.events import EventBus
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
    UnknownRequest,
)
from tempo_gateway.scheduler import run_scheduler
from tempo_gateway.security import (
    SeenKeys,
    elevenlabs_signature_ok,
    secret_matches,
    twilio_signature_ok,
)
from tempo_memory.extract import extract_candidates
from tempo_memory.service import MemoryCard, NeedsConsent, say_recalled
from tempo_memory.temporal import UntrustedEpisode, trusted_episode
from tempo_missions.clawback_rail import SignedApproval

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
)


class Answer(BaseModel):
    approved: bool
    limits: dict[str, Decimal] = {}


class DemoMemory(BaseModel):
    """Demo seeding (TEMPO_DEMO=1 only): words go through the Memory Gate, episodes through the
    same strict validation as the Gateway's own."""

    user_id: str
    said: list[str] = []
    episodes: list[dict[str, Any]] = []


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
    scheduler_interval_s: float | None = None,
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
        yield
        for task in tasks:
            task.cancel()

    app = FastAPI(title="Tempo Gateway", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.web_origins.split(",") if o.strip()],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Tempo-Device"],
    )
    seen = SeenKeys()
    api_token = _secret(settings.tempo_api_token)

    def web_caller(authorization: Annotated[str | None, Header()] = None) -> str:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not secret_matches(token, api_token):
            raise HTTPException(401, "a valid bearer token is required")
        return "web:" + hashlib.sha256(token.encode()).hexdigest()[:12]

    Caller = Annotated[str, Depends(web_caller)]

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
            "simulated": ["company"]
            + (["rail data", "jurors"] if settings.tempo_mode == "replay" else []),
        }

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

    @app.post("/missions", status_code=201)
    async def create_mission(body: StartMission, caller: Caller) -> MissionView:
        return await service.start(body)

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

    @app.post("/approvals/{request_id}")
    async def approve(request_id: str, body: Answer, caller: Caller) -> MissionView:
        mission_id = service.mission_for_request(request_id)
        user_id = await service.user_for(mission_id) if mission_id is not None else None
        if mesh is not None and user_id is not None and mesh.has_passkey(user_id):
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
        try:
            episodes = [trusted_episode(e) for e in body.episodes]
        except UntrustedEpisode as exc:
            raise HTTPException(422, str(exc)) from None
        facts = [f for e in episodes for f in await memory.temporal.write(e)]
        return {"memories": [v.value for v in verdicts], "facts": len(facts)}

    @app.post("/voice/tools/{name}")
    async def voice_tool(
        name: str, request: Request, x_tempo_voice_secret: Annotated[str | None, Header()] = None
    ) -> dict[str, Any]:
        if not secret_matches(x_tempo_voice_secret, _secret(settings.voice_tool_secret)):
            raise HTTPException(401, "unknown caller")
        if name not in VOICE_TOOLS:
            raise HTTPException(404, f"no voice tool {name!r}")
        try:
            return await _voice(name, await request.json())
        except ValidationError as exc:
            raise HTTPException(422, exc.errors(include_url=False)) from None

    async def _voice(name: str, body: dict[str, Any]) -> dict[str, Any]:
        if name == "create_mission":
            view = await service.start(StartMission.model_validate(body))
            return {"mission_id": view.id, "state": view.state, "say": view.message}
        if name in ("recall_memories", "forget_memory", "confirm_memory"):
            return await _voice_memory(name, body)
        mission_id = str(body.get("mission_id", ""))
        if name == "get_case_capsule":
            view = await service.view(mission_id)
            return {"mission_id": mission_id, "state": view.state, "say": view.message}
        if name == "record_consent":
            request_id = service.pending_for(mission_id)
            if request_id is None:
                return {"say": "There's nothing waiting for your answer."}
            sig = f"voice:{body.get('conversation_id', 'unknown')}"
            approval = SignedApproval(
                approved=bool(body.get("approved")), scopes=BINDING_SCOPES, device_sig=sig
            )
            view = await service.answer(request_id, approval)
            return {"mission_id": mission_id, "state": view.state, "say": view.message}
        event = {"type": name, **{k: str(v) for k, v in body.items()}}
        if name == "log_stall":  # the Stall Radar: trust the rules over the model's label
            stall = classify(event.get("quote", "")) or _known(event.get("category", ""))
            event["category"] = stall.value if stall else "unknown"
            event["counter"] = COUNTER_PLAY[stall] if stall else ""
        bus.publish(event)
        return {"ok": True}

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
                "MEMORY to hear what I remember, FORGET and a word to delete it."
            )
        latest = missions[-1]
        if word == "STOP":
            for mission_id in missions:
                await service.stop(mission_id, device_sig=f"sms:{sid}")
            return "Tempo: stopped. Nothing more will be sent."
        request_id = service.pending_for(latest)
        if word not in ("YES", "NO") or request_id is None:
            return "Tempo: there's nothing waiting for your answer."
        approval = SignedApproval(
            approved=word == "YES", scopes=BINDING_SCOPES, device_sig=f"sms:{sid}"
        )
        view = await service.answer(request_id, approval)
        return f"Tempo: {view.message}"

    if mesh is not None:
        app.include_router(mesh_router(mesh, service, settings, web_caller))

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
