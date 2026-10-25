"""The region line names only the outside AI companies a run really sends data to (plan.md §13.5):
OpenRouter appears on cloud-apis only when an OpenRouter juror sits on the Court."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tempo_adapters.settings import Settings
from tempo_gateway.main import build

TOKEN = "region-token"


def health(tmp_path: Path, **extra: Any) -> dict[str, Any]:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, tempo_mode="replay", tempo_demo=True, tempo_api_token=TOKEN,
        tempo_deploy="cloud-apis", gemini_api_key="g-test",
        checkpoint_dir=str(tmp_path / "cp"), mesh_file=str(tmp_path / "mesh.json"), **extra,
    )  # fmt: skip
    with TestClient(build(settings)) as client:
        body: dict[str, Any] = client.get("/health").json()
        return body


def test_gemini_alone_names_only_google(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    body = health(tmp_path, openrouter_api_key="or-test")  # a key alone seats nobody

    assert body["region"] == "this machine + Google"
    assert "openrouter" not in body["third_parties"]


def test_an_openrouter_juror_is_named(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    body = health(
        tmp_path,
        openrouter_api_key="or-test",
        openrouter_models="dots-studio/dots-3-note-preview:free",
    )

    assert body["region"] == "this machine + Google and OpenRouter"
    assert "openrouter" in body["third_parties"]


def test_a_stated_region_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    body = health(
        tmp_path, tempo_region="eu-west-2", openrouter_api_key="or-test",
        openrouter_models="dots-studio/dots-3-note-preview:free",
    )  # fmt: skip

    assert body["region"] == "eu-west-2"
