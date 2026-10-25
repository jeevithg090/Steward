"""The GPU demo (plan.md §13): TEMPO_DEPLOY=cloud-gpu, TEMPO_MODELS=live, data replayed. The
jurors, small talk and photo reading call our own model on RunPod (here a stand-in for its
OpenAI-compatible route); rail data and the company stay recorded, and /health says exactly that."""

from __future__ import annotations

import base64
import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build

pytestmark = pytest.mark.integration

TOKEN = "gpu-demo-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
RUNPOD = "https://api.runpod.ai/v2/ep123/openai/v1/chat/completions"
CARD = Path(__file__).resolve().parents[2] / "fixtures" / "vision" / "missed_visit_card.png"
LATE_TRAIN = "My 08:12 Oxford to Paddington was 38 minutes late on 23 October 2026, ticket £28.40"


def completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={
        "id": "chatcmpl-1", "object": "chat.completion", "created": 0, "model": "tempo-private",
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
    })  # fmt: skip


def the_model(request: httpx.Request) -> httpx.Response:
    """Answers like Qwen2.5-VL would: a juror verdict, a card's facts, or one sentence."""
    body: dict[str, Any] = json.loads(request.content)
    content = body["messages"][-1]["content"]
    if isinstance(content, list):  # a photo: the missed-visit card
        assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
        return completion(json.dumps({"facts": [
            {"key": "operator", "value": "Broadbandly", "confidence": 0.97},
            {"key": "event_date", "value": "2026-10-19", "confidence": 0.95},
            {"key": "account_ref", "value": "BB-4417", "confidence": 0.9},
        ]}))  # fmt: skip
    text = content if isinstance(content, str) else str(content)
    rule = re.search(r"Rule ([\w.\-]+):", text)
    if rule:  # one of the three jurors
        return completion(json.dumps({
            "eligible": True, "rule_id": rule.group(1), "band": None, "amount_gbp": None,
            "citations": ["15 minutes or more late"], "confidence": 0.9,
            "reasoning": "The train was 38 minutes late, inside the band.",
        }))  # fmt: skip
    return completion("I'm Tempo, and I'm here to help you get back what you're owed.")


@pytest.fixture
def gateway(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)  # no .env
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_models="live", tempo_deploy="cloud-gpu",
        tempo_demo=True, tempo_api_token=TOKEN, runpod_endpoint_id="ep123",
        runpod_api_key="rp-test-key", checkpoint_dir=str(tmp_path / "cp"),
        mesh_file=str(tmp_path / "mesh.json"), payment_check_after_s=0,
    )  # fmt: skip
    with respx.mock(assert_all_called=False) as mock:
        mock.post(RUNPOD).mock(side_effect=the_model)
        mock.route(host="testserver").pass_through()
        with TestClient(build(settings)) as client:
            client.runpod = mock  # type: ignore[attr-defined]
            yield client


def test_health_names_the_model_and_only_what_is_still_recorded(gateway: TestClient) -> None:
    health = gateway.get("/health").json()
    assert health["deploy"] == "cloud-gpu"
    assert health["simulated"] == ["company", "rail data"]
    assert health["model"] == {
        "kind": "runpod-vllm", "name": "tempo-private", "processor": "our own model on RunPod",
    }  # fmt: skip
    assert health["third_parties"] == ["elevenlabs"]


def test_the_three_jurors_vote_on_our_model_and_the_amount_still_comes_from_the_rules(
    gateway: TestClient,
) -> None:
    reply = gateway.post(
        "/chat", headers=AUTH,
        json={"user_id": "u_margaret", "display_name": "Margaret", "text": LATE_TRAIN},
    ).json()  # fmt: skip
    assert reply["ask"]["amount_gbp"] == "14.20"  # the rule pack, never the model
    court = reply["mission"]["court"]
    assert court["eligible"] is True
    assert sorted(v["juror"] for v in court["verdicts"]) == [
        "runpod-vllm-1", "runpod-vllm-2", "runpod-vllm-3",
    ]  # fmt: skip
    assert reply["simulated"] == ["company", "rail data"]


def test_a_photo_of_the_card_is_read_by_our_model(gateway: TestClient) -> None:
    photo = base64.b64encode(CARD.read_bytes()).decode()
    read = gateway.post(
        "/missions/ofcom/read", headers=AUTH,
        json={"image_b64": photo, "filename": "card.png", "user_id": "u_margaret",
              "display_name": "Margaret"},
    ).json()  # fmt: skip
    facts = {f["key"]: f["value"] for f in read["facts"]}
    assert facts["operator"] == "Broadbandly" and facts["event_date"] == "2026-10-19"
    assert read["question"] is None
    assert read["mission"]["skill_id"].endswith("ofcom-missed-appointment")


def test_small_talk_is_one_sentence_from_the_model(gateway: TestClient) -> None:
    reply = gateway.post(
        "/chat", headers=AUTH, json={"user_id": "u_margaret", "text": "hello there"},
    ).json()  # fmt: skip
    assert reply["intent"] == "smalltalk"
    assert reply["reply"] == "I'm Tempo, and I'm here to help you get back what you're owed."
    assert gateway.get("/health").json()["chat"] == {"llm": "runpod-vllm"}
