"""`/voice/tts` on a Gateway built by `build()` (plan.md §4.2): 404 without a key, audio with one
(cached by voice and text), 502 when ElevenLabs fails, and the key never reaches the browser."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build
from tempo_gateway.tts import DEFAULT_VOICES, ClipCache, clip_key

TOKEN = "mission-control-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
KEY = "el-test-key-not-real"
ELEVENLABS = "https://api.elevenlabs.io/v1/text-to-speech/"
MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00fake-mp3-bytes"


def gateway(tmp_path: Path, **overrides: str) -> TestClient:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_api_token=TOKEN,
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"), **overrides,
    )  # fmt: skip
    return TestClient(build(settings))


@pytest.fixture
def configured(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)
    with gateway(tmp_path, elevenlabs_api_key=KEY, elevenlabs_voice_tempo_low="low-voice") as c:
        yield c


@pytest.fixture
def unconfigured(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)
    with gateway(tmp_path) as c:
        yield c


@respx.mock
def test_configured_returns_audio_and_caches_the_same_sentence(configured: TestClient) -> None:
    route = respx.post(url__startswith=ELEVENLABS).respond(
        200, content=MP3, headers={"content-type": "audio/mpeg"}
    )

    assert configured.get("/voice/tts", headers=AUTH).json() == {"configured": True}
    first = configured.post("/voice/tts", headers=AUTH, json={"text": "Hello Margaret."})
    second = configured.post("/voice/tts", headers=AUTH, json={"text": "Hello Margaret."})
    other = configured.post(
        "/voice/tts", headers=AUTH, json={"text": "Hello Margaret.", "voice": "low"}
    )

    assert first.status_code == 200 and first.content == MP3
    assert first.headers["content-type"] == "audio/mpeg"
    assert second.status_code == 200 and second.content == MP3
    assert other.status_code == 200
    assert route.call_count == 2  # the second call was served from the cache; "low" is a new clip
    sent = route.calls[0].request
    assert sent.url.path.endswith(DEFAULT_VOICES["tempo"])
    assert sent.headers["xi-api-key"] == KEY
    assert json.loads(sent.content) == {
        "text": "Hello Margaret.", "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }  # fmt: skip
    assert route.calls[1].request.url.path.endswith("low-voice")


@respx.mock
def test_personas_get_their_own_default_voice(configured: TestClient) -> None:
    route = respx.post(url__startswith=ELEVENLABS).respond(200, content=MP3)

    for persona in ("negotiator", "analyst", "auditor", "contractor"):
        r = configured.post("/voice/tts", headers=AUTH, json={"text": "Hi", "persona": persona})
        assert r.status_code == 200

    assert [c.request.url.path.rsplit("/", 1)[1] for c in route.calls] == [
        DEFAULT_VOICES[p] for p in ("negotiator", "analyst", "auditor", "contractor")
    ]


def test_not_configured_is_404_and_says_so(unconfigured: TestClient) -> None:
    assert unconfigured.get("/voice/tts", headers=AUTH).json() == {"configured": False}
    r = unconfigured.post("/voice/tts", headers=AUTH, json={"text": "Hello"})

    assert r.status_code == 404 and r.json() == {"detail": "voice is not configured"}
    assert unconfigured.get("/voice/tts").status_code == 401  # the bearer still applies


@respx.mock
def test_an_upstream_failure_is_502_and_nothing_is_cached(configured: TestClient) -> None:
    route = respx.post(url__startswith=ELEVENLABS).mock(
        side_effect=[httpx.Response(500, text="boom"), httpx.ConnectError("down")]
    )

    first = configured.post("/voice/tts", headers=AUTH, json={"text": "Hello"})
    second = configured.post("/voice/tts", headers=AUTH, json={"text": "Hello"})

    assert first.status_code == 502 and second.status_code == 502
    assert first.json() == {"detail": "the voice service didn't answer"}
    assert route.call_count == 2  # a failure is not cached


def test_bad_requests_are_422(configured: TestClient) -> None:
    too_long = configured.post("/voice/tts", headers=AUTH, json={"text": "x" * 601})
    empty = configured.post("/voice/tts", headers=AUTH, json={"text": ""})
    persona = configured.post("/voice/tts", headers=AUTH, json={"text": "hi", "persona": "boss"})
    language = configured.post("/voice/tts", headers=AUTH, json={"text": "hi", "language": "eng"})

    assert [r.status_code for r in (too_long, empty, persona, language)] == [422] * 4


def test_the_clip_cache_keeps_the_newest_two_hundred() -> None:
    cache = ClipCache(size=2)
    cache.put(clip_key("v", "a"), b"a")
    cache.put(clip_key("v", "b"), b"b")
    assert cache.get(clip_key("v", "a")) == b"a"  # touched: now the newest
    cache.put(clip_key("v", "c"), b"c")

    assert cache.get(clip_key("v", "b")) is None and len(cache) == 2
    assert clip_key("v", "a") != clip_key("w", "a")  # the voice is part of the key
