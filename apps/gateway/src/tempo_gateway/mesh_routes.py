"""Tempo Mesh routes (S5.2). Devices authenticate with their own token (X-Tempo-Device).

No `from __future__ import annotations`: FastAPI reads these annotations at runtime.

| Route | Who |
|---|---|
| GET /mesh/config | anyone: the passkey RP id and the VAPID public key |
| POST /mesh/devices | Mission Control's bearer token: a person's first device |
| GET /mesh/devices, DELETE /mesh/devices/{id} | a device: list, or remove a lost one |
| POST /mesh/devices/me/passkey/options, POST /mesh/devices/me/passkey | a device: add Face ID |
| PUT /mesh/devices/me/push | a device: its Web Push subscription |
| POST /mesh/pairings, GET /mesh/pairings/{id}, POST /mesh/pairings/{id}/confirm | a device |
| POST /mesh/pairings/{id}/claim | the new device, with the one-time secret from the QR code |
| POST /mesh/approvals/{request_id}/options, POST /mesh/approvals/{request_id} | a device |
| GET /mesh/signals, POST /mesh/signals | a notification-reading device: filters; matches |
| GET /mesh/signals/model | a notification-reading device: Scam Shield's text model as data |
| POST /mesh/mandates/options, POST /mesh/mandates | a device with Face ID: sign a mandate (P2) |
| GET /mesh/mandates/{id} | one of the person's devices: the signed mandate, to show a company |
"""

import asyncio
from decimal import Decimal
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from tempo_adapters.settings import Settings
from tempo_core.signals import SignalSpec, only_declared
from tempo_gateway.events import EventBus
from tempo_gateway.mandates import MAY, MAY_NOT, MandateService
from tempo_gateway.mesh import Device, Mesh, MeshError
from tempo_gateway.missions import BINDING_SCOPES, MissionService, MissionView, UnknownRequest
from tempo_gateway.shield import ShieldService
from tempo_missions.clawback_rail import SignedApproval

log = structlog.get_logger("tempo.mesh")


class NewDevice(BaseModel):
    user_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=60)
    capabilities: list[str] = []


class Claim(BaseModel):
    secret: str
    name: str = Field(min_length=1, max_length=60)
    capabilities: list[str] = []


class Signed(BaseModel):
    challenge_id: str
    credential: dict[str, Any]


class SignalIn(BaseModel):
    signal_id: str
    fields: dict[str, str]


class AnswerRequest(BaseModel):
    approved: bool
    limits: dict[str, Decimal] = {}


class MandateAsk(BaseModel):
    """What the person is about to sign. The company and amount come from the mission."""

    mission_id: str
    may: list[str] = list(MAY)
    may_not: list[str] = list(MAY_NOT)


def mesh_router(
    mesh: Mesh,
    service: MissionService,
    settings: Settings,
    web_caller: Any,
    *,
    bus: EventBus | None = None,
    signals: dict[str, SignalSpec] | None = None,
    mandates: MandateService | None = None,
    shield: ShieldService | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/mesh")
    origin = settings.web_origins.split(",")[0].strip()

    def this_device(x_tempo_device: Annotated[str | None, Header()] = None) -> Device:
        device = mesh.device_for_token(x_tempo_device)
        if device is None:
            raise HTTPException(401, "this device isn't paired")
        if not device.active:
            raise HTTPException(403, "confirm the pairing code on your other device first")
        return device

    Me = Annotated[Device, Depends(this_device)]
    Caller = Annotated[str, Depends(web_caller)]

    def run(work: Any) -> Any:
        try:
            return work()
        except MeshError as e:
            raise HTTPException(e.status, str(e)) from None

    @router.get("/config")
    async def config() -> dict[str, Any]:
        return {"rp_id": mesh.rp_id, "vapid_public_key": settings.vapid_public_key}

    @router.post("/devices", status_code=201)
    async def first_device(body: NewDevice, caller: Caller) -> dict[str, Any]:
        device, token = mesh.add_device(body.user_id, body.name, body.capabilities)
        return {"device": device.public(), "token": token}

    @router.get("/devices")
    async def my_devices(me: Me) -> list[dict[str, Any]]:
        return [d.public() for d in mesh.devices_of(me.user_id)]

    @router.delete("/devices/{device_id}")
    async def remove_device(device_id: str, me: Me) -> dict[str, bool]:
        run(lambda: mesh.remove(me, device_id))
        return {"removed": True}

    @router.post("/devices/me/passkey/options")
    async def passkey_options(me: Me) -> dict[str, Any]:
        return mesh.registration_options(me)

    @router.post("/devices/me/passkey")
    async def add_passkey(body: Signed, me: Me) -> dict[str, Any]:
        run(lambda: mesh.finish_registration(me, body.challenge_id, body.credential))
        return mesh.devices[me.id].public()

    @router.put("/devices/me/push")
    async def set_push(subscription: dict[str, Any], me: Me) -> dict[str, bool]:
        mesh.set_push(me, subscription or None)
        return {"push": bool(subscription)}

    @router.post("/pairings", status_code=201)
    async def start_pairing(me: Me) -> dict[str, Any]:
        return mesh.start_pairing(me, origin)

    @router.get("/pairings/{pairing_id}")
    async def pairing(pairing_id: str, me: Me) -> dict[str, Any]:
        return run(lambda: mesh.pairing_status(me, pairing_id))  # type: ignore[no-any-return]

    @router.post("/pairings/{pairing_id}/claim")
    async def claim(pairing_id: str, body: Claim) -> dict[str, Any]:
        device, token, code = run(
            lambda: mesh.claim(pairing_id, body.secret, body.name, body.capabilities)
        )
        return {"device": device.public(), "token": token, "code": code}

    @router.post("/pairings/{pairing_id}/confirm")
    async def confirm(pairing_id: str, me: Me) -> dict[str, Any]:
        return run(lambda: mesh.confirm(me, pairing_id)).public()  # type: ignore[no-any-return]

    @router.post("/approvals/{request_id}/options")
    async def approval_options(request_id: str, body: AnswerRequest, me: Me) -> dict[str, Any]:
        _mine(request_id, me)
        limits = tuple((k, str(v)) for k, v in body.limits.items())
        return run(lambda: mesh.approval_options(me, request_id, body.approved, limits))  # type: ignore[no-any-return]

    @router.post("/approvals/{request_id}")
    async def signed_approval(request_id: str, body: Signed, me: Me) -> MissionView:
        _mine(request_id, me)
        signed = run(
            lambda: mesh.verify_approval(me, request_id, body.challenge_id, body.credential)
        )
        approval = SignedApproval(
            approved=bool(signed.approved), scopes=BINDING_SCOPES,
            device_sig=f"passkey:{me.id}", limits=signed.limits,
        )  # fmt: skip
        try:
            return await service.answer(request_id, approval)
        except UnknownRequest:
            raise HTTPException(409, "this was already answered on another device") from None

    @router.get("/signals")
    async def signal_filters(me: Me) -> list[dict[str, Any]]:
        """The filters a notification-reading device runs locally (skills/*/signals.yaml)."""
        return [spec.model_dump(mode="json") for spec in (signals or {}).values()]

    @router.get("/signals/model")
    async def signal_model(me: Me) -> dict[str, Any]:
        """Scam Shield's text model (skills/scam-shield/model.json), for the phone to run itself."""
        if shield is None or shield.model is None:
            raise HTTPException(404, "no text model is loaded")
        return shield.model.model_dump(mode="json")

    @router.post("/signals")
    async def signal(body: SignalIn, me: Me) -> dict[str, Any]:
        """A signal a device's own filter matched (spec §15.9). Only declared fields are taken;
        anything more is refused rather than trimmed, so a leaky node is noticed."""
        if "notifications.read" not in me.capabilities:
            raise HTTPException(403, "this device doesn't read notifications")
        spec = (signals or {}).get(body.signal_id)
        if spec is None:
            raise HTTPException(404, f"no skill asks for {body.signal_id!r}")
        if not only_declared(spec, body.fields):
            raise HTTPException(422, "only the fields the skill declares may leave a device")
        if shield is not None and (spec.match.families or spec.match.model):
            # Scam Shield (docs/scam-shield.md §5.1): four derived fields in, the words to say out.
            # The phone speaks the Gateway's words; other devices are only woken when it warns.
            answer = await shield.signal(body.fields, user_id=me.user_id, source="phone")
            routed = await mesh.notify(me.user_id) if answer["zone"] == "warn" else None
            return {"accepted": True, "routed_to": routed.name if routed else None, **answer}
        if bus is not None:
            bus.publish({"type": "signal", "signal_id": spec.id, "from": me.name, **body.fields})
        routed = await mesh.notify(me.user_id)  # wake the device that can approve; it says "sync"
        return {"accepted": True, "routed_to": routed.name if routed else None}

    @router.post("/mandates/options")
    async def mandate_options(body: MandateAsk, me: Me) -> dict[str, Any]:
        """Draft the mandate from the mission and bind it to this device's passkey."""
        if mandates is None:
            raise HTTPException(404, "mandates are off")
        if await service.user_for(body.mission_id) != me.user_id:
            raise HTTPException(404, "no such mission")
        matter = service.matter_for(body.mission_id)
        if not matter.get("counterparty") or not matter.get("amount_gbp"):
            raise HTTPException(409, "this mission doesn't name a company and an amount yet")
        try:
            draft = mandates.draft(
                mission_id=body.mission_id, user_id=me.user_id, display_name=me.name,
                counterparty=str(matter["counterparty"]), skill_id=str(matter["skill_id"]),
                amount_gbp=Decimal(str(matter["amount_gbp"])), rule_id=matter.get("rule_id"),
                account_ref=matter.get("account_ref"), may=body.may, may_not=body.may_not,
            )  # fmt: skip
        except ValueError as e:  # an unknown action, or one both allowed and refused
            raise HTTPException(422, str(e)) from None
        return run(lambda: mesh.mandate_options(me, draft))  # type: ignore[no-any-return]

    @router.post("/mandates")
    async def signed_mandate(body: Signed, me: Me) -> dict[str, Any]:
        """Face ID signed it: keep it, and hand back exactly what a company will be shown."""
        if mandates is None:
            raise HTTPException(404, "mandates are off")
        signed = mandates.store(
            run(lambda: mesh.finish_mandate(me, body.challenge_id, body.credential))
        )
        m = signed.mandate
        if bus is not None:
            bus.publish({
                "type": "mandate_issued", "mission_id": m.matter.mission_id,
                "mandate_id": m.mandate_id, "assurance": "device-biometric",
                "expires_at": m.expires_at.isoformat(),
            })  # fmt: skip
        return signed.model_dump(mode="json")

    @router.get("/mandates/{mandate_id}")
    async def my_mandate(mandate_id: str, me: Me) -> dict[str, Any]:
        """The signed mandate as issued, for any of the person's own devices: the web app's "Let
        the company check it" needs the envelope after a reload or on her other screen."""
        if mandates is None:
            raise HTTPException(404, "mandates are off")
        signed = mandates.envelope(mandate_id)
        if signed is None or await service.user_for(signed.mandate.matter.mission_id) != me.user_id:
            raise HTTPException(404, "no such mandate")
        return signed.model_dump(mode="json")

    def _mine(request_id: str, me: Device) -> None:
        if service.mission_for_request(request_id) is None:
            raise HTTPException(409, "this was already answered on another device")

    return router


async def notify_devices(bus: EventBus, mesh: Mesh, service: MissionService) -> None:
    """When a mission needs an answer, wake the right device. The push says only "sync"."""
    async with bus.subscribe() as queue:
        while True:
            event = await queue.get()
            if event.get("type") != "consent_requested":
                continue
            try:
                user_id = await service.user_for(str(event.get("mission_id", "")))
                await mesh.notify(user_id)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # a push failure must never stop a mission
                log.warning("push_failed", error_code=type(e).__name__)
