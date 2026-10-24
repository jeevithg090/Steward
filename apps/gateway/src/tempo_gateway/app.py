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
| POST /sms/inbound | YES / NO / STOP / HELP | Twilio signature |
| WS /events | live updates | token query parameter |
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
from pydantic import BaseModel, ValidationError

from tempo_adapters.settings import Settings
from tempo_core.errors import MissionNotFound
from tempo_core.ledger import summarise
from tempo_core.stalls import COUNTER_PLAY, Stall, classify
from tempo_gateway.events import EventBus
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
from tempo_missions.clawback_rail import SignedApproval

VOICE_TOOLS = (
    "create_mission",
    "get_case_capsule",
    "log_stall",
    "record_reference",
    "record_consent",
    "request_human",
)


class Answer(BaseModel):
    approved: bool
    limits: dict[str, Decimal] = {}


def _secret(value: Any) -> str | None:
    return value.get_secret_value() if value is not None else None


def create_app(
    service: MissionService,
    settings: Settings,
    bus: EventBus,
    *,
    scheduler_interval_s: float | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await service.recover()  # re-emit what paused missions were waiting for
        task = None
        if scheduler_interval_s is not None:
            task = asyncio.create_task(run_scheduler(service, scheduler_interval_s))
        yield
        if task is not None:
            task.cancel()

    app = FastAPI(title="Tempo Gateway", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.web_origins.split(",") if o.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
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
            "simulated": ["company"] + (["rail data"] if settings.tempo_mode == "replay" else []),
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
        conversation = str((payload.get("data") or {}).get("conversation_id", ""))
        if conversation and seen.first_time(f"call:{conversation}"):
            bus.publish({"type": "call_ended", "conversation_id": conversation})
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
        missions = service.missions_for_phone(sender)
        if word == "HELP" or not missions:
            return "Tempo: reply YES to approve, NO to decline, STOP to stop everything."
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
