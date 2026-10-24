"""Local mode (S8.7): everything on this machine, reachable only from it."""

from __future__ import annotations

from pathlib import Path

import yaml

from tempo_crypto.allowlist import pinned

COMPOSE = Path(__file__).resolve().parents[2] / "deploy" / "local" / "docker-compose.local.yml"


def test_local_stack_binds_only_to_localhost_and_pins_images() -> None:
    services = yaml.safe_load(COMPOSE.read_text())["services"]

    ports = [p for s in services.values() for p in s.get("ports", [])]
    assert ports and all(p.startswith("127.0.0.1:") for p in ports)
    released = [s["image"] for name, s in services.items() if name != "gateway"]
    assert all(pinned(i.replace(":0.40.2@", "@").replace(":pg16@", "@")) for i in released)
    gateway = services["gateway"]
    assert gateway["environment"]["TEMPO_DEPLOY"] == "local"
    assert gateway["environment"]["OLLAMA_BASE_URL"].startswith("http://ollama:")
    assert gateway["read_only"] is True and gateway["tmpfs"] == ["/tmp"]  # noqa: S108 (a tmpfs)
