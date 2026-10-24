"""Doctor probes: one cheap live call per service.

Each probe returns an Outcome and never prints secrets: they only travel in request headers.
"""

from __future__ import annotations

import base64
import binascii
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from pydantic import SecretStr

from tempo_adapters.settings import Settings

LONDON = ZoneInfo("Europe/London")
SNOWFLAKE_SESSION_EXPIRED_CODE = "390112"


@dataclass(frozen=True)
class Outcome:
    ok: bool
    detail: str
    hint: str = ""


def _secret(value: SecretStr | None) -> str:
    # Probes only run once the check has confirmed the field is set.
    if value is None:
        raise ValueError("secret is not configured")
    return value.get_secret_value()


def _ms(start: float) -> str:
    return f"{(time.perf_counter() - start) * 1000:.0f} ms"


def _http_fail(resp: httpx.Response, hint: str) -> Outcome:
    return Outcome(False, f"HTTP {resp.status_code}", hint)


# --- probes -------------------------------------------------------------------------------------


async def probe_cortex(s: Settings, http: httpx.AsyncClient) -> Outcome:
    start = time.perf_counter()
    resp = await http.post(
        f"{s.cortex_base_url}/chat/completions",
        headers={"Authorization": f"Bearer {_secret(s.snowflake_pat)}"},
        json={
            "model": s.cortex_fast_model,
            "messages": [{"role": "user", "content": "Reply with: ok"}],
            "max_tokens": 1,
        },
    )
    body = _json(resp)
    # An expired token comes back as HTTP 200 with Snowflake error code 390112.
    if str(body.get("code", "")) == SNOWFLAKE_SESSION_EXPIRED_CODE:
        return Outcome(False, "token expired (Snowflake 390112)", "Create a new PAT in Snowsight.")
    if resp.status_code in (401, 403):
        return _http_fail(resp, "Check SNOWFLAKE_PAT and that its role has SNOWFLAKE.CORTEX_USER.")
    if resp.status_code != 200 or "choices" not in body:
        return _http_fail(
            resp,
            f"Is {s.cortex_fast_model} available in your region? Enable cross-region inference.",
        )
    return Outcome(True, f"{s.cortex_fast_model} answered in {_ms(start)}")


async def probe_rtt(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(
        f"{s.rtt_base_url}/api/info",
        headers={"Authorization": f"Bearer {_secret(s.rtt_token)}"},
    )
    if resp.status_code != 200:
        return _http_fail(
            resp, "If you hold a refresh token, swap it at /api/get_access_token first."
        )
    body = _json(resp)
    namespaces = (body.get("credentials") or {}).get("namespacesAvailable") or ["all"]
    return Outcome(True, f"API {body.get('api_version', '?')}, namespaces {', '.join(namespaces)}")


async def probe_hsp(s: Settings, http: httpx.AsyncClient) -> Outcome:
    yesterday = (datetime.now(tz=UTC).astimezone(LONDON) - timedelta(days=1)).date()
    day_type = {5: "SATURDAY", 6: "SUNDAY"}.get(yesterday.weekday(), "WEEKDAY")
    headers: dict[str, str] = {}
    auth: tuple[str, str] | None = None
    if s.hsp_api_key is not None:
        headers["x-apikey"] = _secret(s.hsp_api_key)
    else:
        auth = (s.hsp_user or "", _secret(s.hsp_pass))
    resp = await http.post(
        f"{s.hsp_base_url}/serviceMetrics",
        headers=headers,
        auth=auth,
        json={
            "from_loc": "OXF",
            "to_loc": "PAD",
            "from_time": "0700",
            "to_time": "0800",
            "from_date": yesterday.isoformat(),
            "to_date": yesterday.isoformat(),
            "days": day_type,
        },
    )
    if resp.status_code != 200:
        return _http_fail(resp, "Check HSP_BASE_URL and auth on your Rail Data Marketplace page.")
    services = _json(resp).get("Services") or []
    return Outcome(True, f"{len(services)} Oxford→Paddington services yesterday 07:00–08:00")


def _elevenlabs_headers(s: Settings) -> dict[str, str]:
    return {"xi-api-key": _secret(s.elevenlabs_api_key)}


async def probe_elevenlabs(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(
        "https://api.elevenlabs.io/v1/convai/agents", headers=_elevenlabs_headers(s)
    )
    if resp.status_code != 200:
        return _http_fail(resp, "Check ELEVENLABS_API_KEY and that it can use Agents.")
    agents = _json(resp).get("agents") or []
    return Outcome(True, f"key works, {len(agents)} agents visible")


async def probe_elevenlabs_agents(s: Settings, http: httpx.AsyncClient) -> Outcome:
    names = {
        "inbound": s.elevenlabs_agent_inbound_id,
        "negotiator": s.elevenlabs_agent_negotiator_id,
    }
    found = []
    for role, agent_id in names.items():
        resp = await http.get(
            f"https://api.elevenlabs.io/v1/convai/agents/{agent_id}",
            headers=_elevenlabs_headers(s),
        )
        if resp.status_code != 200:
            return Outcome(
                False, f"{role} agent: HTTP {resp.status_code}", "Run `make sync-voice` (S4.1)."
            )
        found.append(f"{role} '{_json(resp).get('name', agent_id)}'")
    return Outcome(True, ", ".join(found))


async def probe_twilio(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(
        f"https://api.twilio.com/2010-04-01/Accounts/{s.twilio_account_sid}.json",
        auth=(s.twilio_account_sid or "", _secret(s.twilio_auth_token)),
    )
    if resp.status_code != 200:
        return _http_fail(resp, "Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.")
    body = _json(resp)
    detail = (
        f"account {body.get('status', '?')} ({body.get('type', '?')}), number {s.twilio_number}"
    )
    if body.get("type") == "Trial":
        return Outcome(True, detail + "; trial accounts can only call verified numbers")
    return Outcome(True, detail)


async def probe_gemini(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        params={"pageSize": 1},
        headers={"x-goog-api-key": _secret(s.gemini_api_key)},
    )
    if resp.status_code != 200:
        return _http_fail(resp, "Check GEMINI_API_KEY in Google AI Studio.")
    return Outcome(True, "key works")


async def probe_langfuse(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(
        f"{s.langfuse_host}/api/public/projects",
        auth=(s.langfuse_public_key or "", _secret(s.langfuse_secret_key)),
    )
    if resp.status_code != 200:
        return _http_fail(resp, "Check the Langfuse keys and LANGFUSE_HOST (EU vs US cloud).")
    projects = _json(resp).get("data") or [{}]
    return Outcome(True, f"project '{projects[0].get('name', '?')}'")


async def probe_postgres(s: Settings, http: httpx.AsyncClient) -> Outcome:
    import asyncpg  # type: ignore[import-untyped]

    dsn = _secret(s.database_url).replace("postgresql+asyncpg://", "postgresql://", 1)
    start = time.perf_counter()
    conn = await asyncpg.connect(dsn, timeout=5)
    try:
        await conn.fetchval("SELECT 1")
        has_vector = await conn.fetchval(
            "SELECT count(*) FROM pg_available_extensions WHERE name = 'vector'"
        )
    finally:
        await conn.close()
    pgvector = "pgvector available" if has_vector else "pgvector NOT available"
    return Outcome(bool(has_vector), f"SELECT 1 in {_ms(start)}, {pgvector}")


async def probe_neo4j(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(s.neo4j_http_url, headers={"Accept": "application/json"})
    if resp.status_code != 200:
        return _http_fail(resp, "Start it with `docker compose up -d neo4j`.")
    return Outcome(True, f"Neo4j {_json(resp).get('neo4j_version', '?')}")


async def probe_vapid(s: Settings, http: httpx.AsyncClient) -> Outcome:
    try:
        public = _b64url(s.vapid_public_key or "")
        private = _b64url(_secret(s.vapid_private_key))
    except (binascii.Error, ValueError):
        return Outcome(False, "keys are not base64url", "Regenerate with scripts/gen_vapid.py.")
    if len(public) != 65 or public[0] != 0x04 or len(private) != 32:
        return Outcome(False, "keys are not a P-256 pair", "Regenerate with scripts/gen_vapid.py.")
    return Outcome(True, "P-256 key pair present")


async def probe_runpod(s: Settings, http: httpx.AsyncClient) -> Outcome:
    resp = await http.get(
        f"https://api.runpod.ai/v2/{s.runpod_endpoint_id}/health",
        headers={"Authorization": f"Bearer {_secret(s.runpod_api_key)}"},
    )
    if resp.status_code != 200:
        return _http_fail(resp, "Check RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY.")
    workers = _json(resp).get("workers") or {}
    return Outcome(True, f"endpoint healthy, {workers.get('ready', 0)} ready workers")


def _json(resp: httpx.Response) -> dict[str, Any]:
    try:
        body = resp.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
