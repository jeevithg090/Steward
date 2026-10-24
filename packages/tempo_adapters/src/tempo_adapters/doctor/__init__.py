"""`make doctor`: one cheap live call per service, so a broken key shows up before the demo does.

Every failure names its owner and the fallback that keeps the demo running (usually
TEMPO_MODE=replay).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum

import httpx

from tempo_adapters.doctor import probes
from tempo_adapters.doctor.probes import Outcome
from tempo_adapters.settings import Settings

TIMEOUT = httpx.Timeout(10.0)
REPLAY = "TEMPO_MODE=replay (recorded fixtures)"
VOICE_FALLBACK = "scripted call recording + the same tool events"


class Status(StrEnum):
    OK = "ok"
    FAIL = "fail"
    MISSING = "missing"


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: Status
    detail: str
    hint: str
    owner: str
    fallback: str
    required: bool


Probe = Callable[[Settings, httpx.AsyncClient], Awaitable[Outcome]]


@dataclass(frozen=True)
class Check:
    name: str
    owner: str
    fallback: str
    probe: Probe
    needs: tuple[str, ...] | Callable[[Settings], list[str]]
    required: bool = True

    def missing(self, settings: Settings) -> list[str]:
        if callable(self.needs):
            return self.needs(settings)
        return [field.upper() for field in self.needs if getattr(settings, field) is None]


def _hsp_missing(s: Settings) -> list[str]:
    missing = ["HSP_BASE_URL"] if s.hsp_base_url is None else []
    if s.hsp_api_key is None and (s.hsp_user is None or s.hsp_pass is None):
        missing.append("HSP_API_KEY (or HSP_USER + HSP_PASS)")
    return missing


CHECKS: tuple[Check, ...] = (
    Check("Snowflake Cortex", "B", REPLAY, probes.probe_cortex,
          ("snowflake_account", "snowflake_pat")),
    Check("Realtime Trains", "C", REPLAY, probes.probe_rtt, ("rtt_token",)),
    Check("National Rail HSP", "C", REPLAY, probes.probe_hsp, _hsp_missing),
    Check("ElevenLabs", "A", VOICE_FALLBACK, probes.probe_elevenlabs, ("elevenlabs_api_key",)),
    Check("ElevenLabs agents", "A", VOICE_FALLBACK, probes.probe_elevenlabs_agents,
          ("elevenlabs_api_key", "elevenlabs_agent_inbound_id",
           "elevenlabs_agent_negotiator_id")),
    Check("Twilio", "A", "ElevenLabs web widget instead of a phone number", probes.probe_twilio,
          ("twilio_account_sid", "twilio_auth_token", "twilio_number")),
    Check("Langfuse", "D", "console span exporter", probes.probe_langfuse,
          ("langfuse_public_key", "langfuse_secret_key")),
    Check("Postgres", "C", "local Docker Postgres (docker compose up -d postgres)",
          probes.probe_postgres, ("database_url",)),
    Check("Gemini vision", "C", "replay fixtures for tickets and letters", probes.probe_gemini,
          ("gemini_api_key",), required=False),
    Check("Neo4j (Graphiti)", "C", "TEMPO_TEMPORAL=sql", probes.probe_neo4j, ("neo4j_uri",),
          required=False),
    Check("Web Push (VAPID)", "D", "WebSocket updates only", probes.probe_vapid,
          ("vapid_public_key", "vapid_private_key"), required=False),
    Check("RunPod vLLM", "C", "TEMPO_DEPLOY=cloud-standard (Cortex)", probes.probe_runpod,
          ("runpod_api_key", "runpod_endpoint_id"), required=False),
)  # fmt: skip


async def run_check(check: Check, settings: Settings, http: httpx.AsyncClient) -> CheckResult:
    def result(status: Status, detail: str, hint: str = "") -> CheckResult:
        return CheckResult(
            check.name, status, detail[:200], hint, check.owner, check.fallback, check.required
        )

    missing = check.missing(settings)
    if missing:
        return result(Status.MISSING, "not configured", f"Set {', '.join(missing)} in .env.")
    try:
        outcome = await check.probe(settings, http)
    except Exception as exc:  # one broken service must not hide the others
        return result(Status.FAIL, f"{type(exc).__name__}: {exc}", "Is the service reachable?")
    return result(Status.OK if outcome.ok else Status.FAIL, outcome.detail, outcome.hint)


async def run_checks(
    settings: Settings, checks: tuple[Check, ...] = CHECKS, http: httpx.AsyncClient | None = None
) -> list[CheckResult]:
    """Run every check concurrently. A caller-supplied client stays open for the caller."""
    if http is None:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            return await run_checks(settings, checks, client)
    return list(await asyncio.gather(*(run_check(c, settings, http) for c in checks)))


def render(results: list[CheckResult]) -> str:
    lines = []
    for r in results:
        label = r.name if r.required else f"{r.name} (optional)"
        if r.status is Status.OK:
            lines.append(f"✅ {label:<30} {r.detail}")
            continue
        icon = "❌" if r.required else "➖"
        lines.append(f"{icon} {label:<30} {r.detail}")
        if r.hint:
            lines.append(f"   {'':<30} {r.hint}")
        lines.append(f"   {'':<30} owner {r.owner} · fallback: {r.fallback}")
    required = [r for r in results if r.required]
    ready = sum(r.status is Status.OK for r in required)
    lines += ["", f"{ready}/{len(required)} required services ready."]
    return "\n".join(lines)


def exit_code(results: list[CheckResult]) -> int:
    return 0 if all(r.status is Status.OK for r in results if r.required) else 1
