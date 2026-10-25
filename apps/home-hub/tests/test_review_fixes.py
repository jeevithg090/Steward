"""Regression tests for the 25 Oct server review: vault never reaches a hosted fallback, the tunnel allow-list,
owner-only capabilities, voice sessions, atomic caps, Write for me off the event loop, revise/approve races,
outage vs refusal, keyed hashes, key handling, forget, and the API-keys-only switch."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

os.environ["TEMPO_DB"] = os.path.join(tempfile.mkdtemp(prefix="tempo-test-"), "unused.db")  # never data/
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"
os.environ["TEMPO_HOME_TZ"] = "Europe/London"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import bridge, bridge_checks, db, main, model, providers  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TUNNEL = {"X-Forwarded-For": "94.119.32.4"}
META = {"recipient": {"ref": "p_7f3a", "alias": "Amma", "relation": "mother"}, "channel": "whatsapp", "tone": "warm",
        "target_lang": "en-GB", "speech_lang": "en"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    for k in ("KAIROS_SERVER_MODE", "KAIROS_KILL_VOICE", "KAIROS_KILL_SEND", "KAIROS_DRAFT_KEY", "KAIROS_LOCAL_MODELS"):
        monkeypatch.delenv(k, raising=False)
    db.init(tmp_path / "r.db")
    bridge._ready.clear()
    calls = {"compose": 0, "back": 0, "speak": 0, "stt": 0}

    def compose(transcript, recipient, tone, target_lang, sign_off=None, timeout=8.0):
        calls["compose"] += 1
        return {"text": f"[{tone}] {transcript}", "changes_made": [f"{tone} tone, said {transcript}"], "missing": [],
                "risk": [], "provider": "gemini:fake", "ms": 1}

    def back(draft, frm, to="en", timeout=8.0):
        calls["back"] += 1
        return {"text": f"(back) {draft}", "provider": "gemini:fake", "ms": 1}

    def speak(text, lang=None, timeout=8.0):
        calls["speak"] += 1
        return {"audio": b"ID3", "provider": "fake", "ms": 1}

    def stt(audio, **kw):
        calls["stt"] += 1
        return {"text": "", "lang": "en", "provider": "elevenlabs:scribe_v2", "ms": 1}
    monkeypatch.setattr(providers, "compose", compose)
    monkeypatch.setattr(providers, "back_translate", back)
    monkeypatch.setattr(providers, "speak", speak)
    monkeypatch.setattr(providers, "transcribe", stt)
    with TestClient(main.app) as c:
        c.calls = calls
        yield c


@pytest.fixture()
def owner(client):
    r = client.post("/api/devices/register", json={"name": "laptop"}).json()
    return {"Authorization": f"Bearer {r['device_token']}"}


@pytest.fixture()
def app(client, owner, tmp_path):
    tok = tmp_path / "app.token"
    subprocess.run([sys.executable, "scripts/device_admin.py", "add-device", "--name", "Kairos iPhone app",
                    "--token-file", str(tok)], cwd=ROOT, env={**os.environ, "TEMPO_DB": str(db.DB_PATH)},
                   capture_output=True, text=True, check=True)
    return {"Authorization": f"Bearer {tok.read_text().strip()}"}


def draft(client, app, transcript="I'll be home at 8, don't wait for dinner", **meta):
    r = client.post("/api/bridge/draft", headers=app, json={**META, **meta, "transcript": transcript})
    assert r.status_code == 200, r.text
    return r.json()


def approve(client, app, d):
    return client.post(f"/api/bridge/drafts/{d['draft_id']}/approve", headers=app, json={
        "version": d["version"], "text_hash": d["text_hash"], "recipient_ref": "p_7f3a", "channel": "whatsapp"})


# ---------- model: vault, fallback order, wall clock, budgets, provider choice ----------

def test_vault_never_goes_to_a_hosted_fallback_of_a_local_primary(monkeypatch):
    monkeypatch.setattr(model, "BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setattr(model, "FALLBACK", ("https://api.openai.com/v1", "gpt-4o-mini", "sk-fake"))
    assert [p[0] for p in model._providers(private=True)] == ["http://localhost:11434/v1"]
    assert len(model._providers(private=False)) == 2
    monkeypatch.setattr(model, "FALLBACK", ("http://api.example.com/v1", "m", "sk-fake"))  # a key over plain http
    assert [p[0] for p in model._providers()] == ["http://localhost:11434/v1"]


def test_a_hosted_fallback_is_skipped_end_to_end_when_vault_is_in_play(client, owner, monkeypatch):
    hosts = []

    def handler(request):
        hosts.append(request.url.host)
        if request.url.host == "localhost":
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "173 bpm"}}]})
    monkeypatch.setattr(model, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(model, "BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setattr(model, "FALLBACK", ("https://api.openai.com/v1", "gpt-4o-mini", "sk-fake"))
    r = model.ask(db.owner()["id"], "what was my heart rate?", allow_vault=True)
    assert "api.openai.com" not in hosts and r["model"] is None


def test_a_failed_primary_goes_behind_the_fallback_for_the_rest_of_the_question(monkeypatch):
    monkeypatch.setattr(model, "BASE_URL", "https://primary.example/v1")
    monkeypatch.setattr(model, "FALLBACK", ("https://backup.example/v1", "b", "k"))
    primary = ("https://primary.example/v1", model.MODEL, model.API_KEY)
    assert model._providers(skip={primary})[0][0] == "https://backup.example/v1"
    seen = []

    class Hung:
        def post(self, url, headers=None, json=None, timeout=None):
            seen.append(url)
            if "primary" in url:
                time.sleep(timeout + 1)
            return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(model, "TIMEOUT", 0.3)
    failed: set = set()
    t0 = time.monotonic()
    assert model._post(Hung(), time.monotonic() + 5, {"messages": []}, [], False, failed)["_model"] == "b"
    assert time.monotonic() - t0 < 1.5  # the wall clock, not httpx's per-phase timeout
    seen.clear()
    assert model._post(Hung(), time.monotonic() + 5, {"messages": []}, [], False, failed)["_model"] == "b"
    assert "backup" in seen[0]  # round 2 tries the fallback first


def test_the_wait_for_a_slot_comes_out_of_the_voice_budget(client, owner, monkeypatch):
    seen = []

    def post(client, deadline, body, *_):
        seen.append(deadline - time.monotonic())
        return {"content": "hello", "_model": "m"}
    monkeypatch.setattr(model, "_post", post)
    monkeypatch.setattr(model, "VOICE_BUDGET", 10.0)
    model.ask(db.owner()["id"], "hello there", allow_vault=False, spoken=True, budget=model.BUDGET - 4)
    assert seen[0] < 6.5


def test_api_keys_only_and_the_gemini_key_from_agents_env(tmp_path, monkeypatch):
    agents_env = tmp_path / "agents.env"
    agents_env.write_text("GEMINI_API_KEY=AIzaFAKE\n")
    monkeypatch.setenv("KAIROS_AGENTS_ENV_FILE", str(agents_env))
    monkeypatch.delenv("TEMPO_LLM_BASE_URL", raising=False)
    base, _, key = providers.tempo_llm()
    assert base == providers.GEMINI_BASE and key == "AIzaFAKE"
    assert providers.llm_config()[0] == providers.GEMINI_BASE  # the Bridge follows the same model
    monkeypatch.setenv("KAIROS_LOCAL_MODELS", "0")
    monkeypatch.setattr(model, "BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setattr(model, "FALLBACK", ("", "", ""))
    assert model._providers() == []
    monkeypatch.setenv("TEMPO_LLM_BASE_URL", "http://localhost:11434/v1")
    with pytest.raises(providers.ProviderError, match="local models are off"):
        providers._chat([{"role": "user", "content": "hi"}], 50, 2.0)


def test_server_env_and_kill_switches_read_the_env_file_like_the_providers(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("export ELEVENLABS_AGENT_ID=agent_x  # demo agent\nKAIROS_KILL_VOICE=1\n")
    monkeypatch.setenv("KAIROS_ENV_FILE", str(f))
    monkeypatch.delenv("KAIROS_KILL_VOICE", raising=False)
    assert main.server_env("ELEVENLABS_AGENT_ID") == "agent_x"
    assert main.killed("KAIROS_KILL_VOICE")  # flipped without a restart


# ---------- auth: tunnel allow-list, owner-only capabilities, sessions ----------

def test_self_registered_devices_never_get_owner_only_capabilities(client, owner):
    r = client.post("/api/devices/register", json={"name": "x", "join_token": db.owner()["join_token"],
                                                   "capabilities": ["guardian", "vault", "hands", "web"]})
    caps = json.loads(db.device_by_token(r.json()["device_token"])["capabilities"])
    assert caps == ["web"]
    imposter = db.add_device(db.owner()["id"], "imposter", "x", "phone", ["guardian"], "join-window")
    r = client.post("/api/events", headers={"Authorization": f"Bearer {imposter['token']}"},
                    json={"events": [{"kind": "guardian.alert", "payload": {"text": "Call 0800 000 0000"}}]})
    assert r.status_code == 422
    real = db.add_device(db.owner()["id"], "Kairos Guardian", "guardian", "guardian", ["guardian"], "owner-cli")
    assert client.post("/api/events", headers={"Authorization": f"Bearer {real['token']}"},
                       json={"events": [{"kind": "guardian.alert", "payload": {"text": "ok"}}]}).status_code == 200
    assert client.post("/api/voice/session", headers={"Authorization": f"Bearer {real['token']}"}).status_code == 403


def test_tunnel_reaches_only_the_apps_routes_and_never_from_a_window_device(client, owner, app, monkeypatch):
    monkeypatch.setenv("KAIROS_SERVER_MODE", "1")
    assert client.get("/api/me", headers={**app, **TUNNEL}).status_code == 200
    assert client.post("/api/bridge/draft", headers={**app, **TUNNEL}, json={**META, "transcript": "hi there"}).status_code == 200
    assert client.get("/api/money/ledger", headers={**app, **TUNNEL}).status_code == 403
    win = db.add_device(db.owner()["id"], "window phone", "web", "phone", [], "join-window")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {win['token']}", **TUNNEL}).status_code == 403
    assert client.get("/api/me", headers={"Authorization": f"Bearer {win['token']}"}).status_code == 200


def test_sessions_from_removed_devices_and_vault_without_a_session(client, owner, app, monkeypatch):
    monkeypatch.setattr(main, "server_env", lambda n: {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}.get(n))
    monkeypatch.setattr(httpx, "get", lambda url, params=None, headers=None, timeout=None: httpx.Response(
        200, json={"token": "t"}, request=httpx.Request("GET", url)))
    sess = client.post("/api/voice/session", headers=app).json()["kairos_session"]
    agent = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask", "vault"], "owner-cli")
    ah = {"Authorization": f"Bearer {agent['token']}"}
    got = []
    monkeypatch.setattr(main.model, "ask", lambda pid, q, **kw: got.append(kw["allow_vault"]) or {"answer": "ok"})
    monkeypatch.setenv("KAIROS_SERVER_MODE", "1")
    assert client.post("/api/ask", headers={**ah, "X-Kairos-Session": "none"}, json={"question": "q"}).status_code == 200
    assert client.post("/api/ask", headers={**ah, "X-Kairos-Session": sess}, json={"question": "q"}).status_code == 200
    assert got == [False, True]  # private answers only inside a live call the app started
    app_id = db.device_by_token(app["Authorization"].split()[1])["id"]
    db.remove_device(db.owner()["id"], app_id)
    assert client.post("/api/ask", headers={**ah, "X-Kairos-Session": sess}, json={"question": "q"}).status_code == 401


def test_the_voice_session_cap_holds_under_a_burst_and_refunds_failed_mints(client, owner, app, monkeypatch):
    monkeypatch.setattr(main, "server_env", lambda n: {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}.get(n))

    def slow_get(url, params=None, headers=None, timeout=None):
        time.sleep(0.2)
        return httpx.Response(200, json={"token": "t"}, request=httpx.Request("GET", url))
    monkeypatch.setattr(httpx, "get", slow_get)
    codes = []
    threads = [threading.Thread(target=lambda: codes.append(client.post("/api/voice/session", headers=app).status_code))
               for _ in range(10)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert codes.count(200) == main.VOICE_SESSIONS_PER_DAY and codes.count(429) == 10 - main.VOICE_SESSIONS_PER_DAY
    pid = db.owner()["id"]
    db.usage_add(pid, "voice_sessions", -1)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("down")))
    assert client.post("/api/voice/session", headers=app).status_code == 502
    assert db.usage_today(pid, "voice_sessions") == main.VOICE_SESSIONS_PER_DAY - 1  # given back


# ---------- Write for me ----------

def test_a_slow_draft_doesnt_stall_the_hub(client, app, monkeypatch):
    gate = threading.Event()

    def slow_compose(transcript, *a, **k):
        gate.wait(3)
        return {"text": transcript, "changes_made": [], "missing": [], "risk": [], "provider": "x", "ms": 1}
    monkeypatch.setattr(providers, "compose", slow_compose)
    t = threading.Thread(target=lambda: client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "hi there"}))
    t.start()
    time.sleep(0.3)
    t0 = time.monotonic()
    assert client.get("/api/health").status_code == 200
    took = time.monotonic() - t0
    gate.set()
    t.join()
    assert took < 1.0


def test_revise_racing_approve_never_overwrites_an_approved_draft(client, app, monkeypatch):
    d = draft(client, app)
    gate, started = threading.Event(), threading.Event()

    def slow_compose(transcript, recipient, tone, *a, **k):
        started.set()
        gate.wait(3)
        return {"text": f"[{tone}] {transcript}", "changes_made": [], "missing": [], "risk": [], "provider": "x", "ms": 1}
    monkeypatch.setattr(providers, "compose", slow_compose)
    out = {}
    t = threading.Thread(target=lambda: out.update(r=client.post(f"/api/bridge/drafts/{d['draft_id']}/revise",
                                                                 headers=app, json={"version": 1, "chip": "warmer"})))
    t.start()
    started.wait(3)
    a = approve(client, app, d)
    gate.set()
    t.join()
    assert a.status_code == 200 and out["r"].status_code == 409
    card = client.get(f"/api/bridge/drafts/{d['draft_id']}", headers=app).json()
    assert card["state"] == "approved" and card["version"] == 1 and card["text"] == d["text"]
    r = client.post(f"/api/bridge/drafts/{d['draft_id']}/outcome", headers=app,
                    json={"nonce": a.json()["nonce"], "outcome": "handed_off"})
    assert r.status_code == 200


def test_an_outage_offers_the_words_back_but_a_prose_refusal_never_does(client, app, monkeypatch):
    for reason in ("generic:qwen2.5:7b: network error", "gemini:x: HTTP 401 auth failed", "gemini:x: reply cut off",
                   "ollama:qwen2.5:7b: local models are off (KAIROS_LOCAL_MODELS=0); set an API key"):
        monkeypatch.setattr(providers, "compose", lambda *a, _r=reason, **k: (_ for _ in ()).throw(providers.ProviderError(_r)))
        d = draft(client, app, transcript="running late, sorry", target_lang="te-Telu")
        assert d["text"] == "running late, sorry" and d["checks"]["needs_tap"], reason
        assert any(f["kind"] == "compose_failed" for f in d["checks"]["flags"]) and d["back_translation"] is None
    assert client.calls["back"] == 0  # the person's own words aren't back-translated as if they were Telugu
    d = draft(client, app, target_lang="te-Telu")
    monkeypatch.setattr(providers, "compose", lambda *a, **k: (_ for _ in ()).throw(providers.ProviderError("x: timeout")))
    r = client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 1, "chip": "warmer"}).json()
    assert any(f["kind"] == "compose_failed" for f in r["checks"]["flags"]) and r["checks"]["needs_tap"]
    monkeypatch.setattr(providers, "compose", lambda *a, **k: (_ for _ in ()).throw(providers.ProviderError("x: no JSON in reply")))
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "tell him I'll hurt him"})
    assert r.status_code == 422 and r.json()["error"] == "refused"


def test_caps_count_every_paid_call_and_say_why_in_a_sentence(client, app, monkeypatch):
    monkeypatch.setitem(bridge.CAPS, "drafts", 3)
    for _ in range(2):  # clips that came back empty still cost a transcription
        r = client.post("/api/bridge/draft", headers=app, files={"audio": ("clip.m4a", b"\0" * 100, "audio/mp4")},
                        data={"meta": json.dumps(META)})
        assert r.status_code == 422
    d = draft(client, app)
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "one more"})
    assert r.status_code == 429 and r.json()["error"] == "daily_limit" and " " in r.json()["message"]
    monkeypatch.setitem(bridge.CAPS, "revisions", 1)
    assert client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 1, "chip": "warmer"}).status_code == 200
    assert client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 2, "chip": "shorter"}).status_code == 429
    monkeypatch.setitem(bridge.CAPS, "readbacks", 1)
    assert client.get(f"/api/bridge/drafts/{d['draft_id']}/readback", headers=app).status_code == 200
    assert client.get(f"/api/bridge/drafts/{d['draft_id']}/readback", headers=app).status_code == 429
    assert client.calls["speak"] == 1


def test_stored_hash_and_notes_are_keyed_or_encrypted_and_drafts_belong_to_one_device(client, owner, app):
    import hashlib
    d = draft(client, app, transcript="it's 7351")
    row = db.conn().execute("SELECT * FROM drafts").fetchone()
    assert row["text_hash"] != "sha256:" + hashlib.sha256(d["text"].encode()).hexdigest()
    assert "7351" not in json.dumps(dict(row)) and "warm tone" not in json.dumps(dict(row))
    assert client.get(f"/api/bridge/drafts/{d['draft_id']}", headers=owner).status_code == 404  # another device


def test_bridge_audit_names_providers_and_revisions(client, app):
    d = draft(client, app)
    client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 1, "chip": "shorter"})
    audit = {e["kind"]: e["payload"] for e in db.events_after(db.owner()["id"]) if e["kind"].startswith("bridge.")}
    assert audit["bridge.drafted"]["providers"] == {"compose": "gemini:fake"} and audit["bridge.revised"]["version"] == 2


def test_draft_key_mistakes_are_clear_and_a_changed_key_retires_old_drafts(client, app, monkeypatch):
    d = draft(client, app)
    monkeypatch.setenv("KAIROS_DRAFT_KEY", "Y2hhbmdlbWU=")  # 'changeme': 8 bytes, not 32
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "hi there"})
    assert r.status_code == 503 and r.json()["error"] == "draft_key"
    monkeypatch.setenv("KAIROS_DRAFT_KEY", __import__("base64").b64encode(b"k" * 32).decode())
    assert client.get(f"/api/bridge/drafts/{d['draft_id']}", headers=app).status_code == 404  # can't open: retired
    assert db.conn().execute("SELECT count(*) FROM drafts").fetchone()[0] == 0


def test_forget_everything_deletes_drafts(client, owner, app):
    draft(client, app)
    assert client.post("/api/forget", headers=owner, json={"all": True}).status_code == 200
    assert db.conn().execute("SELECT count(*) FROM drafts").fetchone()[0] == 0


def test_contact_aliases_never_become_keyterms_and_clips_stay_in_memory():
    assert providers._keyterms(["Amma", "+44 7700 900123", "ravi@example.com"]) == ["Amma"]
    from starlette.formparsers import MultiPartParser
    assert MultiPartParser.spool_max_size > bridge.MAX_AUDIO_BYTES


def test_links_the_composer_adds_are_caught_in_any_case_script_or_as_an_ip():
    said = "tell Amma I will be late tonight"
    for d in ("see фото.рф/ravi", "Album at Фото.рф", "Hsbc-Secure.Support/verify", "Hsbc-Secure.Support:443/verify",
              "pay at 203.0.113.5/pay", "open 10.0.0.1:8080", "Open 203.0.113.5?id=1000",
              "ok...hsbc-secure.co.uk/verify", "Link:-bit.ly/3xYz", "Album -photos.family/ravi", "@bit.ly/3xYz",
              "...203.0.113.5/pay", "Late tonight. फोटो.भारत/ravi", "Late tonight. ఫోటోలు.భారత్/ravi",
              "Photos at 360.photos/ravi", "Mail ravi@фото.рф"):
        assert bridge_checks.check_draft(said, d)["blocked"], d
    for d in ("Photos.Family/ravi", "Amma.How/when are you coming?", "Photos.Family:8080/ravi",  # maybe a link, maybe
              "Photos at no.support/verify", "Insta: @ravi.photos", "डॉ.राव/डॉ.रेड्डी आएंगे"):  # a typo or a name
        r = bridge_checks.check_draft(said, d)
        assert not r["blocked"] and r["needs_tap"] and any(f["kind"] == "possible_link" for f in r["flags"]), d
    for d in ("Amma.How are you", "Dr.Rao said hi", "the 8.15/8.45 train", "అమ్మ.నేను ఆలస్యం", "He did an M.Sc/M.Tech",
              "Ask K.Ravi/K.Sita to call", "Col.Singh/Maj.Rao", "Meet at R.K.Puram/Dwarka", "tzn.że będę później",
              "np.żółty albo zielony", "diolch.wêl i ti", "Sections 4.2.1.3/4.2.1.4 of the lease", "Score 6.4.6.3/7.5"):
        assert not bridge_checks.check_draft(said, d)["blocked"], d
    assert not bridge_checks.check_draft("the router page is 192.168.0.1", "Router: 192.168.0.1/")["blocked"]


def test_reset_demo_clears_todays_counters(client, owner, tmp_path):
    db.usage_add(db.owner()["id"], "new_recipients", 5)
    voice_count = tmp_path / ".voice_sessions.json"  # never the real voice/ counter
    voice_count.write_text('{"day": "2026-10-25", "count": 4}')
    env = {**os.environ, "TEMPO_DB": str(db.DB_PATH), "KAIROS_VOICE_COUNT_FILE": str(voice_count)}
    subprocess.run([sys.executable, "scripts/reset_demo.py", "--yes"], cwd=ROOT, env=env, check=True, capture_output=True)
    assert db.usage_today(db.owner()["id"], "new_recipients") == 0 and not voice_count.exists()


def test_app_link_is_written_privately_and_never_printed(client, owner, tmp_path):
    tok, out, envf = tmp_path / "app.token", tmp_path / "link.txt", tmp_path / ".env"
    tok.write_text("tok_" + "x" * 30 + "\n")
    envf.write_text("TEMPO_PHONE_KEY=pk_" + "y" * 20 + "\nTEMPO_PUBLIC_HUB_URL=https://hub.example.app\n")
    env = {**os.environ, "TEMPO_DB": str(db.DB_PATH), "KAIROS_ENV_FILE": str(envf)}
    r = subprocess.run([sys.executable, "scripts/device_admin.py", "app-link", "--token-file", str(tok), "--file", str(out)],
                       cwd=ROOT, env=env, capture_output=True, text=True, check=True)
    assert "x" * 30 not in r.stdout and "y" * 20 not in r.stdout and oct(out.stat().st_mode & 0o777) == "0o600"
    link = out.read_text().strip()
    assert link.startswith("kairos://setup?k=pk_") and "u=https%3A%2F%2Fhub.example.app" in link and "t=tok_" in link


# ---------- second verification round ----------

def test_the_language_rewrite_also_skips_a_primary_that_failed(monkeypatch):
    calls = []

    def post(client, deadline, body, timings=None, private=False, failed=None):
        calls.append(set(failed) if failed is not None else None)
        return {"content": "hello", "_model": "m"}
    monkeypatch.setattr(model, "_post", post)
    failed = {("https://primary.example/v1", "m", "k")}
    model._final(None, time.monotonic() + 5, [], "你好，今天没有事情。", "Did anything happen today?", "English", [], "p",
                 False, False, "m", [], failed)
    assert calls and calls[-1] == failed


def test_an_explicit_empty_tool_choice_turns_the_forced_call_off(tmp_path):
    env = {**os.environ, "KAIROS_TOOL_CHOICE": "", "PYTHONDONTWRITEBYTECODE": "1"}
    out = subprocess.run([sys.executable, "-c", "from hub import model; print(repr(model.TOOL_CHOICE))"], cwd=ROOT,
                         env=env, capture_output=True, text=True, check=True).stdout.strip()
    assert out == "''"


def test_local_off_with_a_hosted_fallback_answers_without_vault(client, owner, monkeypatch):
    monkeypatch.setenv("KAIROS_LOCAL_MODELS", "0")
    monkeypatch.setattr(model, "BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setattr(model, "FALLBACK", ("https://api.example.com/v1", "hosted", "sk-fake"))
    seen = []

    def post(client, deadline, body, timings=None, private=False, failed=None):
        seen.append(private)
        return {"content": "hi there", "_model": "hosted"}
    monkeypatch.setattr(model, "_post", post)
    r = model.ask(db.owner()["id"], "hello there", allow_vault=True)
    assert r["model"] == "hosted" and seen == [False]
    assert client.get("/api/health").json()["model"] == "api"


def test_no_vault_answers_for_any_token_through_the_tunnel_without_a_call(client, owner, app, monkeypatch):
    got = []
    monkeypatch.setattr(main.model, "ask", lambda pid, q, **kw: got.append(kw["allow_vault"]) or {"answer": "ok"})
    monkeypatch.setenv("KAIROS_SERVER_MODE", "1")
    client.post("/api/ask", headers={**app, **TUNNEL}, json={"question": "q"})
    client.post("/api/ask", headers=app, json={"question": "q"})
    assert got == [False, True]  # the internet never; the hub's Wi-Fi as before


def test_failed_voice_mints_are_refunded_to_the_day_charged(client, owner, app, monkeypatch):
    monkeypatch.setattr(main, "server_env", lambda n: {"ELEVENLABS_API_KEY": "k", "ELEVENLABS_AGENT_ID": "a"}.get(n))
    monkeypatch.setattr(httpx, "get", lambda url, params=None, headers=None, timeout=None: httpx.Response(
        200, json=["not", "a", "token"], request=httpx.Request("GET", url)))
    assert client.post("/api/voice/session", headers=app).status_code == 502
    pid = db.owner()["id"]
    assert db.usage_today(pid, "voice_sessions") == 0
    day = db.usage_take(pid, "voice_sessions", 4)
    db.usage_add(pid, "voice_sessions", -1, "2026-10-26")  # a refund to another day changes nothing there
    db.usage_add(pid, "voice_sessions", -5, day)
    assert db.usage_today(pid, "voice_sessions") == 0  # never below 0


def test_refusals_carry_a_sentence_and_consents_dont_need_the_draft_key(client, app, monkeypatch):
    monkeypatch.setattr(providers, "compose", lambda *a, **k: {"text": "", "changes_made": [], "missing": [],
                                                               "risk": ["refused"], "provider": "x", "ms": 1})
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "threaten him"})
    assert r.status_code == 422 and " " in r.json()["message"]
    monkeypatch.setenv("KAIROS_DRAFT_KEY", "c2hvcnQ=")
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "hi there"})
    assert r.status_code == 503 and "reason" not in r.json() and "/" not in json.dumps(r.json())
    assert client.get("/api/consents", headers=app).status_code == 200


def test_revisions_record_their_providers(client, app):
    d = draft(client, app, target_lang="te-Telu")
    client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 1, "chip": "shorter"})
    revised = [e["payload"] for e in db.events_after(db.owner()["id"]) if e["kind"] == "bridge.revised"]
    assert revised[0]["providers"] == {"compose": "gemini:fake", "back_translate": "gemini:fake"}


def test_forget_keeps_drafts_out_of_its_backup_and_forgetting_a_device_drops_its_drafts(client, owner, app):
    import sqlite3
    d = draft(client, app, transcript="the clinic said the scan shows a lump")
    app_id = db.device_by_token(app["Authorization"].split()[1])["id"]
    assert client.post("/api/forget", headers=owner, json={"device_id": app_id}).status_code == 200
    assert client.get(f"/api/bridge/drafts/{d['draft_id']}", headers=app).status_code == 404
    draft(client, app, transcript="the clinic said the scan shows a lump")
    backup = client.post("/api/forget", headers=owner, json={"all": True}).json()["backup"]
    b = sqlite3.connect(db.DB_PATH.parent / "backups" / backup)
    try:
        assert b.execute("SELECT count(*) FROM drafts").fetchone()[0] == 0
    finally:
        b.close()


def test_kill_switches_stop_when_either_place_says_so(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("KAIROS_KILL_SEND=1\n")
    monkeypatch.setenv("KAIROS_ENV_FILE", str(f))
    monkeypatch.setenv("KAIROS_KILL_SEND", "0")
    assert main.killed("KAIROS_KILL_SEND")


def test_link_checks_round_three():
    said = "tell Amma I will be late tonight"
    must_block = ["Late tonight (\u0301hsbc-secure.co.uk/verify)", "Album: \u0332photos.family/ravi",
                  "Late tonight. \u0c4dbit.ly/3xYz", "Late tonight. \u0301evil.com/pay",
                  "Late tonight. Go to evil.com\u0c15\u0c3f", "Visit evil.com\u092a\u0930", "Visit hsbc-secure.co.uk\u0c32\u0c4b",
                  "wa.me\u0c15\u0c3f", "Visit evil.com\u0332", "Visit evil.com\u3164 now",
                  "Open 203.0.113.5/1/pay", "Open 203.0.113.5/2fa", "Open 203.0.113.5/0/login?next=bank", "Open 203.0.113.5#1234",
                  "Open 203.0.113.5?1000", "Photos at 360.photos/ravi", "Hsbc-Secure.Support:443/verify"]
    for d in must_block:
        assert bridge_checks.check_draft(said, d)["blocked"], d
    never_block = ["डॉ.राव/डॉ.रेड्डी आएंगे", "డా.రావు/డా.రెడ్డి గారు వస్తారు", "అమ్మ.నేను/నాన్న వస్తాము", "माँ.मैं/पापा आएंगे",
                   "1.चाय/कॉफी 2.दूध", "25.अक्टूबर/26.अक्टूबर", "ask dr.rao/dr.reddy", "mr.smith/mrs.smith said hi",
                   "1.tea/coffee 2.snacks", "Free on 25.oct/26.oct?", "Come at 8.pm/9.pm", "booking ref.no:45678",
                   "Score: India.Total:250/3", "Insta: @ravi.photos", "Budżet: 1.000.000.000/rok", "1.250.000.000/rok",
                   "tzn.że będę później", "ok.będę o 8.15"]
    for d in never_block:
        assert not bridge_checks.check_draft(said, d)["blocked"], d
    for t, d in (("the router page is 192.168.0.1", "Router: http://192.168.0.1/evil"),
                 ("the router page is 192.168.0.1", "Router: 192.168.0.1/admin/reset?pw=1"),
                 ("update the phone to version 17.0.1.2", "Get 17.0.1.2.ios-update.com/install"),
                 ("my router is 192.168.0.1", "Open http://192.168.0.1.evil.com/login")):
        assert bridge_checks.check_draft(t, d)["blocked"], d  # saying an IP doesn't vouch for more than that IP
    for t, d in (("The router page is 192.168.0.1.", "Router: 192.168.0.1/"),
                 ("the printer is 192.168.1.20 port 631", "Printer: 192.168.1.20:631")):
        assert not bridge_checks.check_draft(t, d)["blocked"], d


def test_one_gemini_key_gives_a_fast_ask_model_a_backup_and_a_bridge_model(tmp_path, monkeypatch):
    f = tmp_path / "agents.env"
    f.write_text("GEMINI_API_KEY=AQ.fake\n")
    monkeypatch.setenv("KAIROS_AGENTS_ENV_FILE", str(f))
    monkeypatch.delenv("TEMPO_LLM_BASE_URL", raising=False)
    assert providers.tempo_llm() == (providers.GEMINI_BASE, providers.GEMINI_ASK_MODEL, "AQ.fake")
    assert providers.tempo_llm_fallback() == (providers.GEMINI_BASE, providers.GEMINI_FALLBACK_MODEL, "AQ.fake")
    assert providers.llm_config() == (providers.GEMINI_BASE, providers.GEMINI_BRIDGE_MODEL, "AQ.fake")
    monkeypatch.setenv("TEMPO_LLM_BASE_URL", "https://other.example/v1")  # an explicit provider: no implicit Gemini
    assert providers.tempo_llm_fallback() == ("", "", "") and providers.llm_config()[0] == "https://other.example/v1"
