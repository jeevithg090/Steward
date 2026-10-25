"""Settings for Tempo's agents. Read from agents/.env (never printed), then the environment.

The .env file holds the Gemini key. It is written only by set_gemini_key.sh (clipboard -> file, chmod 600).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

AGENTS_DIR = Path(__file__).resolve().parents[1]
HUB_DIR = AGENTS_DIR.parent
ENV_FILE = AGENTS_DIR / ".env"
DATA_DIR = AGENTS_DIR / "data"


def read_env_file(path: Path = ENV_FILE) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            k, sep, v = line.partition("=")
            if sep and k.strip() and not k.lstrip().startswith("#"):
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _get(env: dict, name: str, default: str = "") -> str:
    return os.environ.get(name) or env.get(name) or default


@dataclass
class Settings:
    gemini_api_key: str = ""
    provider: str = "auto"                 # auto | gemini | local
    model: str = "gemini-3.8-flash"        # reads the photo and writes the explanation
    fast_model: str = "gemini-3.5-flash-lite"
    tts_model: str = "gemini-3.8-flash-lite-tts"
    tts_voice: str = "Kore"
    local_model: str = "qwen3.5:4b"        # Ollama, vision-capable, on this Mac
    ollama_url: str = "http://127.0.0.1:11434"
    hub_url: str = "http://127.0.0.1:8787"
    port: int = 8789
    budget_seconds: float = 90.0           # the whole job; past it the job reports what it has
    extra: dict = field(default_factory=dict)

    @property
    def gemini_enabled(self) -> bool:
        return self.provider in ("auto", "gemini") and bool(self.gemini_api_key)

    @property
    def local_enabled(self) -> bool:
        return self.provider in ("auto", "local")

    def public(self) -> dict:
        """Safe to show: no key, only whether one is set."""
        return {"provider": self.provider, "gemini_key_set": bool(self.gemini_api_key), "model": self.model,
                "tts_model": self.tts_model, "local_model": self.local_model, "hub_url": self.hub_url}


def load() -> Settings:
    env = read_env_file()
    return Settings(
        gemini_api_key=_get(env, "GEMINI_API_KEY") or _get(env, "GOOGLE_API_KEY"),
        provider=_get(env, "TEMPO_AGENTS_PROVIDER", "auto").lower(),
        model=_get(env, "TEMPO_AGENTS_MODEL", "gemini-3.8-flash"),
        fast_model=_get(env, "TEMPO_AGENTS_FAST_MODEL", "gemini-3.5-flash-lite"),
        tts_model=_get(env, "TEMPO_AGENTS_TTS_MODEL", "gemini-3.8-flash-lite-tts"),
        tts_voice=_get(env, "TEMPO_AGENTS_TTS_VOICE", "Kore"),
        local_model=_get(env, "TEMPO_AGENTS_LOCAL_MODEL", "qwen3.5:4b"),
        ollama_url=_get(env, "TEMPO_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        hub_url=_get(env, "TEMPO_HUB_URL", "http://127.0.0.1:8787").rstrip("/"),
        port=int(_get(env, "TEMPO_AGENTS_PORT", "8789")),
        budget_seconds=float(_get(env, "TEMPO_AGENTS_BUDGET", "90")),
    )
