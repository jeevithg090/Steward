"""Read It To Me and Before You Pay through the Gateway (track 1b), offline in replay mode."""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.letters import MAX_IMAGE_BYTES, bearer_caller, letters_router, payee_router
from tempo_gateway.main import HOLIDAYS, build_registers, build_service, build_vision

ROOT = Path(__file__).resolve().parents[2]
VISION, LETTERS = ROOT / "fixtures" / "vision", ROOT / "fixtures" / "letters"
TOKEN = "mission-control-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
TODAY = date(2026, 10, 25)


@pytest.fixture
def gateway(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN,
        checkpoint_dir=str(tmp_path / "checkpoints"), payment_check_after_s=0,
    )  # fmt: skip
    service, bus = build_service(settings)
    app = create_app(service, settings, bus)
    registers, simulated = build_registers(settings)
    app.include_router(
        letters_router(
            build_vision(settings), service.deps.rules.clocks, HOLIDAYS(), bearer_caller(TOKEN),
            today=lambda: TODAY,
        )
    )  # fmt: skip
    app.include_router(
        payee_router(bearer_caller(TOKEN), registers=registers, registers_simulated=simulated)
    )
    with TestClient(app) as client:
        yield client


def photo(image: bytes, filename: str = "letter.png") -> dict[str, Any]:
    return {
        "image_b64": base64.b64encode(image).decode(), "filename": filename,
        "user_id": "u_margaret", "language": "en",
    }  # fmt: skip


def golden(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((LETTERS / f"{name}.reading.json").read_text())
    return data


def test_a_water_letter_is_read_end_to_end(gateway: TestClient) -> None:
    image = (VISION / "thames_water_overpayment.png").read_bytes()

    r = gateway.post(
        "/letters/read", json=photo(image, "thames_water_overpayment.png"), headers=AUTH
    )

    assert r.status_code == 200, r.text
    assert r.json() == golden("water_overpayment")
    assert r.json()["must_do"] == "There is nothing you need to do."


def test_a_council_tax_reminder_reads_back_the_unsure_date_then_drafts_a_reply(
    gateway: TestClient,
) -> None:
    image = (VISION / "council_tax_reminder.png").read_bytes()

    read = gateway.post(
        "/letters/read", json=photo(image, "council_tax_reminder.png"), headers=AUTH
    )
    reading = read.json()
    reply = gateway.post(
        "/letters/reply",
        json={"reading": reading, "said": "i paid this on the 2nd by card"},
        headers=AUTH,
    )

    assert read.status_code == 200, read.text
    assert reading == golden("council_tax_reminder")
    assert reading["unsure"] == [
        {
            "key": "due_date",
            "question": "I read the date to pay by as 10 November 2026. Is that right?",
        }
    ]
    assert reply.status_code == 200, reply.text
    assert reply.json()["added_nothing"] is True
    assert "Dear Oxford City Council," in reply.json()["draft"]
    assert "I paid this on the 2nd by card." in reply.json()["draft"]


def test_the_routes_need_the_bearer_token(gateway: TestClient) -> None:
    image = (VISION / "thames_water_overpayment.png").read_bytes()

    assert gateway.post("/letters/read", json=photo(image)).status_code == 401
    assert gateway.post("/letters/reply", json={}).status_code == 401
    assert (
        gateway.post("/scam/payee", json={}, headers={"Authorization": "Bearer nope"}).status_code
        == 401
    )


def test_a_photo_over_8_mib_is_refused_with_413(gateway: TestClient) -> None:
    big = photo(b"") | {"image_b64": "A" * ((MAX_IMAGE_BYTES + 3) // 3 * 4 + 4)}

    r = gateway.post("/letters/read", json=big, headers=AUTH)

    assert r.status_code == 413 and "too big" in r.json()["detail"]


def test_a_photo_it_has_no_reading_for_is_said_plainly(gateway: TestClient) -> None:
    unknown = gateway.post("/letters/read", json=photo(b"not a fixture"), headers=AUTH)
    broken = gateway.post("/letters/read", json=photo(b"") | {"image_b64": "@@@"}, headers=AUTH)

    assert unknown.status_code == 503 and "tell me what it says" in unknown.json()["detail"]
    assert broken.status_code == 400


def test_before_you_pay_stops_a_safe_account_and_a_warned_firm(gateway: TestClient) -> None:
    pushed = gateway.post("/scam/payee", json={
        "payee_name": "Crown Yield", "amount_gbp": "2500.00", "reason": "my account is at risk",
        "new_payee": True, "message_text": "Move your savings to a safe account today.",
    }, headers=AUTH).json()  # fmt: skip
    warned = gateway.post("/scam/payee", json={
        "payee_name": "Barclays Wealth Desk", "amount_gbp": "500.00", "reason": "investment",
        "new_payee": True, "message_text": "Your returns are ready", "firm": "Barclays Wealth Desk",
    }, headers=AUTH).json()  # fmt: skip

    assert pushed["verdict"] == "stop" and pushed["say"].startswith(
        "Stop. Do not pay Crown Yield today."
    )
    assert warned["verdict"] == "stop" and warned["simulated"] is True
    assert warned["reasons"][0] == "the official registers flag this as a likely scam"


def test_before_you_pay_waits_for_a_new_payee_and_pays_a_known_one(gateway: TestClient) -> None:
    new = gateway.post("/scam/payee", json={
        "payee_name": "Tom", "amount_gbp": "50", "reason": "birthday", "new_payee": True,
    }, headers=AUTH).json()  # fmt: skip
    known = gateway.post("/scam/payee", json={
        "payee_name": "British Gas", "amount_gbp": "80", "reason": "gas bill", "new_payee": False,
    }, headers=AUTH).json()  # fmt: skip

    assert new["verdict"] == "wait" and "ring them on a number you already know" in new["say"]
    assert known["verdict"] == "pay" and "Tempo never moves money" in known["say"]
    assert set(known) == {"verdict", "reasons", "say", "simulated"}
