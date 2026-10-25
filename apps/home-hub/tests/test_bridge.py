"""The Communications Bridge (M5/M7): drafts from a transcript or clip, the approval hash lock, versions, single-use
nonces, blocked links, caps, the kill switch, encryption at rest and an audit that never holds the text."""
import json
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

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import bridge, db, main, providers  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
META = {"recipient": {"ref": "p_7f3a", "alias": "Amma", "relation": "mother", "lang": "te-Telu"},
        "channel": "whatsapp", "tone": "warm", "target_lang": "en-GB", "speech_lang": "en"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    monkeypatch.delenv("KAIROS_KILL_SEND", raising=False)
    db.init(tmp_path / "b.db")
    bridge._ready.clear()
    composed = {"n": 0}

    def compose(transcript, recipient, tone, target_lang, sign_off=None, timeout=8.0):
        composed["n"] += 1
        return {"text": f"[{tone}] {transcript}", "changes_made": [f"{tone} tone"], "missing": [], "risk": [],
                "provider": "fake", "ms": 1}
    monkeypatch.setattr(providers, "compose", compose)
    monkeypatch.setattr(providers, "back_translate", lambda draft, frm, to="en", timeout=8.0:
                        {"text": f"(back) {draft}", "provider": "fake", "ms": 1})
    monkeypatch.setattr(providers, "transcribe", lambda audio, **kw: {"text": "I'll be home at 8, don't wait for dinner",
                                                                      "lang": "en", "provider": "fake", "ms": 1})
    monkeypatch.setattr(providers, "speak", lambda text, lang=None, timeout=8.0: {"audio": b"ID3fake-mp3:" + text.encode(),
                                                                                  "provider": "fake", "ms": 1})
    with TestClient(main.app) as c:
        c.composed = composed
        yield c


@pytest.fixture()
def app(client, tmp_path):
    client.post("/api/devices/register", json={"name": "laptop"})
    tok = tmp_path / "app.token"
    subprocess.run([sys.executable, "scripts/device_admin.py", "add-device", "--name", "Kairos iPhone app",
                    "--token-file", str(tok)], cwd=ROOT, env={**os.environ, "TEMPO_DB": str(db.DB_PATH)},
                   capture_output=True, text=True, check=True)
    return {"Authorization": f"Bearer {tok.read_text().strip()}"}


def draft(client, app, transcript="I'll be home at 8, don't wait for dinner", **meta):
    r = client.post("/api/bridge/draft", headers=app, json={**META, **meta, "transcript": transcript})
    assert r.status_code == 200, r.text
    return r.json()


def approve(client, app, d, **over):
    body = {"version": d["version"], "text_hash": d["text_hash"], "recipient_ref": "p_7f3a", "channel": "whatsapp",
            "method": "tap", **over}
    return client.post(f"/api/bridge/drafts/{d['draft_id']}/approve", headers=app, json=body)


def test_a_transcript_becomes_a_checked_draft_card(client, app):
    d = draft(client, app)
    assert d["text"] == "[warm] I'll be home at 8, don't wait for dinner" and d["heard"]["text"].startswith("I'll be home")
    assert d["version"] == 1 and d["text_hash"].startswith("hmac-sha256:") and d["checks"]["blocked"] == []
    assert "compose" in d["timings"] and d["back_translation"] is None  # same language: no back-translation
    te = draft(client, app, target_lang="te-Telu")
    assert te["back_translation"].startswith("(back)")


def test_a_voice_clip_is_transcribed_and_never_stored(client, app):
    r = client.post("/api/bridge/draft", headers=app, files={"audio": ("clip.m4a", b"\x00" * 1000, "audio/mp4")},
                    data={"meta": json.dumps(META)})
    assert r.status_code == 200, r.text
    assert r.json()["heard"]["text"].startswith("I'll be home") and "stt" in r.json()["timings"]
    big = client.post("/api/bridge/draft", headers=app, files={"audio": ("clip.m4a", b"\x00" * (2 * 1024 * 1024 + 1), "audio/mp4")},
                      data={"meta": json.dumps(META)})
    assert big.status_code == 413


def test_approve_locks_the_exact_text_version_recipient_and_channel(client, app):
    d = draft(client, app)
    assert approve(client, app, d, version=2).status_code == 409
    assert approve(client, app, d, text_hash="sha256:" + "0" * 64).status_code == 409
    assert approve(client, app, d, recipient_ref="p_other").status_code == 409
    assert approve(client, app, d, channel="sms").status_code == 409
    r = approve(client, app, d)
    assert r.status_code == 200 and r.json()["text"] == d["text"] and r.json()["expires_in"] == 120
    assert approve(client, app, d).status_code == 409  # already approved


def test_a_revision_makes_a_new_version_and_the_old_one_cant_be_approved(client, app):
    d = draft(client, app)
    r = client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 1, "chip": "more_formal"})
    assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["text"].startswith("[formal]")
    assert approve(client, app, d).status_code == 409  # version 1 is stale
    edited = client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app,
                         json={"version": 2, "text": "Home at 8. Don't wait for dinner x"}).json()
    assert edited["version"] == 3 and edited["changes_made"] == ["edited by you"]
    assert client.post(f"/api/bridge/drafts/{d['draft_id']}/revise", headers=app, json={"version": 2, "chip": "shorter"}).status_code == 409
    assert approve(client, app, edited).status_code == 200


def test_the_nonce_is_single_use_and_expires(client, app, monkeypatch):
    d = draft(client, app)
    nonce = approve(client, app, d).json()["nonce"]
    out = client.post(f"/api/bridge/drafts/{d['draft_id']}/outcome", headers=app, json={"nonce": nonce, "outcome": "handed_off"})
    assert out.json()["state"] == "handed_off" and "total" in out.json()["timings"]
    again = client.post(f"/api/bridge/drafts/{d['draft_id']}/outcome", headers=app, json={"nonce": nonce, "outcome": "handed_off"})
    assert again.status_code == 409  # reuse
    d2 = draft(client, app, transcript="see you at 9")
    n2 = approve(client, app, d2).json()["nonce"]
    monkeypatch.setattr(bridge.time, "time", lambda: 10 ** 12)  # 120 s later, and then some
    assert client.post(f"/api/bridge/drafts/{d2['draft_id']}/outcome", headers=app, json={"nonce": n2, "outcome": "handed_off"}).status_code == 409
    assert client.post(f"/api/bridge/drafts/{d2['draft_id']}/outcome", headers=app, json={"nonce": "n_forged", "outcome": "handed_off"}).status_code == 409


def test_a_link_the_person_never_said_blocks_the_draft(client, app, monkeypatch):
    monkeypatch.setattr(providers, "compose", lambda *a, **k: {"text": "Pay here: https://evil.example/pay or call +44 7700 900123",
                                                               "changes_made": [], "missing": [], "risk": [], "provider": "fake", "ms": 1})
    d = draft(client, app, transcript="tell her I paid the rent")
    kinds = {b["kind"] for b in d["checks"]["blocked"]}
    assert {"url", "phone"} <= kinds and d["checks"]["needs_tap"]
    assert approve(client, app, d).status_code == 409


def test_refusals_and_unclear_clips(client, app, monkeypatch):
    monkeypatch.setattr(providers, "compose", lambda *a, **k: {"text": "", "changes_made": [], "missing": [], "risk": ["refused"],
                                                               "provider": "fake", "ms": 1})
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "threaten him"})
    assert r.status_code == 422 and r.json()["error"] == "refused"
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": " "})
    assert r.status_code == 422 and r.json()["error"] == "unclear"


def test_compose_failure_offers_to_send_it_as_said(client, app, monkeypatch):
    def boom(*a, **k):
        raise providers.ProviderError("timeout")
    monkeypatch.setattr(providers, "compose", boom)
    d = draft(client, app, transcript="running late, sorry")
    assert d["text"] == "running late, sorry" and any(f["kind"] == "compose_failed" for f in d["checks"]["flags"])


def test_only_the_apps_device_token_uses_the_bridge(client, app):
    voice = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    hands = db.add_device(db.owner()["id"], "hands", "hands", "hands", ["hands"], "owner-cli")
    for t in (voice["token"], hands["token"]):
        assert client.post("/api/bridge/draft", headers={"Authorization": f"Bearer {t}"},
                           json={**META, "transcript": "hi"}).status_code == 403


def test_caps_kill_switch_and_new_recipient_limit(client, app, monkeypatch):
    monkeypatch.setitem(bridge.CAPS, "drafts", 2)
    draft(client, app)
    d = draft(client, app)
    assert client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "x y"}).status_code == 429
    monkeypatch.setenv("KAIROS_KILL_SEND", "1")
    assert approve(client, app, d).status_code == 503
    monkeypatch.delenv("KAIROS_KILL_SEND")
    monkeypatch.setitem(bridge.CAPS, "new_recipients", 0)
    assert approve(client, app, d).status_code == 429  # a never-seen recipient over today's limit


def test_drafts_are_encrypted_the_audit_holds_no_text_and_cancel_purges(client, app):
    d = draft(client, app, transcript="the door code is 4821")
    raw = json.dumps([tuple(r) for r in db.conn().execute("SELECT * FROM drafts")])
    assert "4821" not in raw
    audit = [e for e in db.events_after(db.owner()["id"]) if e["kind"].startswith("bridge.")]
    assert audit and "4821" not in json.dumps(audit) and audit[0]["payload"]["text_hmac"].startswith("hmac:")
    assert audit[0]["class"] == "vault"
    assert client.post(f"/api/bridge/drafts/{d['draft_id']}/cancel", headers=app).json()["state"] == "cancelled"
    assert client.get(f"/api/bridge/drafts/{d['draft_id']}", headers=app).status_code == 404


def test_readback_speaks_the_exact_current_text(client, app):
    d = draft(client, app)
    r = client.get(f"/api/bridge/drafts/{d['draft_id']}/readback", headers=app)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and d["text"].encode() in r.content


def test_consents_are_per_category_and_provider(client, app):
    assert client.put("/api/consents", headers=app, json={"category": "health", "provider": "gemini", "granted": False}).status_code == 200
    assert client.get("/api/consents", headers=app).json()["consents"][0]["granted"] is False
    assert client.put("/api/consents", headers=app, json={"category": "everything", "provider": "x", "granted": True}).status_code == 422


def test_devices_cant_forge_bridge_audit_events(client, app):
    r = client.post("/api/events", headers=app, json={"events": [{"kind": "bridge.handed_off", "payload": {}}]})
    assert r.status_code == 422


def test_a_prose_refusal_is_never_sent_as_the_raw_words(client, app, monkeypatch):
    def prose(*a, **k):
        raise providers.ProviderError("llm: no JSON in reply")
    monkeypatch.setattr(providers, "compose", prose)
    r = client.post("/api/bridge/draft", headers=app, json={**META, "transcript": "tell him I'll hurt him"})
    assert r.status_code == 422 and r.json()["error"] == "refused"


def test_flagged_values_are_encrypted_at_rest(client, app, monkeypatch):
    monkeypatch.setattr(providers, "compose", lambda *a, **k: {"text": "See you soon", "changes_made": [], "missing": [],
                                                               "risk": [], "provider": "fake", "ms": 1})
    d = draft(client, app, transcript="my pin is 482913, see you soon")
    assert any(f["value"] == "482913" for f in d["checks"]["flags"])
    assert "482913" not in json.dumps([tuple(r) for r in db.conn().execute("SELECT * FROM drafts")])
