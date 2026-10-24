"""The Gateway honours TEMPO_DEPLOY (S8.1): what /health reports, and voice off in Private mode."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.app import create_app
from tempo_gateway.main import _court, build_services


def gateway(tmp_path: Path, mode: str) -> TestClient:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_deploy=mode, tempo_api_token="t",
        voice_tool_secret="v", checkpoint_dir=str(tmp_path / mode),
    )  # fmt: skip
    service, bus, memory = build_services(settings)
    return TestClient(create_app(service, settings, bus, memory=memory))


def test_private_mode_reports_no_outside_ai_and_turns_voice_off(tmp_path: Path) -> None:
    private, standard = gateway(tmp_path, "cloud-private"), gateway(tmp_path, "cloud-standard")
    tool = {"X-Tempo-Voice-Secret": "v"}

    assert private.get("/health").json() | {"simulated": []} == {
        "status": "ok", "mode": "replay", "demo": False, "simulated": [],
        "deploy": "cloud-private", "region": "eu (RunPod Secure Cloud)", "third_parties": [],
    }  # fmt: skip
    assert standard.get("/health").json()["third_parties"] == ["cortex", "elevenlabs", "gemini"]
    assert private.post("/voice/tools/recall_memories", json={}, headers=tool).status_code == 404
    assert private.post("/voice/post-call", json={}).status_code == 404
    assert standard.post("/voice/tools/recall_memories", json={}, headers=tool).status_code == 200


def test_private_mode_never_builds_cortex_jurors() -> None:
    def live_private(**extra: str) -> Settings:
        return Settings(  # type: ignore[call-arg]
            _env_file=None, tempo_mode="live", tempo_deploy="cloud-private",
            snowflake_account="acct", snowflake_pat="pat",  # configured, and still not used
            **extra,
        )  # fmt: skip

    assert _court(live_private()) is None  # no private model configured: no court, not Cortex
    court = _court(live_private(runpod_endpoint_id="ep1", runpod_api_key="k"))
    assert court is not None
    urls = {str(j._client.client.base_url) for j in court._jurors}  # type: ignore[attr-defined]
    assert urls == {"https://api.runpod.ai/v2/ep1/openai/v1/"}
