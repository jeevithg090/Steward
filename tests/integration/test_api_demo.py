"""The live demo's fallback (plan.md §13.5): TEMPO_DEPLOY=cloud-apis, TEMPO_MODELS=live. The three
jurors are Gemini and OpenRouter models in turn, Gemini reads photos, and /health names every outside
company and says whether the model is really answering (here: stand-ins for both providers)."""

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

TOKEN = "api-demo-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_VISION = re.compile(
    r"https://generativelanguage\.googleapis\.com/v1beta/models/.+:generateContent"
)
OPENROUTER = "https://openrouter.ai/api/v1/chat/completions"
RUNPOD = "https://api.runpod.ai/v2/ep123/openai/v1/chat/completions"
CARD = Path(__file__).resolve().parents[2] / "fixtures" / "vision" / "missed_visit_card.png"
LATE_TRAIN = "My 08:12 Oxford to Paddington was 38 minutes late on 23 October 2026, ticket £28.40"


def completion(content: str, model: str) -> httpx.Response:
    return httpx.Response(200, json={
        "id": "c1", "object": "chat.completion", "created": 0, "model": model,
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    })  # fmt: skip


def a_model(request: httpx.Request) -> httpx.Response:
    body: dict[str, Any] = json.loads(request.content)
    text = str(body["messages"][-1]["content"])
    rule = re.search(r"Rule ([\w.\-]+):", text)
    if rule:
        return completion(json.dumps({
            "eligible": True, "rule_id": rule.group(1), "confidence": 0.9, "citations": [],
            "reasoning": "38 minutes is inside the band.",
        }), body["model"])  # fmt: skip
    return completion("Hello, I'm Tempo, and I'm glad you're here.", body["model"])


def gemini_reads_the_card(request: httpx.Request) -> httpx.Response:
    facts = {"facts": [
        {"key": "operator", "value": "Broadbandly", "confidence": 0.96},
        {"key": "event_date", "value": "2026-10-19", "confidence": 0.95},
    ]}  # fmt: skip
    return httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(facts)}]}}]}
    )


def gateway_with(tmp_path: Path, **extra: Any) -> TestClient:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_models="live", tempo_demo=True,
        tempo_api_token=TOKEN, checkpoint_dir=str(tmp_path / "cp"),
        mesh_file=str(tmp_path / "mesh.json"), payment_check_after_s=0, **extra,
    )  # fmt: skip
    return TestClient(build(settings))


@pytest.fixture
def apis(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GEMINI_CHAT).mock(side_effect=a_model)
        mock.post(OPENROUTER).mock(side_effect=a_model)
        mock.post(GEMINI_VISION).mock(side_effect=gemini_reads_the_card)
        mock.route(host="testserver").pass_through()
        with gateway_with(
            tmp_path, tempo_deploy="cloud-apis", gemini_api_key="g-test", openrouter_api_key="or-test",
            gemini_model="gemini-3.1-flash-lite",
        ) as client:  # fmt: skip
            yield client


def test_the_jurors_are_three_models_from_two_providers(apis: TestClient) -> None:
    reply = apis.post("/chat", headers=AUTH, json={"user_id": "u_m", "text": LATE_TRAIN}).json()
    assert reply["ask"]["amount_gbp"] == "14.20"  # the rules, never a model
    court = reply["mission"]["court"]
    assert [v["juror"] for v in court["verdicts"]] == [
        "gemini-3.1-flash-lite", "dots-3-note-preview", "gemini-3.5-flash",
    ]  # fmt: skip
    assert court["absent"] == [] and court["eligible"] is True


def test_health_names_every_outside_company_and_says_the_model_answers(apis: TestClient) -> None:
    before = apis.get("/health").json()
    assert before["deploy"] == "cloud-apis"
    assert before["third_parties"] == ["elevenlabs", "gemini", "openrouter"]
    assert before["simulated"] == ["company", "rail data"]
    assert before["model"]["processor"] == "Google Gemini and OpenRouter"
    assert before["model"]["answering"] is None  # nothing asked yet
    apis.post("/chat", headers=AUTH, json={"user_id": "u_h", "text": "hello there"})
    assert apis.get("/health").json()["model"]["answering"] is True


def test_gemini_reads_the_card(apis: TestClient) -> None:
    photo = base64.b64encode(CARD.read_bytes()).decode()
    read = apis.post("/missions/ofcom/read", headers=AUTH, json={
        "image_b64": photo, "filename": "card.png", "user_id": "u_c", "display_name": "C",
    }).json()  # fmt: skip
    assert {f["key"]: f["value"] for f in read["facts"]}["operator"] == "Broadbandly"


def test_a_gpu_that_fails_is_reported_as_not_answering(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Configured is not answering: the jurors count as absent, and /health says so."""
    monkeypatch.chdir(tmp_path)
    with respx.mock(assert_all_called=False) as mock:
        mock.post(RUNPOD).mock(return_value=httpx.Response(500, json={"error": "out of disk"}))
        mock.route(host="testserver").pass_through()
        with gateway_with(
            tmp_path, tempo_deploy="cloud-gpu", runpod_endpoint_id="ep123", runpod_api_key="k"
        ) as gpu:
            reply = gpu.post(
                "/chat", headers=AUTH, json={"user_id": "u_g", "text": LATE_TRAIN}
            ).json()
            court = reply["mission"]["court"]
            assert len(court["absent"]) == 3 and court["outcome"] == "human_checkpoint"
            model = gpu.get("/health").json()["model"]
            assert model["answering"] is False and model["failures"] >= 3
