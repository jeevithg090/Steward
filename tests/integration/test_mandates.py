"""Agent Passport through the Gateway (P2): issue with Face ID or a spoken yes, verify offline,
refuse what Tempo didn't issue, and revoke on STOP from any channel.

Signatures are real: a software ES256 passkey (tests/helpers/webauthn.py) signs the challenge,
which is the mandate's digest, and py_webauthn checks it.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services
from tempo_gateway.mandates import MandateService
from tempo_gateway.mesh import Mesh
from tempo_passport import SignedMandate, b64url, digest, verify

from ..helpers.passport import changed, gateway_key, sign
from ..helpers.webauthn import SoftAuthenticator

TOKEN, VOICE, TWILIO = "mc-token", "voice-secret", "twilio-token"
ORIGIN, PUBLIC = "http://localhost:3000", "https://tempo.example.test"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
PHONE = "+15550100123"
MISSION = {
    "user_id": "u_margaret", "display_name": "Margaret", "phone": PHONE, "origin_crs": "OXF",
    "destination_crs": "PAD", "travel_date": "2026-10-23", "departure": "08:12",
    "fare_gbp": "28.40",
}  # fmt: skip


def make(tmp_path: Path, *, key: bool = True) -> TestClient:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN, web_origins=ORIGIN,
        voice_tool_secret=VOICE, twilio_auth_token=TWILIO, public_url=PUBLIC,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=3600,
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    mesh = Mesh(rp_id="localhost", origins=[ORIGIN], path=tmp_path / "mesh.json")
    mandates = MandateService(
        service.deps.repo, service.deps.clock, public_url=PUBLIC,
        signing_key=gateway_key() if key else None,
    )  # fmt: skip
    return TestClient(
        create_app(service, settings, bus, memory=memory, mesh=mesh, mandates=mandates)
    )


@pytest.fixture
def gateway(tmp_path: Path) -> Iterator[TestClient]:
    with make(tmp_path) as client:
        yield client


def device_with_face_id(client: TestClient) -> tuple[dict[str, str], SoftAuthenticator]:
    made = client.post(
        "/mesh/devices", headers=AUTH,
        json={"user_id": "u_margaret", "name": "Margaret's iPhone", "capabilities": ["approve.biometric"]},
    ).json()  # fmt: skip
    me, face_id = {"X-Tempo-Device": made["token"]}, SoftAuthenticator()
    started = client.post("/mesh/devices/me/passkey/options", headers=me).json()
    credential = face_id.create(started["options"])
    body = {"challenge_id": started["challenge_id"], "credential": credential}
    assert client.post("/mesh/devices/me/passkey", json=body, headers=me).status_code == 200
    return me, face_id


def mission(client: TestClient) -> str:
    view = client.post("/missions", json=MISSION, headers=AUTH).json()
    assert view["ask"] is not None
    mission_id: str = view["id"]
    return mission_id


def issue(
    client: TestClient, me: dict[str, str], face_id: SoftAuthenticator, mid: str
) -> dict[str, Any]:
    started = client.post("/mesh/mandates/options", json={"mission_id": mid}, headers=me)
    assert started.status_code == 200, started.text
    body = started.json()
    credential = face_id.get(body["options"])
    r = client.post(
        "/mesh/mandates", json={"challenge_id": body["challenge_id"], "credential": credential},
        headers=me,
    )  # fmt: skip
    assert r.status_code == 200, r.text
    envelope: dict[str, Any] = r.json()
    return envelope


def ask(
    client: TestClient, envelope: dict[str, Any], action: str = "claim", **kw: Any
) -> dict[str, Any]:
    body = {
        "envelope": envelope,
        "counterparty": kw.pop("counterparty", "GWR"),
        "action": action,
    } | kw
    result: dict[str, Any] = client.post("/mandates/verify", json=body).json()
    return result


def test_a_counterparty_can_verify_with_nothing_but_the_mandate(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    envelope = issue(gateway, me, face_id, mission(gateway))

    signed = SignedMandate.model_validate(envelope)
    verdict = verify(signed, now=datetime.now(UTC))  # no Gateway, no network: the mandate alone

    assert verdict.ok and verdict.assurance == "device-biometric"
    m = signed.mandate
    assert (m.counterparty, str(m.amount.max_gbp), m.matter.rule_id) == (
        "GWR", "14.20", "uk-rail.gwr.delay-repay",
    )  # fmt: skip
    assert m.principal.key.credential_id is not None
    assert m.status_url == f"{PUBLIC}/mandates/{m.mandate_id}"


def test_tempo_answers_for_the_exact_mandate_it_issued(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    envelope = issue(gateway, me, face_id, mission(gateway))
    m = SignedMandate.model_validate(envelope).mandate

    allowed = ask(gateway, envelope, amount_gbp="14.20")
    exact = gateway.get(f"/mandates/{m.mandate_id}", params={"digest": digest(m).hex()}).json()
    other = gateway.get(f"/mandates/{m.mandate_id}", params={"digest": "00" * 32}).json()

    assert (allowed["ok"], allowed["reason"]) == (True, "ok")
    assert allowed["latency_ms"] < 50
    assert exact == {"status": "active"} and other == {"status": "unknown"}


def test_a_well_signed_mandate_tempo_did_not_issue_is_refused(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    real = SignedMandate.model_validate(issue(gateway, me, face_id, mission(gateway)))
    # A scammer copies the shape, raises the amount and signs with a passkey of their own.
    forger = SoftAuthenticator()
    key = real.mandate.principal.key.model_copy(
        update={"public_key": b64url(forger.cose_public_key()), "credential_id": b64url(forger.credential_id)}
    )  # fmt: skip
    fake = changed(
        real.mandate, amount={"min_gbp": "14.20", "max_gbp": "500"},
        principal=real.mandate.principal.model_copy(update={"key": key}).model_dump(),
    )  # fmt: skip
    forged = sign(fake, forger)

    offline = verify(forged, now=datetime.now(UTC))
    online = ask(gateway, forged.model_dump(mode="json"), "accept_cash", amount_gbp="500")

    assert offline.ok  # its own signature is fine: that alone proves nothing about Margaret
    assert (online["ok"], online["reason"]) == (False, "status_unreachable")


def test_tampering_and_scope_are_refused(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    envelope = issue(gateway, me, face_id, mission(gateway))
    tampered = {**envelope, "mandate": {**envelope["mandate"], "counterparty": "Broadbandly"}}

    assert ask(gateway, tampered, counterparty="Broadbandly")["reason"] == "bad_signature"
    assert ask(gateway, envelope, "accept_voucher")["reason"] == "action_not_allowed"
    assert ask(gateway, envelope, "accept_cash", amount_gbp="50")["reason"] == "amount_above_max"
    assert ask(gateway, envelope, counterparty="Broadbandly")["reason"] == "wrong_counterparty"
    assert ask(gateway, {"mandate": {"v": 1}}, "claim")["reason"] == "bad_signature"


def test_a_mandate_challenge_is_single_use_and_checked(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    mid = mission(gateway)
    body = gateway.post("/mesh/mandates/options", json={"mission_id": mid}, headers=me).json()

    forged = gateway.post("/mesh/mandates", headers=me, json={
        "challenge_id": body["challenge_id"], "credential": face_id.get(body["options"], tamper=True),
    })  # fmt: skip
    again = gateway.post("/mesh/mandates", headers=me, json={
        "challenge_id": body["challenge_id"], "credential": face_id.get(body["options"]),
    })  # fmt: skip

    assert body["challenge_id"] == b64url(digest(SignedMandate.model_validate(
        {"mandate": body["mandate"], "signature": {"kind": "webauthn"}}).mandate))  # fmt: skip
    assert forged.status_code == 401  # and that used the challenge up
    assert again.status_code == 409


def test_revoke_and_stop_by_sms_end_the_mandate_everywhere(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    mid = mission(gateway)
    first = SignedMandate.model_validate(issue(gateway, me, face_id, mid))
    second = issue(gateway, me, face_id, mid)

    revoked = gateway.post(f"/mandates/{first.mandate.mandate_id}/revoke", headers=AUTH).json()
    assert revoked == {"status": "revoked"}
    assert ask(gateway, first.model_dump(mode="json"))["reason"] == "revoked"
    assert gateway.get(f"/missions/{mid}", headers=AUTH).json()["mandate"]["status"] == "active"

    form = {"From": PHONE, "Body": "STOP", "MessageSid": "SM1"}
    signature = RequestValidator(TWILIO).compute_signature(f"{PUBLIC}/sms/inbound", form)
    gateway.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature})

    assert ask(gateway, second)["reason"] == "revoked"
    assert gateway.get(f"/missions/{mid}", headers=AUTH).json()["mandate"]["status"] == "revoked"


def test_a_spoken_yes_gives_a_gateway_attested_mandate(gateway: TestClient) -> None:
    mid = mission(gateway)
    voice = {"X-Tempo-Voice-Secret": VOICE}

    def tool(name: str, **body: Any) -> dict[str, Any]:
        reply: dict[str, Any] = gateway.post(
            f"/voice/tools/{name}", json=body, headers=voice
        ).json()
        return reply

    before = tool("issue_mandate", mission_id=mid)
    tool("record_consent", mission_id=mid, approved=True, conversation_id="conv_1")
    issued = tool("issue_mandate", mission_id=mid, display_name="Margaret")
    shown = tool("present_mandate", mission_id=mid)
    checked = tool("verify_mandate", envelope=shown["envelope"], counterparty="GWR", action="claim")

    assert before["say"] == "I need your yes first, so I haven't issued a mandate."
    assert issued["say"] == "Done. I hold your mandate for this claim only."
    assert shown["envelope"]["signature"]["kind"] == "gateway-ed25519"
    assert (checked["ok"], checked["assurance"]) == (True, "gateway-attested")


def test_without_a_signing_key_the_landline_says_so(tmp_path: Path) -> None:
    with make(tmp_path, key=False) as client:
        mid = mission(client)
        voice = {"X-Tempo-Voice-Secret": VOICE}
        client.post("/voice/tools/record_consent", headers=voice,
                    json={"mission_id": mid, "approved": True, "conversation_id": "c"})  # fmt: skip
        said = client.post("/voice/tools/issue_mandate", json={"mission_id": mid}, headers=voice)

        assert said.json()["say"] == "I can't issue a mandate on this line yet."
        assert client.post("/voice/tools/present_mandate", json={"mission_id": mid},
                           headers=voice).json()["error"] == "no mandate"  # fmt: skip


def test_mandates_only_for_your_own_missions(gateway: TestClient) -> None:
    mid = mission(gateway)
    other = gateway.post(
        "/mesh/devices", headers=AUTH,
        json={"user_id": "u_someone_else", "name": "Not Margaret", "capabilities": ["approve.biometric"]},
    ).json()  # fmt: skip

    r = gateway.post("/mesh/mandates/options", json={"mission_id": mid},
                     headers={"X-Tempo-Device": other["token"]})  # fmt: skip

    assert r.status_code == 404


def test_on_a_call_the_company_checks_the_id_it_heard(gateway: TestClient) -> None:
    me, face_id = device_with_face_id(gateway)
    mid = mission(gateway)
    issued = SignedMandate.model_validate(issue(gateway, me, face_id, mid)).mandate.mandate_id
    voice = {"X-Tempo-Voice-Secret": VOICE}

    shown = gateway.post("/voice/tools/present_mandate", json={"mission_id": mid}, headers=voice)
    heard = shown.json()["mandate_id"]
    claim = gateway.post("/voice/tools/verify_mandate", headers=voice,
                         json={"mandate_id": heard, "action": "claim", "counterparty": "GWR"})  # fmt: skip
    other = gateway.post("/voice/tools/verify_mandate", headers=voice,
                         json={"mandate_id": heard, "action": "discuss_other_accounts",
                               "counterparty": "GWR"})  # fmt: skip
    nobody = gateway.post("/voice/tools/verify_mandate", headers=voice,
                          json={"mandate_id": "md_made_up", "action": "claim", "counterparty": "GWR"})  # fmt: skip

    assert heard == issued
    assert shown.json()["say"] == f"My mandate is {issued}. It covers this claim only."
    assert (claim.json()["ok"], claim.json()["say"]) == (
        True,
        "This mandate is signed, still valid and covers this.",
    )
    assert other.json()["say"] == "This mandate does not cover other accounts."
    assert nobody.json()["ok"] is False
