"""The Patience Profile through the Gateway: memories set up each inbound call before it starts.

ElevenLabs calls POST /voice/initiation as a call connects; the answer carries the dynamic
variables and per-call overrides. GET /voice/profile shows Mission Control the same thing.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

from tempo_adapters.elevenlabs import load_agent_config, load_greetings
from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.main import build_services

REPO = Path(__file__).resolve().parents[2]
TOKEN, VOICE, TWILIO = "mc-token", "voice-secret", "twilio-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
VOICE_HEADERS = {"X-Tempo-Voice-Secret": VOICE}
MARGARET, DILIP, JOAN = "+15550100123", "+15550100124", "+15550100125"
GREETINGS = load_greetings(REPO / "voice" / "greetings.yaml")


@pytest.fixture
def gateway(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=TOKEN,
        voice_tool_secret=VOICE, twilio_auth_token=TWILIO,
        public_url="https://tempo.example.test", checkpoint_dir=str(tmp_path / "checkpoints"),
        elevenlabs_voice_tempo="voice_tempo", elevenlabs_voice_tempo_low="voice_tempo_low",
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    app = create_app(service, settings, bus, memory=memory, greetings=GREETINGS)
    with TestClient(app) as client:
        client.memory = memory  # type: ignore[attr-defined]
        yield client


def seed(
    client: TestClient, user_id: str, phone: str, name: str, said: list[str]
) -> dict[str, Any]:
    r = client.post(
        "/demo/memory",
        json={"user_id": user_id, "phone": phone, "display_name": name, "said": said,
              "confirm_readbacks": True},
        headers=AUTH,
    )  # fmt: skip
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def ring(client: TestClient, phone: str, conversation: str = "conv_1") -> dict[str, Any]:
    r = client.post(
        "/voice/initiation",
        json={"caller_id": phone, "agent_id": "agent_inbound", "called_number": "+15550109999",
              "call_sid": "CA1", "conversation_id": conversation},
        headers=VOICE_HEADERS,
    )  # fmt: skip
    assert r.status_code == 200, r.text
    answer: dict[str, Any] = r.json()
    return answer


def sms(client: TestClient, phone: str, body: str, sid: str) -> str:
    form = {"From": phone, "Body": body, "MessageSid": sid}
    signature = RequestValidator(TWILIO).compute_signature(
        "https://tempo.example.test/sms/inbound", form
    )
    return client.post("/sms/inbound", data=form, headers={"X-Twilio-Signature": signature}).text


def voice_lines(client: TestClient, user_id: str) -> list[tuple[str, bool]]:
    card = client.get("/memories", params={"user_id": user_id}, headers=AUTH).json()
    return [(f["object"], f["valid_to"] is None) for f in card["timeline"] if f["kind"] == "voice"]


def test_a_bad_secret_is_refused(gateway: TestClient) -> None:
    r = gateway.post("/voice/initiation", json={"caller_id": MARGARET},
                     headers={"X-Tempo-Voice-Secret": "nope"})  # fmt: skip

    assert r.status_code == 401


def test_an_unknown_caller_gets_everyones_call(gateway: TestClient) -> None:
    answer = ring(gateway, "+15550100999")

    assert answer["type"] == "conversation_initiation_client_data"
    assert answer["dynamic_variables"]["caller_id"] == ""
    assert "conversation_config_override" not in answer
    assert gateway.post("/voice/initiation", json={}, headers=VOICE_HEADERS).status_code == 200


def test_seeded_words_are_read_back_and_confirmed_and_say_so(gateway: TestClient) -> None:
    seeded = seed(gateway, "u_margaret", MARGARET, "Margaret",
                  ["I stammer, so please give me time to answer."])  # fmt: skip

    assert seeded["memories"] == ["ask_user", "ask_user"]  # opt-in: never stored silently
    assert seeded["confirmed"] == ["has a stammer", "needs more time to answer"]
    card = gateway.get("/memories", params={"user_id": "u_margaret"}, headers=AUTH).json()
    assert [m["item"]["expires_at"] for m in card["memories"]["access"]] == [None, None]


def test_margaret_gets_patience_in_words_not_a_new_voice(gateway: TestClient) -> None:
    seed(gateway, "u_margaret", MARGARET, "Margaret",
         ["I stammer, so please give me time to answer."])  # fmt: skip

    answer = ring(gateway, MARGARET)

    variables = answer["dynamic_variables"]
    assert (variables["caller_id"], variables["display_name"]) == ("u_margaret", "Margaret")
    assert variables["patience"] == "high"
    assert "Wait as long as it takes" in variables["how_to_speak"]
    assert "conversation_config_override" not in answer


def test_dilip_is_answered_in_hindi_slower_with_his_stations(gateway: TestClient) -> None:
    seed(gateway, "u_dilip", DILIP, "Dilip", ["Please speak to me in Hindi.", "Speak slowly please.",
                                               "I commute from Reading to Paddington."])  # fmt: skip

    override = ring(gateway, DILIP)["conversation_config_override"]

    assert override["agent"] == {"language": "hi", "first_message": GREETINGS["hi"]}
    assert override["tts"] == {"speed": 0.85}
    assert override["asr"]["keywords"][:2] == ["Reading", "Paddington"]


def test_joan_gets_the_lower_voice_and_the_text_offer(gateway: TestClient) -> None:
    seed(gateway, "u_joan", JOAN, "Joan", ["I'm hard of hearing.", "Text me the question instead.",
                                            "My son Kevin sorts my post."])  # fmt: skip

    answer = ring(gateway, JOAN)

    assert answer["conversation_config_override"]["tts"] == {
        "voice_id": "voice_tempo_low", "speed": 0.9, "stability": 0.65,
    }  # fmt: skip
    assert answer["dynamic_variables"]["channel_hint"] == "text"
    assert "Kevin" in answer["conversation_config_override"]["asr"]["keywords"]


def test_every_variable_the_inbound_agent_uses_is_answered(gateway: TestClient) -> None:
    declared = load_agent_config(REPO / "voice" / "agents" / "tempo.inbound.yaml").dynamic_variables
    answered = set(ring(gateway, "+15550100999")["dynamic_variables"])

    assert {v for v in declared if not v.startswith("system__")} <= answered


def test_forget_by_text_and_the_next_call_forgets_too(gateway: TestClient) -> None:
    seed(gateway, "u_dilip", DILIP, "Dilip", ["Speak slowly please."])
    assert ring(gateway, DILIP, "conv_a")["conversation_config_override"]["tts"] == {"speed": 0.85}

    reply = sms(gateway, DILIP, "FORGET slower", "SM1")
    after = ring(gateway, DILIP, "conv_b")

    assert "forgotten: wants slower speech" in reply
    assert "conversation_config_override" not in after
    lines = voice_lines(gateway, "u_dilip")
    assert [still_true for _, still_true in lines] == [False, True]  # the old one is struck through
    assert lines[0][0].startswith("slower") and lines[1][0].startswith("the usual settings")


def test_a_usual_call_leaves_no_timeline_line(gateway: TestClient) -> None:
    seed(gateway, "u_amir", "+15550100126", "Amir", ["I prefer phone updates."])

    ring(gateway, "+15550100126")

    assert voice_lines(gateway, "u_amir") == []


def test_mission_control_sees_the_profile_without_voice_ids(gateway: TestClient) -> None:
    seed(gateway, "u_joan", JOAN, "Joan", ["I'm hard of hearing."])

    r = gateway.get("/voice/profile", params={"user_id": "u_joan"})
    view = gateway.get("/voice/profile", params={"user_id": "u_joan"}, headers=AUTH).json()

    assert r.status_code == 401
    assert view["adjusted"] is True
    assert view["profile"]["voice"] == "low" and view["profile"]["reasons"] == [
        "is hard of hearing"
    ]
    assert view["initiation"]["conversation_config_override"]["tts"]["voice_id"] == (
        "ELEVENLABS_VOICE_TEMPO_LOW"
    )
    assert "voice_tempo_low" not in str(view)
    assert view["low_voice_configured"] is True
