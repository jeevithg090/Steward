"""The Guardian on the hub: guardian.* is written only by the Guardian device; the status, vault and lockdown routes keep
the hub's rules (own devices see status, admin devices control, export is this computer only); the Navigator's policy and
the lockdown file agree."""
import base64
import json
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="guardian-api-")
os.environ["TEMPO_GUARDIAN_DATA"] = _TMP
os.environ["TEMPO_GUARDIAN_LOCKDOWN"] = os.path.join(_TMP, "lockdown.json")
os.environ.setdefault("TEMPO_VAULT_KEY", base64.b64encode(b"test-key-32-bytes-test-key-32-by").decode())
os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
os.environ["TEMPO_MDNS"] = "0"
os.environ["TEMPO_LLM_BASE_URL"] = "http://127.0.0.1:9"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from guardian import api as guardian_api  # noqa: E402
from guardian import lockdown  # noqa: E402
from hub import db, main  # noqa: E402
from navigator import intent as intent_mod  # noqa: E402
from navigator import policy  # noqa: E402
from navigator.payees import Resolution, demo_book  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMPO_TEST_CLIENT_IP", "127.0.0.1")
    db.init(tmp_path / "h.db")
    lockdown.unlock()
    guardian_api.reset_vault()
    with TestClient(main.app) as c:
        yield c
    lockdown.unlock()


def register(client, name="laptop", **extra):
    r = client.post("/api/devices/register", json={"name": name, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def auth(cred):
    return {"Authorization": f"Bearer {cred['device_token']}"}


def guardian_device():
    person = db.owner()
    return db.add_device(person["id"], "Kairos Guardian", "guardian", "guardian", ["guardian"], "owner-cli")


def test_only_the_guardian_device_writes_guardian_kinds(client):
    owner = register(client)
    r = client.post("/api/events", json={"events": [{"kind": "guardian.alert", "payload": {"severity": "high", "text": "x"}}]}, headers=auth(owner))
    assert r.status_code == 422 and "guardian." in r.text
    g = guardian_device()
    h = {"Authorization": f"Bearer {g['token']}"}
    r = client.post("/api/events", json={"events": [{"kind": "guardian.alert", "payload": {"severity": "high", "code": "test", "text": "Something odd."}, "text": "high: Something odd."}]}, headers=h)
    assert r.status_code == 200 and r.json()["accepted"] == 1
    ev = [e for e in client.get("/api/events?after=0", headers=auth(owner)).json()["events"] if e["kind"] == "guardian.alert"][0]
    assert ev["trust_level"] == "agent" and ev["class"] == "vault" and ev["source"] == "guardian"
    # the guardian device still can't write other reserved kinds, and can't administer
    r = client.post("/api/events", json={"events": [{"kind": "approval.granted", "payload": {}}]}, headers=h)
    assert r.status_code == 422
    assert client.post("/api/guardian/unlock", headers=h).status_code == 403


def test_status_for_own_devices_not_for_ask_only(client):
    owner = register(client)
    r = client.get("/api/guardian/status", headers=auth(owner))
    assert r.status_code == 200
    st = r.json()
    assert st["running"] is False and st["protected"] is False and "isn't running" in st["headline"]
    assert st["lockdown"]["locked"] is False and st["vault"]["pubkey"]
    agent = db.add_device(db.owner()["id"], "voice", "voice", "agent", ["ask"], "owner-cli")
    assert client.get("/api/guardian/status", headers={"Authorization": f"Bearer {agent['token']}"}).status_code == 403
    assert client.get("/api/guardian/catalogue", headers=auth(owner)).json()["threats"][0]["teach"]


def test_alerts_come_from_the_log(client):
    owner = register(client)
    g = guardian_device()
    h = {"Authorization": f"Bearer {g['token']}"}
    client.post("/api/events", json={"events": [
        {"kind": "guardian.alert", "payload": {"severity": "critical", "code": "payment_without_approval", "text": "A payment was recorded as sent with no approval.", "lockdown": ["money"]}},
        {"kind": "guardian.alert", "payload": {"severity": "notice", "code": "scam_letter_read", "text": "A letter looked like a scam."}}]}, headers=h)
    al = client.get("/api/guardian/alerts", headers=auth(owner)).json()["alerts"]
    assert [a["code"] for a in al] == ["scam_letter_read", "payment_without_approval"] or [a["code"] for a in al] == ["payment_without_approval", "scam_letter_read"]
    assert all(a["ref"].startswith("#") for a in al)
    st = client.get("/api/guardian/status", headers=auth(owner)).json()
    assert len(st["alerts"]) == 2


def test_lock_and_unlock_are_admin_only_and_the_policy_obeys(client):
    owner = register(client)
    book = demo_book()
    it = intent_mod.parse("send fifty pounds to my son")
    res = book.resolve(it.payee_phrase)
    assert policy.evaluate(it, res, book, []).ok
    r = client.post("/api/guardian/lock", json={"reason": "demo: a forged payment", "scopes": ["money"]}, headers=auth(owner))
    assert r.status_code == 200 and r.json()["scopes"] == ["money"]
    d = policy.evaluate(it, res, book, [])
    assert d.outcome == "refuse" and d.reasons == ["guardian_lockdown"] and "paused payments" in d.say and "forged" in d.say
    # reading the balance is still allowed
    ro = intent_mod.parse("what's my balance")
    assert policy.evaluate(ro, Resolution("unknown"), book, []).ok
    # a device that came in through a join window may read status but not unlock
    from hub import main as m
    m._join_window["until"] = __import__("time").time() + 60
    m._join_window["by"] = owner["device_id"]
    os.environ["TEMPO_TEST_CLIENT_IP"] = "10.0.0.9"
    guest = register(client, name="guest phone")
    assert client.get("/api/guardian/status", headers=auth(guest)).status_code == 200
    assert client.post("/api/guardian/unlock", headers=auth(guest)).status_code == 403
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    r = client.post("/api/guardian/unlock", headers=auth(owner))
    assert r.status_code == 200 and r.json()["unlocked"] is True
    assert policy.evaluate(it, res, book, []).ok
    kinds = [e["kind"] for e in client.get("/api/events?after=0", headers=auth(owner)).json()["events"]]
    assert "guardian.lockdown" in kinds and "guardian.unlocked" in kinds


def test_vault_routes(client):
    owner = register(client)
    v = guardian_api.get_vault()
    v.owner().put("people", {"name": "Arjun"}, tags=["relation:son"])
    v.owner().put("documents", {"summary": "water bill"})
    info = client.get("/api/guardian/vault", headers=auth(owner)).json()
    assert info["stats"]["records"] == 2 and info["verify"]["ok"]
    log = client.get("/api/guardian/vault/log", headers=auth(owner)).json()["log"]
    assert log[0]["action"] == "put"
    exp = client.get("/api/guardian/vault/export", headers=auth(owner)).json()
    assert {r["category"] for r in exp["records"]} == {"people", "documents"} and exp["records"][0]["data"]
    # export is this computer only
    os.environ["TEMPO_TEST_CLIENT_IP"] = "192.168.1.50"
    r = client.get("/api/guardian/vault/export", headers=auth(owner))
    assert r.status_code == 403
    os.environ["TEMPO_TEST_CLIENT_IP"] = "127.0.0.1"
    r = client.post("/api/guardian/vault/forget", json={"category": "people"}, headers=auth(owner))
    assert r.json() == {"forgotten": 1, "category": "people", "key_destroyed": True}
    assert client.get("/api/guardian/vault", headers=auth(owner)).json()["stats"]["records"] == 1
    pk = client.get("/api/guardian/pubkey", headers=auth(owner)).json()
    assert pk["pubkey"] == v.pubkey
    kinds = [e["kind"] for e in client.get("/api/events?after=0", headers=auth(owner)).json()["events"]]
    assert "guardian.export" in kinds and "guardian.forget" in kinds


def test_profile_and_review_routes(client):
    owner = register(client)
    hands = db.add_device(db.owner()["id"], "hands", "hands", "hands", ["hands"], "owner-cli")
    h = {"Authorization": f"Bearer {hands['token']}"}
    r = client.post("/api/money/events", json={"events": [
        {"kind": "money.requested", "payment_id": "p1", "event_time": "2026-10-03T11:00:00Z", "payload": {"text": "pay the water bill"}},
        {"kind": "money.approved", "payment_id": "p1", "event_time": "2026-10-03T11:00:30Z", "payload": {"by": "phone"}},
        {"kind": "money.sent", "payment_id": "p1", "event_time": "2026-10-03T11:01:00Z", "payload": {"payee_id": "water", "amount": "42.00"}}]}, headers=h)
    assert r.status_code == 200
    prof = client.get("/api/guardian/profile", headers=auth(owner)).json()
    assert prof["payees"]["water"]["payments"] == 1 and prof["counts"]["payments"] == 1
    rev = client.get("/api/guardian/review?month=2026-10", headers=auth(owner)).json()
    assert rev["counts"]["payments"] == 1 and "1 payment" in rev["spoken"]
    assert client.get("/api/guardian/review?month=bad", headers=auth(owner)).status_code == 400
