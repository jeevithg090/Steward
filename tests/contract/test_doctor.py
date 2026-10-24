"""`make doctor` against recorded vendor responses (respx), so no keys or network are needed."""

from __future__ import annotations

import base64
from collections.abc import Callable
from typing import Any

import httpx
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from tempo_adapters.doctor import CHECKS, Status, exit_code, render, run_checks
from tempo_adapters.settings import Settings

CORTEX_URL = "https://acme-test.snowflakecomputing.com/api/v2/cortex/v1/chat/completions"
FAKE_PAT = "pat-SECRET-1234567890"

MakeSettings = Callable[..., Settings]


@pytest.fixture
def make_settings(monkeypatch: pytest.MonkeyPatch) -> MakeSettings:
    """Settings built only from the arguments: no .env file, no developer environment."""
    for field in Settings.model_fields:
        monkeypatch.delenv(field.upper(), raising=False)

    def make(**values: Any) -> Settings:
        return Settings(_env_file=None, **values)  # type: ignore[call-arg]

    return make


def only(name: str) -> tuple[Any, ...]:
    return tuple(c for c in CHECKS if c.name == name)


async def run_one(name: str, settings: Settings) -> Any:
    async with httpx.AsyncClient() as http:
        [result] = await run_checks(settings, only(name), http)
    return result


def cortex_settings(make: MakeSettings) -> Settings:
    return make(snowflake_account="acme-test", snowflake_pat=FAKE_PAT)


@respx.mock
async def test_cortex_ok_reports_model_and_latency(make_settings: MakeSettings) -> None:
    route = respx.post(CORTEX_URL).respond(200, json={"choices": [{"message": {"content": "o"}}]})

    result = await run_one("Snowflake Cortex", cortex_settings(make_settings))

    assert result.status is Status.OK
    assert "claude-haiku-5-5 answered in" in result.detail
    assert route.calls.last.request.headers["Authorization"] == f"Bearer {FAKE_PAT}"


@respx.mock
async def test_cortex_http_200_with_390112_is_an_expired_token(
    make_settings: MakeSettings,
) -> None:
    respx.post(CORTEX_URL).respond(
        200, json={"code": "390112", "message": "Your session has expired. Please login again."}
    )

    result = await run_one("Snowflake Cortex", cortex_settings(make_settings))

    assert result.status is Status.FAIL
    assert "390112" in result.detail
    assert "PAT" in result.hint


@respx.mock
async def test_cortex_forbidden_points_at_the_cortex_user_role(
    make_settings: MakeSettings,
) -> None:
    respx.post(CORTEX_URL).respond(403, json={"message": "forbidden"})

    result = await run_one("Snowflake Cortex", cortex_settings(make_settings))

    assert result.status is Status.FAIL
    assert "SNOWFLAKE.CORTEX_USER" in result.hint


async def test_unconfigured_services_name_the_variable_owner_and_fallback(
    make_settings: MakeSettings,
) -> None:
    results = await run_checks(make_settings())

    assert all(r.status is Status.MISSING for r in results)
    twilio = next(r for r in results if r.name == "Twilio")
    assert "TWILIO_ACCOUNT_SID" in twilio.hint
    report = render(results)
    assert "owner A · fallback: ElevenLabs web widget" in report
    assert "0/8 required services ready." in report
    assert exit_code(results) == 1


@respx.mock
async def test_one_crashing_service_does_not_hide_the_others(make_settings: MakeSettings) -> None:
    respx.get(url__regex=r"https://api\.twilio\.com/.*").mock(
        side_effect=httpx.ConnectError("boom")
    )
    respx.post(CORTEX_URL).respond(200, json={"choices": []})
    settings = make_settings(
        snowflake_account="acme-test",
        snowflake_pat=FAKE_PAT,
        twilio_account_sid="AC123",
        twilio_auth_token="tok-SECRET-twilio",
        twilio_number="+15550100",
    )

    results = await run_checks(settings, only("Twilio") + only("Snowflake Cortex"))

    by_name = {r.name: r for r in results}
    assert by_name["Twilio"].status is Status.FAIL
    assert "ConnectError" in by_name["Twilio"].detail
    assert by_name["Snowflake Cortex"].status is Status.OK


@respx.mock
async def test_secrets_never_appear_in_the_report(make_settings: MakeSettings) -> None:
    respx.route().respond(500, text="internal error")
    secrets = {
        "snowflake_pat": "S1-cortex-secret",
        "rtt_token": "S2-rtt-secret",
        "hsp_api_key": "S3-hsp-secret",
        "elevenlabs_api_key": "S4-eleven-secret",
        "twilio_auth_token": "S5-twilio-secret",
        "gemini_api_key": "S6-gemini-secret",
        "langfuse_secret_key": "S7-langfuse-secret",
        "database_url": "postgresql+asyncpg://tempo:S8-db-secret@127.0.0.1:1/tempo",
        "neo4j_password": "S9-neo4j-secret",
        "vapid_private_key": "S10-vapid-secret",  # gitleaks:allow (fake test value)
        "runpod_api_key": "S11-runpod-secret",  # gitleaks:allow (fake test value)
    }
    settings = make_settings(
        snowflake_account="acme-test",
        hsp_base_url="https://hsp.example.test/api/v1",
        elevenlabs_agent_inbound_id="agent_in",
        elevenlabs_agent_negotiator_id="agent_neg",
        twilio_account_sid="AC123",
        twilio_number="+15550100",
        langfuse_public_key="pk-lf-public",
        neo4j_uri="bolt://localhost:7687",
        vapid_public_key="not-a-key",
        runpod_endpoint_id="ep123",
        **secrets,
    )

    results = await run_checks(settings)
    report = render(results) + repr(results)

    assert all(r.status is not Status.MISSING for r in results)
    for n in range(1, 12):
        assert f"S{n}-" not in report


@respx.mock
async def test_hsp_sends_the_api_key_header_and_yesterdays_window(
    make_settings: MakeSettings,
) -> None:
    route = respx.post("https://hsp.example.test/api/v1/serviceMetrics").respond(
        200, json={"Services": [{}, {}]}
    )
    settings = make_settings(hsp_base_url="https://hsp.example.test/api/v1", hsp_api_key="k-hsp")

    result = await run_one("National Rail HSP", settings)

    assert result.status is Status.OK
    assert result.detail.startswith("2 Oxford→Paddington services")
    request = route.calls.last.request
    assert request.headers["x-apikey"] == "k-hsp"
    body = request.read().decode()
    assert '"from_loc":"OXF"' in body.replace(" ", "")


async def test_hsp_needs_a_base_url_and_some_auth(make_settings: MakeSettings) -> None:
    result = await run_one("National Rail HSP", make_settings(hsp_user="me"))

    assert result.status is Status.MISSING
    assert "HSP_BASE_URL" in result.hint
    assert "HSP_API_KEY (or HSP_USER + HSP_PASS)" in result.hint


def _vapid_pair() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return b64(public), b64(private)


async def test_vapid_accepts_a_p256_pair_and_rejects_junk(make_settings: MakeSettings) -> None:
    public, private = _vapid_pair()

    good = await run_one(
        "Web Push (VAPID)", make_settings(vapid_public_key=public, vapid_private_key=private)
    )
    bad = await run_one(
        "Web Push (VAPID)", make_settings(vapid_public_key=public, vapid_private_key="AAAA")
    )

    assert good.status is Status.OK
    assert bad.status is Status.FAIL


@respx.mock
async def test_optional_failures_do_not_fail_the_exit_code(make_settings: MakeSettings) -> None:
    respx.get(url__startswith="https://generativelanguage.googleapis.com").respond(400)
    results = await run_checks(make_settings(gemini_api_key="g"), only("Gemini vision"))

    assert results[0].status is Status.FAIL
    assert "➖ Gemini vision (optional)" in render(results)
    assert exit_code(results) == 0
