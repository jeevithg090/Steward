"""Kairos server mode (M1), the API-model settings (M2), voice sessions (M3) and the reliability switches."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import db, main, model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TUNNEL = {"X-Forwarded-For": "94.119.32.4"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    for k in ("KAIROS_SERVER_MODE", "KAIROS_KILL_VOICE", "KAIROS_KILL_SEND"):
        monkeypatch.delenv(k, raising=False)
    db.init(tmp_path / "k.db")
    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def owner(client):
    r = client.post("/api/devices/register", json={"name": "laptop"}).json()
    return {"Authorization": f"Bearer {r['device_token']}"}


def app_device(tmp_path):
    tok = tmp_path / "app.token"
    out = subprocess.run([sys.executable, "scripts/device_admin.py", "add-device", "--name", "Kairos iPhone app",
                          "--token-file", str(tok)], cwd=ROOT, env={**os.environ, "TEMPO_DB": str(db.DB_PATH)},
                         capture_output=True, text=True, check=True).stdout
    assert "not admin" in out and oct(tok.stat().st_mode & 0o777) == "0o600"
    return {"Authorization": f"Bearer {tok.read_text().strip()}"}


def test_server_mode_trusts_token_capabilities_but_admin_stays_local(client, owner, tmp_path, monkeypatch):
    app = app_device(tmp_path)
    assert client.get("/api/events?after=0", headers={**app, **TUNNEL}).status_code == 403  # default: tunnel = ask-only
    monkeypatch.setenv("KAIROS_SERVER_MODE", "1")
    for path in ("/api/me", "/api/consents"):  # server mode: the app's routes work from the internet, by capability
        assert client.get(path, headers={**app, **TUNNEL}).status_code == 200, path
    # ...and nothing else does, whatever the token: events, money, approvals and Guardian stay on the hub's Wi-Fi
    for method, path in (("GET", "/api/events?after=0"), ("GET", "/api/money/ledger"), ("GET", "/api/approvals"),
                         ("POST", "/api/approvals/1/approve"), ("GET", "/api/timeline"), ("GET", "/api/guardian/alerts")):
        assert client.request(method, path, headers={**app, **TUNNEL}).status_code == 403, path
    assert client.get("/api/events?after=0", headers=app).status_code == 200  # on the Wi-Fi it reads as before
    for method, path in (("GET", "/api/link"), ("POST", "/api/join-window"), ("POST", "/api/keys/rotate")):
        assert client.request(method, path, headers={**owner, **TUNNEL}).status_code == 403, path  # never admin remotely
    assert client.get("/api/link", headers=owner).status_code == 200  # admin still works locally
    assert client.get("/api/link", headers=app).status_code == 403  # the app device is never admin
    voice = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    assert client.get("/api/events?after=0", headers={"Authorization": f"Bearer {voice['token']}", **TUNNEL}).status_code == 403


def test_join_link_is_written_privately_never_printed(client, owner, tmp_path, monkeypatch):
    f = tmp_path / "join.txt"
    env = {**os.environ, "TEMPO_DB": str(db.DB_PATH), "TEMPO_PUBLIC_URL": "https://kairos.example.app"}
    out = subprocess.run([sys.executable, "scripts/device_admin.py", "join-link", "--file", str(f)], cwd=ROOT, env=env,
                         capture_output=True, text=True, check=True).stdout
    assert db.owner()["join_token"] not in out and oct(f.stat().st_mode & 0o777) == "0o600"
    assert f.read_text().startswith("https://kairos.example.app/join#t=")


def test_provider_parameter_map_and_fallback(monkeypatch):
    assert model.llm_params("https://api.openai.com/v1", "gpt-5-mini", 300) == {"max_completion_tokens": 300 + 4096}
    assert model.llm_params("https://api.openai.com/v1", "gpt-4o-mini", 300) == {"max_completion_tokens": 300, "temperature": 0.0}
    assert model.llm_params("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash", 300) == \
        {"max_tokens": 300, "temperature": 0.0}
    gem = "https://generativelanguage.googleapis.com/v1beta/openai"
    assert model.llm_params(gem, "gemini-2.5-flash", 300) == {"max_tokens": 300, "temperature": 0.0, "reasoning_effort": "none"}
    assert model.llm_params(gem, "gemini-3.5-flash-lite", 300)["max_tokens"] > 300  # thinking: room inside the cap
    assert model.llm_params("http://localhost:11434/v1", "qwen2.5:7b", 300)["keep_alive"] == -1
    calls = []

    class FakeClient:
        def post(self, url, headers=None, json=None, timeout=None):
            calls.append((url, json))
            if "primary" in url:
                raise httpx.ConnectError("down")
            return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(model, "BASE_URL", "https://primary.example/v1")
    monkeypatch.setattr(model, "FALLBACK", ("https://api.openai.com/v1", "gpt-4o-mini", "k"))
    msg = model._post(FakeClient(), __import__("time").monotonic() + 10, {"messages": [], "tool_choice": "required"}, t := [])
    assert msg["_model"] == "gpt-4o-mini" and len(calls) == 2 and len(t) == 2
    assert calls[1][1]["max_completion_tokens"] == model.MAX_TOKENS and calls[1][1]["tool_choice"] == "required"


def test_voice_callers_get_a_forced_first_tool_call_and_a_voice_budget(client, owner, monkeypatch):
    bodies = []
    replies = [{"tool_calls": [{"id": "1", "function": {"name": "search_events", "arguments": '{"query": "train"}'}}]},
               {"content": "Nothing found today."}]

    def post(client, deadline, body, *_):
        bodies.append(body)
        return {**replies.pop(0), "_model": "m"}
    monkeypatch.setattr(model, "_post", post)
    monkeypatch.setattr(model, "VOICE_BUDGET", 10.0)
    r = model.ask(db.owner()["id"], "Did anything happen with my train today?", allow_vault=False, spoken=True)
    assert bodies[0]["tool_choice"] == "required" and "tool_choice" not in bodies[1]
    assert r["model"] == "m" and "total_ms" in r["timings"]


def test_voice_session_mints_a_token_and_ask_checks_the_session(client, owner, tmp_path, monkeypatch):
    app = app_device(tmp_path)
    monkeypatch.setattr(main, "server_env", lambda n: {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "agent_x"}.get(n))
    monkeypatch.setattr(httpx, "get", lambda url, params=None, headers=None, timeout=None: httpx.Response(
        200, json={"token": "el-call-token"}, request=httpx.Request("GET", url)))
    r = client.post("/api/voice/session", headers=app).json()
    assert r["conversation_token"] == "el-call-token" and r["kairos_session"].startswith("ks_")
    assert r["kairos_session"] not in str(db.conn().execute("SELECT * FROM kairos_sessions").fetchall())  # hashed
    voice = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    vh = {"Authorization": f"Bearer {voice['token']}"}
    monkeypatch.setattr(main.model, "ask", lambda pid, q, **kw: {"answer": "ok"})
    assert client.post("/api/ask", headers={**vh, "X-Kairos-Session": r["kairos_session"]}, json={"question": "q"}).status_code == 200
    assert client.post("/api/ask", headers={**vh, "X-Kairos-Session": "ks_forged"}, json={"question": "q"}).status_code == 401
    for placeholder in ("none", "None", "", "{{secret__kairos_session}}"):  # callers without a session: unchanged
        assert client.post("/api/ask", headers={**vh, "X-Kairos-Session": placeholder}, json={"question": "q"}).status_code == 200
    assert client.post("/api/voice/session", headers=vh).status_code == 403  # the agent token can't start calls
    for _ in range(main.VOICE_SESSIONS_PER_DAY - 1):
        client.post("/api/voice/session", headers=app)
    assert client.post("/api/voice/session", headers=app).status_code == 429  # daily voice minutes


def test_kill_switches_and_health(client, owner, monkeypatch):
    voice = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    monkeypatch.setenv("KAIROS_KILL_VOICE", "1")
    assert client.post("/api/ask", headers={"Authorization": f"Bearer {voice['token']}"}, json={"question": "q"}).status_code == 503
    assert client.get("/api/health").json() == {"ok": True, "voice": False, "send": True, "model": "api"}
